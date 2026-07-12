/**
 * 税・社会保険料・関連給付の簡易計算(給与所得者を前提。SPEC.md 2.3.2 / 2.3.4 / F-08)。
 *
 * すべて純粋関数・UI 非依存。税率・料率・控除額はハードコードせず、年度別定数テーブル
 * (`constants/tax2026.ts`)から読む。実際の税額とは異なる概算モデルである(SPEC.md 1.4)。
 *
 * ## 単位の扱い
 * - システムの基本単位は「万円」。本モジュールの公開 API のうち、`grossSalary` など外部と
 *   やり取りする金額は「万円」で受け渡す。
 * - 税法の速算表・控除額は「円」で定義されているため、内部計算はいったん「円」に換算して
 *   行い、最後に「万円」へ戻す。円⇔万円 の換算は本モジュール内で完結させる。
 *
 * ## 端数処理の方針
 * - 課税所得は 1,000 円未満を切り捨てる(所得税・住民税の一般的な扱いに合わせる)。
 * - 税額・保険料は 1 円未満(小数)を切り捨てる。
 * - 「万円」への換算(円 ÷ 10,000)では追加の丸めを行わず、小数のまま保持する
 *   (集計時の桁落ちを避けるため。表示側で丸める想定)。
 */

import {
  BASIC_DEDUCTION,
  CHILD_ALLOWANCE,
  CHILD_ALLOWANCE_THIRD_CHILD_MONTHLY,
  DEPENDENT_DEDUCTION,
  INCOME_TAX_BRACKETS,
  PENSION_DEDUCTION,
  RECONSTRUCTION_SURTAX_RATE,
  RESIDENT_TAX,
  SALARY_INCOME_DEDUCTION,
  SOCIAL_INSURANCE,
  SPOUSE_DEDUCTION,
  type DependentCategory,
} from './constants';
import type { TaxBreakdown } from './types';

// ---------------------------------------------------------------------------
// 単位換算・端数処理ユーティリティ
// ---------------------------------------------------------------------------

/** 1 万円 = 10,000 円。 */
const YEN_PER_MANYEN = 10_000;

/** 万円 → 円。 */
const toYen = (manyen: number): number => manyen * YEN_PER_MANYEN;

/** 円 → 万円(追加の丸めはしない)。 */
const toManyen = (yen: number): number => yen / YEN_PER_MANYEN;

/** 1 円未満を切り捨てる(2 進浮動小数の誤差で 1 円下振れしないよう微小量を加える)。 */
const floorYen = (yen: number): number => Math.floor(yen + 1e-6);

/** 課税所得の 1,000 円未満を切り捨てる。 */
const roundDownTo1000 = (yen: number): number => Math.floor(yen / 1000) * 1000;

/**
 * `upTo` の昇順に並んだ速算表から、value が属する区分を返す。
 * 速算表の最終区分は必ず `upTo: Infinity` のため、有限の value では必ず一致する。
 */
function findBracket<T extends { upTo: number }>(brackets: readonly T[], value: number): T {
  const bracket = brackets.find((b) => value <= b.upTo);
  if (!bracket) {
    throw new Error(`速算表に該当区分がありません(value=${value})。最終区分は upTo:Infinity が必要です。`);
  }
  return bracket;
}

// ---------------------------------------------------------------------------
// 給与所得控除 / 給与所得
// ---------------------------------------------------------------------------

/**
 * 給与所得控除額(円)を速算表から求める。
 * 控除額 = 給与収入 × rate + constant。
 */
export function calcSalaryIncomeDeduction(grossSalaryYen: number): number {
  const bracket = findBracket(SALARY_INCOME_DEDUCTION, grossSalaryYen);
  const deduction = grossSalaryYen * bracket.rate + bracket.constant;
  return floorYen(deduction);
}

/**
 * 給与所得(円)= 給与収入 − 給与所得控除。0 未満は 0 とする。
 */
export function calcSalaryIncome(grossSalaryYen: number): number {
  return Math.max(0, grossSalaryYen - calcSalaryIncomeDeduction(grossSalaryYen));
}

// ---------------------------------------------------------------------------
// 社会保険料(健康保険・厚生年金・雇用保険)
// ---------------------------------------------------------------------------

/** 社会保険料の内訳(円)。いずれも被保険者負担分。 */
export interface SocialInsuranceBreakdown {
  /** 健康保険料。 */
  health: number;
  /** 厚生年金保険料。 */
  pension: number;
  /** 雇用保険料。 */
  employment: number;
  /** 合計(= health + pension + employment)。 */
  total: number;
}

/**
 * 社会保険料(円)を種別ごとに概算する。
 * 各種別 = 給与収入 × 種別料率。合計が年間上限を超える場合は各種別を按分して上限に収める
 * (内訳の合計と total が一致するように比例縮小する)。
 */
export function calcSocialInsurance(grossSalaryYen: number): SocialInsuranceBreakdown {
  const { rates, annualCap } = SOCIAL_INSURANCE;

  let health = grossSalaryYen * rates.health;
  let pension = grossSalaryYen * rates.pension;
  let employment = grossSalaryYen * rates.employment;
  const total = health + pension + employment;

  if (total > annualCap) {
    // 標準報酬月額の上限に相当する概算キャップ。各種別を按分して縮小する。
    const scale = annualCap / total;
    health *= scale;
    pension *= scale;
    employment *= scale;
  }

  // 各種別を円未満切り捨てし、合計は内訳の和とする(内訳と total が常に一致するように)。
  const healthYen = floorYen(health);
  const pensionYen = floorYen(pension);
  const employmentYen = floorYen(employment);

  return {
    health: healthYen,
    pension: pensionYen,
    employment: employmentYen,
    total: healthYen + pensionYen + employmentYen,
  };
}

// ---------------------------------------------------------------------------
// 所得控除(基礎・配偶者・扶養)
// ---------------------------------------------------------------------------

/** 人的控除の適用条件。 */
export interface PersonalDeductionOptions {
  /** 配偶者控除を適用するか(配偶者が控除対象=所得要件を満たす前提)。 */
  hasSpouseDeduction?: boolean;
  /** 扶養控除の対象となる扶養親族の区分リスト(16 歳未満は児童手当の対象のため含めない)。 */
  dependents?: DependentCategory[];
}

/** 所得税・住民税それぞれの人的控除合計(円)。 */
interface PersonalDeductions {
  incomeTax: number;
  residentTax: number;
}

/**
 * 基礎控除 + 配偶者控除 + 扶養控除の合計(円)を所得税・住民税それぞれで求める。
 */
function calcPersonalDeductions(options: PersonalDeductionOptions = {}): PersonalDeductions {
  const { hasSpouseDeduction = false, dependents = [] } = options;

  let incomeTax = BASIC_DEDUCTION.incomeTax;
  let residentTax = BASIC_DEDUCTION.residentTax;

  if (hasSpouseDeduction) {
    incomeTax += SPOUSE_DEDUCTION.incomeTax;
    residentTax += SPOUSE_DEDUCTION.residentTax;
  }

  for (const category of dependents) {
    incomeTax += DEPENDENT_DEDUCTION[category].incomeTax;
    residentTax += DEPENDENT_DEDUCTION[category].residentTax;
  }

  return { incomeTax, residentTax };
}

// ---------------------------------------------------------------------------
// 所得税 / 住民税
// ---------------------------------------------------------------------------

/**
 * 所得税(円。復興特別所得税 2.1% を含む)を超過累進税率の速算表から求める。
 * 税額 = 課税所得 × rate − deduction。課税所得は 1,000 円未満を切り捨てる。
 */
export function calcIncomeTax(taxableIncomeYen: number): number {
  const taxable = Math.max(0, roundDownTo1000(taxableIncomeYen));
  if (taxable === 0) return 0;

  const bracket = findBracket(INCOME_TAX_BRACKETS, taxable);
  const baseTax = Math.max(0, taxable * bracket.rate - bracket.deduction);
  const withSurtax = baseTax * (1 + RECONSTRUCTION_SURTAX_RATE);
  return floorYen(withSurtax);
}

/**
 * 住民税(円)= 所得割(課税所得 × 10%)+ 均等割。
 * 課税所得が 0 以下のときは非課税とみなし、均等割も課さない(簡易化。地域差・調整控除は考慮しない)。
 */
export function calcResidentTax(taxableIncomeYen: number): number {
  const taxable = Math.max(0, roundDownTo1000(taxableIncomeYen));
  if (taxable === 0) return 0;

  const incomeLevy = floorYen(taxable * RESIDENT_TAX.incomeRate);
  return incomeLevy + RESIDENT_TAX.perCapita;
}

// ---------------------------------------------------------------------------
// 給与の税・社会保険料の総合計算
// ---------------------------------------------------------------------------

/** 給与所得者の税・社会保険料計算の入力(金額は万円)。 */
export interface SalaryTaxInput extends PersonalDeductionOptions {
  /** 額面給与(年額・万円)。 */
  grossSalary: number;
}

/** 給与所得者の税・社会保険料計算の結果(金額は万円)。 */
export interface SalaryTaxResult {
  /** 控除内訳(所得税・住民税・社会保険料の内訳)。 */
  breakdown: TaxBreakdown;
  /** 手取り給与(額面 − 所得税 − 住民税 − 社会保険料)。 */
  netSalary: number;
}

/**
 * 額面給与から、所得税・住民税・社会保険料の内訳(TaxBreakdown)と手取り給与を求める。
 *
 * 課税所得 = 給与所得 − 社会保険料控除 − 基礎控除 − 配偶者控除 − 扶養控除。
 * 社会保険料控除は所得税・住民税とも社会保険料の全額を対象とする。
 */
export function calcSalaryTax(input: SalaryTaxInput): SalaryTaxResult {
  const grossYen = toYen(input.grossSalary);

  const salaryIncome = calcSalaryIncome(grossYen);
  const social = calcSocialInsurance(grossYen);
  const deductions = calcPersonalDeductions(input);

  const incomeTaxable = salaryIncome - social.total - deductions.incomeTax;
  const residentTaxable = salaryIncome - social.total - deductions.residentTax;

  const incomeTaxYen = calcIncomeTax(incomeTaxable);
  const residentTaxYen = calcResidentTax(residentTaxable);

  const netYen = grossYen - incomeTaxYen - residentTaxYen - social.total;

  const breakdown: TaxBreakdown = {
    incomeTax: toManyen(incomeTaxYen),
    residentTax: toManyen(residentTaxYen),
    healthInsurance: toManyen(social.health),
    pensionInsurance: toManyen(social.pension),
    employmentInsurance: toManyen(social.employment),
    socialInsurance: toManyen(social.total),
  };

  return { breakdown, netSalary: toManyen(netYen) };
}

/**
 * 手取り給与(万円)だけを返すユーティリティ(額面 − 所得税 − 住民税 − 社会保険料)。
 */
export function calcNetSalary(input: SalaryTaxInput): number {
  return calcSalaryTax(input).netSalary;
}

// ---------------------------------------------------------------------------
// 児童手当
// ---------------------------------------------------------------------------

/**
 * 児童手当の年額(円)を子どもの年齢一覧から求める。
 *
 * - 対象は高校生年代まで(0〜18 歳)。それ以外の年齢は支給対象外。
 * - 第3子以降は年齢区分によらず一律の加算額(月額)を適用する。
 *   出生順は「支給対象の子ども」を年齢の高い順に数えた順位で判定する(簡易化)。
 */
export function calcChildAllowance(childAges: number[]): number {
  const maxAge = CHILD_ALLOWANCE.reduce((max, b) => Math.max(max, b.toAge), 0);

  // 支給対象(高校生年代まで)を年齢の高い順に並べ、出生順の代理とする。
  const eligible = childAges.filter((age) => age >= 0 && age <= maxAge).sort((a, b) => b - a);

  let annualYen = 0;
  eligible.forEach((age, index) => {
    const birthOrder = index + 1; // 1 = 第1子
    let monthly: number;
    if (birthOrder >= 3) {
      monthly = CHILD_ALLOWANCE_THIRD_CHILD_MONTHLY;
    } else {
      const bracket = CHILD_ALLOWANCE.find((b) => age >= b.fromAge && age <= b.toAge);
      monthly = bracket?.monthlyAmount ?? 0;
    }
    annualYen += monthly * 12;
  });

  return annualYen;
}

/** 児童手当の年額(万円)。 */
export function calcChildAllowanceManyen(childAges: number[]): number {
  return toManyen(calcChildAllowance(childAges));
}

// ---------------------------------------------------------------------------
// 公的年金等控除 / 年金受給の簡易計算
// ---------------------------------------------------------------------------

/**
 * 公的年金等控除額(円)を年齢と年金収入から求める。
 * 65 歳未満・65 歳以上で速算表が異なる(公的年金等以外の所得なしを前提とした簡易表)。
 */
export function calcPensionDeduction(pensionIncomeYen: number, age: number): number {
  const table = age >= 65 ? PENSION_DEDUCTION.from65 : PENSION_DEDUCTION.under65;
  const bracket = findBracket(table, pensionIncomeYen);
  const deduction = pensionIncomeYen * bracket.rate + bracket.constant;
  return floorYen(deduction);
}

/**
 * 公的年金等に係る雑所得(円)= 年金収入 − 公的年金等控除。0 未満は 0。
 */
export function calcPensionTaxableIncome(pensionIncomeYen: number, age: number): number {
  return Math.max(0, pensionIncomeYen - calcPensionDeduction(pensionIncomeYen, age));
}

/** 年金受給の税計算の入力(金額は万円)。 */
export interface PensionTaxInput extends PersonalDeductionOptions {
  /** 公的年金の受給額(年額・万円)。 */
  pension: number;
  /** 受給者の年齢(歳)。65 歳以上で控除額が変わる。 */
  age: number;
}

/** 年金受給の税計算の結果(金額は万円)。 */
export interface PensionTaxResult {
  /** 所得税(復興特別所得税を含む)。 */
  incomeTax: number;
  /** 住民税(所得割 + 均等割)。 */
  residentTax: number;
  /** 手取り年金(受給額 − 所得税 − 住民税)。 */
  netPension: number;
}

/**
 * 公的年金受給の手取りを簡易計算する(所得は公的年金等のみ・社会保険料控除は考慮しない簡易モデル)。
 *
 * 雑所得 = 年金収入 − 公的年金等控除。課税所得 = 雑所得 − 基礎控除 − 配偶者控除 − 扶養控除。
 */
export function calcPensionTax(input: PensionTaxInput): PensionTaxResult {
  const pensionYen = toYen(input.pension);
  const taxableIncome = calcPensionTaxableIncome(pensionYen, input.age);
  const deductions = calcPersonalDeductions(input);

  const incomeTaxYen = calcIncomeTax(taxableIncome - deductions.incomeTax);
  const residentTaxYen = calcResidentTax(taxableIncome - deductions.residentTax);
  const netYen = pensionYen - incomeTaxYen - residentTaxYen;

  return {
    incomeTax: toManyen(incomeTaxYen),
    residentTax: toManyen(residentTaxYen),
    netPension: toManyen(netYen),
  };
}
