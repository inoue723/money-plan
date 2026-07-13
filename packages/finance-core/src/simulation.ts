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
} from './tax';
import type { DependentCategory } from './constants';
import { initInvestmentState, stepInvestment, type InvestmentState } from './investment';
import type {
  EducationPlan,
  IncomeBreakdown,
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

  // 就労終了・退職金計上の基準年齢(働き方期間から導出)。
  // - 公的年金: 全就労期間の終了翌年(lastWorkEndAge + 1)から受給する。
  // - 退職金: 最後の会社員期間の終了翌年に一括計上する(会社員期間が無ければ計上しない)。
  const { workPeriods } = income;
  const lastWorkEndAge = workPeriods.reduce((max, p) => Math.max(max, p.endAge), -Infinity);
  const lastEmployeeEndAge = workPeriods
    .filter((p) => p.workStyle === 'employee')
    .reduce((max, p) => Math.max(max, p.endAge), -Infinity);
  const retirementBonusAge = Number.isFinite(lastEmployeeEndAge)
    ? lastEmployeeEndAge + 1
    : undefined;

  const results: YearlyResult[] = [];

  // 年をまたいで持ち越す state(前年 state → 当年 state の明示的な畳み込み)。
  let savings = basic.savings;
  let investmentState: InvestmentState = initInvestmentState(
    basic.investments,
    investment.accounts,
  );
  // NISA 上限で積立が停止したことを結果側で可視化するため、最初に停止した年に一度だけ注記する。
  let nisaCapNotified = false;

  for (let i = 0; currentAge + i <= endAge; i++) {
    const age = currentAge + i;
    const year = startYear + i;
    const eventNames: string[] = [];

    // --- 当年の子どもの年齢(未出生は負値。0 以上のみ「在籍」) -----------------
    const childAgesThisYear = children
      .map((c) => c.baseAge + i)
      .filter((childAge) => childAge >= 0);

    // 将来生まれる子がこの年に誕生する場合はイベント名として記録する(i=0 の既存の子は除く)。
    if (i > 0 && children.some((c) => c.baseAge + i === 0)) {
      eventNames.push('子ども誕生');
    }

    // =========================================================================
    // 1. 収入
    // =========================================================================
    // 当年の働き方期間(該当なし = 無収入期間)。収入は期間の開始年齢を基準に複利成長する。
    const workPeriod = activeWorkPeriod(workPeriods, age);
    const grossSalary = workPeriod
      ? workPeriod.income * growthFactor(workPeriod.raiseRate, age - workPeriod.startAge)
      : 0;
    const spouseSalary = family.spouse ? family.spouse.income : 0;

    // 公的年金は全就労期間の終了翌年から受給する(働き方期間が無い場合は起点から受給)。
    const receivingPension = age > lastWorkEndAge && income.pension > 0;

    // =========================================================================
    // 2. 税 → 手取り
    // =========================================================================
    let taxBreakdown = emptyTaxBreakdown();

    // 本人の給与税(配偶者控除・扶養控除を反映)。
    const hasSpouseDeduction = family.spouse !== undefined && family.spouse.income <= 103;
    const dependents = childAgesThisYear
      .map(dependentCategoryForAge)
      .filter((c): c is DependentCategory => c !== undefined);

    let salaryNet = 0;
    if (workPeriod && grossSalary > 0) {
      if (workPeriod.workStyle === 'employee') {
        // 会社員: 給与所得控除 + 健康保険・厚生年金・雇用保険。
        const self = calcSalaryTax({ grossSalary, hasSpouseDeduction, dependents });
        taxBreakdown = addTaxBreakdown(taxBreakdown, self.breakdown);
        salaryNet += self.netSalary;
      } else {
        // 個人事業主: 青色申告特別控除 + 国民健康保険・国民年金(雇用保険なし)。
        const self = calcSelfEmployedTax({
          businessIncome: grossSalary,
          hasSpouseDeduction,
          dependents,
        });
        taxBreakdown = addTaxBreakdown(taxBreakdown, self.breakdown);
        salaryNet += self.netIncome;
      }
    }

    // 配偶者の給与税(本人と同様に計算。配偶者側では控除は付けない)。
    if (spouseSalary > 0) {
      const spouse = calcSalaryTax({ grossSalary: spouseSalary });
      taxBreakdown = addTaxBreakdown(taxBreakdown, spouse.breakdown);
      salaryNet += spouse.netSalary;
    }

    // 公的年金の手取り(公的年金等控除を適用)。
    let pensionNet = 0;
    if (receivingPension) {
      const pensionTax = calcPensionTax({ pension: income.pension, age, hasSpouseDeduction });
      taxBreakdown = addTaxBreakdown(taxBreakdown, {
        ...emptyTaxBreakdown(),
        incomeTax: pensionTax.incomeTax,
        residentTax: pensionTax.residentTax,
      });
      pensionNet = pensionTax.netPension;
    }

    const childAllowance = calcChildAllowanceManyen(childAgesThisYear);

    // その他収入(手取り扱い): 固定のその他収入 + 一時収入イベント + 退職金。
    // 退職金は最後の会社員期間の終了翌年に一括計上する。
    let otherIncome = income.other;
    if (age === retirementBonusAge && income.retirementBonus > 0) {
      otherIncome += income.retirementBonus;
      eventNames.push('退職金');
    }

    // =========================================================================
    // 3. 支出
    // =========================================================================
    // 住宅購入済みか(頭金支出済みで以降は家賃 0)。
    const purchasedHome = events.some((e) => e.type === 'homePurchase' && e.age <= age);

    // 住居費: 持ち家ならローン返済(返済期間内)、賃貸なら物価上昇を反映した家賃。
    let housing: number;
    if (purchasedHome) {
      housing = events.reduce((sum, e) => {
        if (e.type !== 'homePurchase') return sum;
        const withinTerm = age >= e.age && age < e.age + e.loanTermYears;
        if (!withinTerm) return sum;
        return sum + annualLoanPayment(e.price, e.downPayment, e.loanInterestRate, e.loanTermYears);
      }, 0);
    } else {
      housing = expense.rent * 12 * growthFactor(expense.inflationRate, i);
    }

    // 生活費: 物価上昇を反映する(生活費の変化は支出項目の年齢期間設定で表現する想定)。
    const living = expense.living * 12 * growthFactor(expense.inflationRate, i);

    const education = children.reduce(
      (sum, c) => sum + educationCostForAge(c.education, c.baseAge + i),
      0,
    );

    const insurance = expense.insurance * 12;
    const fixed = expense.fixed * 12;

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

    const totalExpense = housing + living + education + insurance + fixed + eventExpense;

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

    const expenseBreakdown = {
      housing,
      living,
      education,
      insurance,
      fixed,
      events: eventExpense,
    };

    results.push({
      year,
      age,
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
