/**
 * 年次資産推移シミュレーション本体(SPEC.md 2.3 / F-06)。
 *
 * 税(tax.ts)・教育費(education.ts)・投資(investment.ts)の各モジュールを統合し、
 * 入力(SimulationInput)から現在年齢〜終了年齢までの年次結果(SimulationResult)を計算する。
 * Web 側(F-06 以降)はこの `runSimulation` を唯一の計算入口として利用する。
 *
 * ## 設計方針
 * - 純粋関数。副作用なし。前年 state → 当年 state の明示的な畳み込み(reduce 相当)で実装する。
 * - 適用順序は SPEC.md 2.3.1 に合わせ「収入 → 税 → 支出 → 投資」とする。
 * - 金額の単位は system 基本単位の「万円」。率(昇給率・物価上昇率・利回り)は %(例: 1.0 = 1%)。
 *
 * ## 基本式(SPEC.md 2.3.1)
 * ```
 * 手取り収入 = 額面収入 − 所得税 − 住民税 − 社会保険料
 * 年間収支   = 手取り収入 + その他収入 − 年間支出 − 投資積立額
 * 預金残高   = 前年の預金残高 + 年間収支 (+ 投資取崩額)
 * 投資資産   = (前年の投資資産 + 積立額) × (1 + 利回り) − 取崩額
 * 総資産     = 預金残高 + 投資資産
 * ```
 */

import { educationCostForAge } from './education';
import {
  calcChildAllowanceManyen,
  calcPensionTax,
  calcSalaryTax,
  calcSelfEmployedTax,
  type PersonalDeductionOptions,
} from './tax';
import type { DependentCategory } from './constants';
import { initInvestmentState, stepInvestment, type InvestmentState } from './investment';
import type {
  EducationPlan,
  ExpenseBreakdown,
  IncomeBreakdown,
  IncomeInput,
  SimulationInput,
  SimulationResult,
  TaxBreakdown,
  WorkPeriod,
  YearlyResult,
} from './types';

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/** 年率(%)を年数 n 分だけ複利で成長させる係数。 */
const growthFactor = (ratePercent: number, years: number): number =>
  Math.pow(1 + ratePercent / 100, years);

/** 空(ゼロ)の控除内訳。 */
const emptyTaxBreakdown = (): TaxBreakdown => ({
  incomeTax: 0,
  residentTax: 0,
  healthInsurance: 0,
  pensionInsurance: 0,
  employmentInsurance: 0,
  socialInsurance: 0,
});

/** 2 つの控除内訳を各フィールドごとに加算する。 */
const addTaxBreakdown = (a: TaxBreakdown, b: TaxBreakdown): TaxBreakdown => ({
  incomeTax: a.incomeTax + b.incomeTax,
  residentTax: a.residentTax + b.residentTax,
  healthInsurance: a.healthInsurance + b.healthInsurance,
  pensionInsurance: a.pensionInsurance + b.pensionInsurance,
  employmentInsurance: a.employmentInsurance + b.employmentInsurance,
  socialInsurance: a.socialInsurance + b.socialInsurance,
});

/**
 * 住宅ローンの年間返済額(万円)を元利均等返済で求める。
 * 借入額 = 物件価格 − 頭金。金利 0% のときは元金の均等割り。
 */
const annualLoanPayment = (
  price: number,
  downPayment: number,
  annualInterestRate: number,
  loanTermYears: number,
): number => {
  const principal = Math.max(0, price - downPayment);
  if (principal === 0 || loanTermYears <= 0) return 0;

  const monthlyRate = annualInterestRate / 100 / 12;
  const n = loanTermYears * 12;
  if (monthlyRate === 0) return principal / loanTermYears;

  const monthly = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
  return monthly * 12;
};

/**
 * 指定年齢に該当する働き方期間を返す(両端を含む)。
 * 期間は重複しない前提(UIでバリデーション)。万一重複していた場合は最初の一致を採用する。
 */
const activeWorkPeriod = (workPeriods: WorkPeriod[], age: number): WorkPeriod | undefined =>
  workPeriods.find((p) => age >= p.startAge && age <= p.endAge);

/** 16 歳以上の扶養親族を扶養控除の区分に対応づける(16 歳未満は児童手当対象のため対象外)。 */
const dependentCategoryForAge = (age: number): DependentCategory | undefined => {
  if (age >= 16 && age <= 18) return 'general'; // 一般扶養(16〜18歳)
  if (age >= 19 && age <= 22) return 'specific'; // 特定扶養(19〜22歳)
  if (age >= 23 && age <= 69) return 'general'; // 一般扶養(23〜69歳)
  if (age >= 70) return 'elderly'; // 老人扶養
  return undefined;
};

/**
 * 各年に評価する「子ども」を正規化した内部表現。
 * `baseAge` はシミュレーション起点(i=0)における年齢で、将来生まれる子は
 * 起点時点で未出生のため負の値になる。当年の年齢は `baseAge + i` で求める。
 */
interface NormalizedChild {
  baseAge: number;
  education: EducationPlan;
}

// ---------------------------------------------------------------------------
// 1 人分(本人 / 配偶者)の収入・税計算(#49)
// ---------------------------------------------------------------------------

/**
 * 1 人分(本人 or 配偶者)の就労プランから導出した基準年齢。
 * 働き方期間は各年で参照するため、退職金・年金の基準年齢はループ前に一度だけ計算しておく。
 */
interface PersonPlan {
  /** 収入情報(本人と配偶者で同一構造)。 */
  income: IncomeInput;
  /** 全就労期間の終了年齢の最大値。公的年金はこの翌年から受給する。 */
  lastWorkEndAge: number;
  /** 退職金の計上年齢(最後の会社員期間の終了翌年)。会社員期間が無ければ undefined。 */
  retirementBonusAge: number | undefined;
}

/** 収入情報から退職金・年金の基準年齢を求め、`PersonPlan` を構築する。 */
const buildPersonPlan = (income: IncomeInput): PersonPlan => {
  const { workPeriods } = income;
  const lastWorkEndAge = workPeriods.reduce((max, p) => Math.max(max, p.endAge), -Infinity);
  const lastEmployeeEndAge = workPeriods
    .filter((p) => p.workStyle === 'employee')
    .reduce((max, p) => Math.max(max, p.endAge), -Infinity);
  const retirementBonusAge = Number.isFinite(lastEmployeeEndAge)
    ? lastEmployeeEndAge + 1
    : undefined;
  return { income, lastWorkEndAge, retirementBonusAge };
};

/** 1 人分の当年収入・税の計算結果(金額はすべて万円)。 */
interface PersonYearIncome {
  /** 当年の額面収入(会社員は額面給与、個人事業主は事業所得)。就労なしは 0。 */
  grossSalary: number;
  /** 給与・事業の手取り。 */
  salaryNet: number;
  /** 公的年金の手取り(受給前は 0)。 */
  pensionNet: number;
  /** その他収入(手取り扱い。固定その他 + 当年の退職金)。 */
  otherIncome: number;
  /** 所得税・住民税・社会保険料の内訳(給与/事業 + 年金)。 */
  tax: TaxBreakdown;
  /** 当年に退職金を計上したか(イベント名表示用)。 */
  retiredThisYear: boolean;
}

/**
 * 1 人分(本人 or 配偶者)の当年収入・税・社会保険料を計算する。
 *
 * 会社員/個人事業主の判定・税計算・年金受給は本人と配偶者で完全に同一のロジックで、
 * 渡された `age`(本人年齢 or 配偶者年齢)を基準に適用する。人的控除(`deduction`:
 * 配偶者控除・扶養控除)は本人にのみ適用し、配偶者側は空オブジェクトで呼び出す。
 */
const calcPersonYearIncome = (
  plan: PersonPlan,
  age: number,
  deduction: PersonalDeductionOptions,
): PersonYearIncome => {
  const { income, lastWorkEndAge, retirementBonusAge } = plan;

  // 当年の働き方期間(該当なし = 無収入期間)。収入は期間の開始年齢を基準に複利成長する。
  const workPeriod = activeWorkPeriod(income.workPeriods, age);
  const grossSalary = workPeriod
    ? workPeriod.income * growthFactor(workPeriod.raiseRate, age - workPeriod.startAge)
    : 0;

  let tax = emptyTaxBreakdown();
  let salaryNet = 0;
  if (workPeriod && grossSalary > 0) {
    if (workPeriod.workStyle === 'employee') {
      // 会社員: 給与所得控除 + 健康保険・厚生年金・雇用保険。
      const r = calcSalaryTax({ grossSalary, age, ...deduction });
      tax = addTaxBreakdown(tax, r.breakdown);
      salaryNet += r.netSalary;
    } else {
      // 個人事業主: 青色申告特別控除 + 国民健康保険・国民年金(雇用保険なし)。
      const r = calcSelfEmployedTax({ businessIncome: grossSalary, age, ...deduction });
      tax = addTaxBreakdown(tax, r.breakdown);
      salaryNet += r.netIncome;
    }
  }

  // 公的年金は全就労期間の終了翌年から受給する(働き方期間が無い場合は起点から受給)。
  let pensionNet = 0;
  if (age > lastWorkEndAge && income.pension > 0) {
    const pensionTax = calcPensionTax({ pension: income.pension, age, ...deduction });
    tax = addTaxBreakdown(tax, {
      ...emptyTaxBreakdown(),
      incomeTax: pensionTax.incomeTax,
      residentTax: pensionTax.residentTax,
    });
    pensionNet = pensionTax.netPension;
  }

  // その他収入(手取り扱い): 固定のその他収入 + 退職金(最後の会社員期間の終了翌年)。
  let otherIncome = income.other;
  let retiredThisYear = false;
  if (age === retirementBonusAge && income.retirementBonus > 0) {
    otherIncome += income.retirementBonus;
    retiredThisYear = true;
  }

  return { grossSalary, salaryNet, pensionNet, otherIncome, tax, retiredThisYear };
};

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/**
 * シミュレーションを実行し、現在年齢〜終了年齢の年次結果を返す。
 *
 * @param input シミュレーション入力一式(SPEC.md 4.4)。
 * @returns 年次結果の時系列(各年 1 要素)。`endAge < currentAge` の場合は空配列。
 */
export function runSimulation(input: SimulationInput): SimulationResult {
  const { basic, family, income, expense, events, investment } = input;
  const { currentAge, endAge } = basic;

  const startYear = new Date().getFullYear();

  // 子ども一覧を起点年齢基準に正規化する(将来生まれる子は baseAge が負値になる)。
  const children: NormalizedChild[] = family.children.map((c) => ({
    baseAge: currentAge - c.bornAtParentAge,
    education: c.education,
  }));

  // 本人・配偶者(#49)の就労プラン(退職金・年金の基準年齢)をループ前に構築する。
  // 配偶者の収入は本人と同等の構造(IncomeInput)で、配偶者年齢を基準に同じロジックを適用する。
  const selfPlan = buildPersonPlan(income);
  const spousePlan = family.spouse ? buildPersonPlan(family.spouse.income) : undefined;
  const spouseBaseAge = family.spouse?.age;

  // 家賃(#50)は住宅購入年以降 0 にする(SPEC.md F-04)。最も早い住宅購入年齢を基準にする。
  const homePurchaseAge = events.reduce(
    (min, e) => (e.type === 'homePurchase' ? Math.min(min, e.age) : min),
    Infinity,
  );

  const results: YearlyResult[] = [];

  // 年をまたいで持ち越す state(前年 state → 当年 state の明示的な畳み込み)。
  let savings = basic.savings;
  let investmentState: InvestmentState = initInvestmentState(investment.accounts);
  // NISA 上限で積立が停止したことを結果側で可視化するため、最初に停止した年に一度だけ注記する。
  let nisaCapNotified = false;

  for (let i = 0; currentAge + i <= endAge; i++) {
    const age = currentAge + i;
    const year = startYear + i;
    const eventNames: string[] = [];

    // --- 当年の子どもの年齢(未出生は負値。0 以上のみ「在籍」) -----------------
    // 全子どもの当年年齢(入力と同順・同数。未出生は負値)。CF表の年齢行で使う。
    const allChildAges = children.map((c) => c.baseAge + i);
    const childAgesThisYear = allChildAges.filter((childAge) => childAge >= 0);

    // 配偶者の当年年齢(起点年齢 + 経過年数)。配偶者なしなら undefined。
    const spouseAge = family.spouse ? family.spouse.age + i : undefined;

    // 将来生まれる子がこの年に誕生する場合はイベント名として記録する(i=0 の既存の子は除く)。
    if (i > 0 && children.some((c) => c.baseAge + i === 0)) {
      eventNames.push('子ども誕生');
    }

    // =========================================================================
    // 1. 収入 + 2. 税 → 手取り(本人・配偶者)
    // =========================================================================
    // 配偶者(#49)の当年収入・税を先に計算する。配偶者控除の判定に配偶者の当年額面収入を
    // 使うため、本人より先に評価する。配偶者側では人的控除は付けない(空オブジェクト)。
    const spouseAge = spouseBaseAge !== undefined ? spouseBaseAge + i : undefined;
    const spouseYear =
      spousePlan && spouseAge !== undefined
        ? calcPersonYearIncome(spousePlan, spouseAge, {})
        : undefined;
    const spouseSalary = spouseYear ? spouseYear.grossSalary : 0;

    // 本人の給与税(配偶者控除・扶養控除を反映)。
    // 配偶者控除は配偶者の当年額面収入が 103 万円以下のとき適用する(#49)。
    const hasSpouseDeduction = spouseYear !== undefined && spouseYear.grossSalary <= 103;
    const dependents = childAgesThisYear
      .map(dependentCategoryForAge)
      .filter((c): c is DependentCategory => c !== undefined);

    const selfYear = calcPersonYearIncome(selfPlan, age, { hasSpouseDeduction, dependents });
    const grossSalary = selfYear.grossSalary;

    // 本人 + 配偶者を合算する。控除内訳・手取り・年金手取りはそれぞれ両者の和とする。
    const taxBreakdown = spouseYear ? addTaxBreakdown(selfYear.tax, spouseYear.tax) : selfYear.tax;
    const salaryNet = selfYear.salaryNet + (spouseYear ? spouseYear.salaryNet : 0);
    const pensionNet = selfYear.pensionNet + (spouseYear ? spouseYear.pensionNet : 0);

    const childAllowance = calcChildAllowanceManyen(childAgesThisYear);

    // その他収入(手取り扱い): 本人・配偶者の固定その他 + 退職金 + 一時収入イベント。
    // 退職金は各人の最後の会社員期間の終了翌年に一括計上する。
    let otherIncome = selfYear.otherIncome + (spouseYear ? spouseYear.otherIncome : 0);
    if (selfYear.retiredThisYear) eventNames.push('退職金');
    if (spouseYear?.retiredThisYear) eventNames.push('配偶者退職金');

    // =========================================================================
    // 3. 支出
    // =========================================================================
    // 支出項目(#31): 各項目について本人年齢が期間内にある月額 × 12 × 物価上昇係数。
    // 物価上昇はシミュレーション起点(i=0)からの経過年数 i で項目ごとに複利適用する。
    const expenseItems = expense.items.map((item) => {
      const period = item.periods.find((p) => age >= p.startAge && age <= p.endAge);
      const monthly = period ? period.monthlyAmount : 0;
      return { name: item.name, amount: monthly * 12 * growthFactor(item.inflationRate, i) };
    });
    const itemsTotal = expenseItems.reduce((sum, it) => sum + it.amount, 0);

    // 家賃(#50): 専用型で計上する。
    // - 年額 = 月額 × 12 × 物価上昇係数(既存の支出項目と同じルール。物価上昇は起点からの経過年数 i)。
    // - 更新料: 期間の開始年齢を起点に周期年ごと(開始年は含めない)に「当年の月額(物価上昇適用後)× 月数」を加算。
    //   期間が変わった(引っ越し)場合は起点をその期間の開始年齢にリセットする(period 単位で判定するため自動的にそうなる)。
    // - 住宅購入年以降は家賃を 0 にする(二重計上を避ける。ローン返済側で計上)。
    // 家賃入力が無い(持ち家等)場合は undefined(内訳・CF表で非表示)。
    let rent: number | undefined;
    const rentInput = expense.rent;
    if (rentInput) {
      if (age >= homePurchaseAge) {
        rent = 0;
      } else {
        const period = rentInput.periods.find((p) => age >= p.startAge && age <= p.endAge);
        if (period) {
          const monthly = period.monthlyAmount * growthFactor(rentInput.inflationRate, i);
          let amount = monthly * 12;
          if (period.renewal && period.renewal.cycleYears > 0) {
            const yearsFromStart = age - period.startAge;
            if (yearsFromStart > 0 && yearsFromStart % period.renewal.cycleYears === 0) {
              amount += monthly * period.renewal.months;
            }
          }
          rent = amount;
        } else {
          rent = 0;
        }
      }
    }

    // 教育費(子どもの進路プランから算出。支出項目とは別枠で維持)。
    const education = children.reduce(
      (sum, c) => sum + educationCostForAge(c.education, c.baseAge + i),
      0,
    );

    // 住宅ローン返済(住宅購入イベント。返済期間内のみ)。
    // 家賃(#50)は住宅購入年以降 0 になるため、二重計上は自動的に回避される。
    const loan = events.reduce((sum, e) => {
      if (e.type !== 'homePurchase') return sum;
      const withinTerm = age >= e.age && age < e.age + e.loanTermYears;
      if (!withinTerm) return sum;
      return sum + annualLoanPayment(e.price, e.downPayment, e.loanInterestRate, e.loanTermYears);
    }, 0);

    // ライフイベント費用(一時支出 + 車の維持費・買替)。
    let eventExpense = 0;
    for (const e of events) {
      switch (e.type) {
        case 'homePurchase':
          if (e.age === age) {
            eventExpense += e.downPayment;
            eventNames.push('住宅購入');
          }
          break;
        case 'carPurchase':
          if (age >= e.age) {
            eventExpense += e.annualMaintenance; // 維持費(毎年)
            const purchaseYear = (age - e.age) % Math.max(1, e.replacementCycleYears) === 0;
            if (purchaseYear) {
              eventExpense += e.price; // 購入・買替
              eventNames.push('車購入');
            }
          }
          break;
        case 'oneTimeExpense':
          if (e.age === age) {
            eventExpense += e.amount;
            eventNames.push(e.name);
          }
          break;
        case 'oneTimeIncome':
          if (e.age === age) {
            otherIncome += e.amount;
            eventNames.push(e.name);
          }
          break;
      }
    }

    const totalExpense = (rent ?? 0) + itemsTotal + education + loan + eventExpense;

    // =========================================================================
    // 4. 投資(積立・運用・取崩・課税)
    // =========================================================================
    const invStep = stepInvestment(investmentState, { age, investment });
    investmentState = invStep.state;

    // NISA 上限で積立の一部が停止した最初の年に注記する(結果側での可視化。表現は #26 側に委ねる)。
    if (!nisaCapNotified && invStep.uninvested > 0) {
      eventNames.push('NISA上限到達');
      nisaCapNotified = true;
    }

    // =========================================================================
    // 集計(SPEC.md 2.3.1)
    // =========================================================================
    const netIncome = salaryNet + pensionNet + childAllowance; // 手取り収入
    // 上限で積み立てられなかった分(invStep.uninvested)は積立額に含まれないため、自動的に預金に残る。
    const balance = netIncome + otherIncome - totalExpense - invStep.contribution;

    // 預金残高 = 前年 + 年間収支 + 投資取崩額(取崩は運用益課税を差し引いた手取り)。
    savings += balance + (invStep.withdrawal - invStep.tax);

    const investmentValue = invStep.investmentValue;
    const totalAssets = savings + investmentValue;

    const incomeBreakdown: IncomeBreakdown = {
      grossSalary,
      spouseSalary,
      net: salaryNet,
      pension: pensionNet,
      childAllowance,
      other: otherIncome,
      investmentGain: invStep.gain,
    };

    const expenseBreakdown: ExpenseBreakdown = {
      rent,
      items: expenseItems,
      education,
      loan,
      events: eventExpense,
    };

    results.push({
      year,
      age,
      spouseAge,
      childAges: allChildAges,
      income: incomeBreakdown,
      tax: taxBreakdown,
      expense: expenseBreakdown,
      balance,
      savings,
      investmentValue,
      investmentContribution: invStep.contribution,
      investmentGain: invStep.gain,
      totalAssets,
      events: eventNames,
    });
  }

  return results;
}
