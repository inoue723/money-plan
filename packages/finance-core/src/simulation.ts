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
  type SalaryTaxInput,
} from './tax';
import type { DependentCategory } from './constants';
import { initInvestmentState, stepInvestment, type InvestmentState } from './investment';
import type {
  EducationPlan,
  IncomeBreakdown,
  SimulationInput,
  SimulationResult,
  TaxBreakdown,
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
 * `baseAge` はシミュレーション起点(i=0)における年齢で、出産イベントで生まれる子は
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

  // 起点時点で存在する子ども + 出産イベントで生まれる子どもを正規化してまとめる。
  const children: NormalizedChild[] = [
    ...family.children.map((c) => ({ baseAge: c.age, education: c.education })),
    ...events
      .filter((e) => e.type === 'birth')
      .map((e) => ({
        // 出産年(本人 = e.age)に子の年齢が 0 になるよう起点年齢を逆算する。
        baseAge: currentAge - e.age,
        education: e.education,
      })),
  ];

  const results: YearlyResult[] = [];

  // 年をまたいで持ち越す state(前年 state → 当年 state の明示的な畳み込み)。
  let savings = basic.savings;
  let investmentState: InvestmentState = initInvestmentState(basic.investments);

  for (let i = 0; currentAge + i <= endAge; i++) {
    const age = currentAge + i;
    const year = startYear + i;
    const eventNames: string[] = [];

    // --- 当年の子どもの年齢(未出生は負値。0 以上のみ「在籍」) -----------------
    const childAgesThisYear = children
      .map((c) => c.baseAge + i)
      .filter((childAge) => childAge >= 0);

    // =========================================================================
    // 1. 収入
    // =========================================================================
    const working = age < income.retirementAge;
    const grossSalary = working ? income.salary * growthFactor(income.raiseRate, i) : 0;
    const spouseSalary = family.spouse ? family.spouse.income : 0;

    // 受給開始年齢(= 退職年齢)以降に公的年金を受給する。
    const receivingPension = age >= income.retirementAge && income.pension > 0;

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
    if (grossSalary > 0) {
      const selfInput: SalaryTaxInput = { grossSalary, hasSpouseDeduction, dependents };
      const self = calcSalaryTax(selfInput);
      taxBreakdown = addTaxBreakdown(taxBreakdown, self.breakdown);
      salaryNet += self.netSalary;
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
    let otherIncome = income.other;
    if (age === income.retirementAge && income.retirementBonus > 0) {
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

    // 生活費: 物価上昇を反映し、結婚後は生活費係数を乗じる。
    const marriageFactor = events
      .filter((e) => e.type === 'marriage' && e.age <= age)
      .reduce((factor, e) => (e.type === 'marriage' ? e.livingCostFactor : factor), 1);
    const living = expense.living * 12 * growthFactor(expense.inflationRate, i) * marriageFactor;

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
        case 'marriage':
          if (e.age === age) {
            eventExpense += e.cost;
            eventNames.push('結婚');
          }
          break;
        case 'birth':
          if (e.age === age) eventNames.push('出産');
          break;
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

    // =========================================================================
    // 集計(SPEC.md 2.3.1)
    // =========================================================================
    const netIncome = salaryNet + pensionNet + childAllowance; // 手取り収入
    const balance = netIncome + otherIncome - totalExpense - invStep.contribution;

    // 預金残高 = 前年 + 年間収支 + 投資取崩額(取崩は運用益課税を差し引いた手取り)。
    savings += balance + (invStep.withdrawal - invStep.tax);

    const investmentValue = invStep.state.value;
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
      investmentGain: invStep.gain,
      totalAssets,
      events: eventNames,
    });
  }

  return results;
}
