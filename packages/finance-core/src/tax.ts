/**
 * 税・社会保険料・関連給付の簡易計算(給与所得者・個人事業主。SPEC.md 2.3.2 / 2.3.4 / F-08)。
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
  BLUE_RETURN_DEDUCTION,
  CARE_INSURANCE_AGE,
  CHILD_ALLOWANCE,
  CHILD_ALLOWANCE_THIRD_CHILD_MONTHLY,
  DEPENDENT_DEDUCTION,
  INCOME_TAX_BRACKETS,
  NATIONAL_HEALTH_INSURANCE,
  NATIONAL_PENSION,
  PENSION_DEDUCTION,
  PENSION_ESTIMATE,
  RECONSTRUCTION_SURTAX_RATE,
  RESIDENT_TAX,
  RETIREMENT_INCOME_DEDUCTION,
  RETIREMENT_INCOME_TAXABLE_RATE,
  SALARY_INCOME_DEDUCTION,
  SOCIAL_INSURANCE,
  SPOUSE_DEDUCTION,
  type DependentCategory,
  type NhiCategoryRate,
} from './constants';
import { fromYen, manyen, percent, years, type CalcNode, type FormulaPart } from './explain';
import type { IncomeInput, TaxBreakdown } from './types';

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
 * 介護保険第2号被保険者(40〜64歳)に該当するかを判定する。
 * 該当する年は健康保険料・国民健康保険料に介護分が上乗せされる。
 * `age` が未指定(undefined)の場合は判定できないため false(介護分を課さない)とする。
 */
function isCareInsuranceAge(age: number | undefined): boolean {
  if (age === undefined) return false;
  return age >= CARE_INSURANCE_AGE.from && age <= CARE_INSURANCE_AGE.to;
}

/**
 * `upTo` の昇順に並んだ速算表から、value が属する区分を返す。
 * 速算表の最終区分は必ず `upTo: Infinity` のため、有限の value では必ず一致する。
 */
function findBracket<T extends { upTo: number }>(brackets: readonly T[], value: number): T {
  const bracket = brackets.find((b) => value <= b.upTo);
  if (!bracket) {
    throw new Error(
      `速算表に該当区分がありません(value=${value})。最終区分は upTo:Infinity が必要です。`,
    );
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
 *
 * @param grossSalaryYen 額面給与(円)。
 * @param age 本人の年齢(歳)。40〜64歳の年は健康保険料に介護保険料(介護分)を上乗せする。
 *   未指定の場合は介護分を課さない。
 */
export function calcSocialInsurance(
  grossSalaryYen: number,
  age?: number,
): SocialInsuranceBreakdown {
  const { rates, careRate, annualCap } = SOCIAL_INSURANCE;

  // 40〜64歳(介護保険第2号被保険者)は健康保険料率に介護保険料率を上乗せする。
  const healthRate = rates.health + (isCareInsuranceAge(age) ? careRate : 0);
  let health = grossSalaryYen * healthRate;
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
  /**
   * 小規模企業共済等掛金控除(万円、#73)。iDeCo・小規模企業共済の当年拠出額。
   * 全額が所得控除となり、所得税・住民税の両方の課税所得から差し引く。未指定は 0(控除なし)。
   */
  smallBusinessMutualAidDeduction?: number;
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
  const {
    hasSpouseDeduction = false,
    dependents = [],
    smallBusinessMutualAidDeduction = 0,
  } = options;

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

  // 小規模企業共済等掛金控除(#73): iDeCo・小規模企業共済の拠出額を全額、所得税・住民税とも控除する。
  const mutualAidYen = toYen(Math.max(0, smallBusinessMutualAidDeduction));
  incomeTax += mutualAidYen;
  residentTax += mutualAidYen;

  return { incomeTax, residentTax };
}

/** 扶養控除区分の表示名(計算根拠ノード用)。 */
const DEPENDENT_CATEGORY_LABEL: Record<DependentCategory, string> = {
  general: '一般',
  specific: '特定',
  elderly: '老人',
};

/**
 * 人的控除(基礎・配偶者・扶養・小規模企業共済等掛金控除)の計算根拠ノード一覧を作る。
 * ノードの値の合計は `calcPersonalDeductions` の該当側(`kind`)と一致する。
 */
function personalDeductionNodes(
  options: PersonalDeductionOptions = {},
  kind: 'incomeTax' | 'residentTax',
): CalcNode[] {
  const {
    hasSpouseDeduction = false,
    dependents = [],
    smallBusinessMutualAidDeduction = 0,
  } = options;

  const nodes: CalcNode[] = [fromYen('基礎控除', BASIC_DEDUCTION[kind])];
  if (hasSpouseDeduction) nodes.push(fromYen('配偶者控除', SPOUSE_DEDUCTION[kind]));
  for (const category of ['general', 'specific', 'elderly'] as const) {
    const count = dependents.filter((c) => c === category).length;
    if (count === 0) continue;
    const suffix = count > 1 ? `×${count}` : '';
    nodes.push(
      fromYen(
        `扶養控除(${DEPENDENT_CATEGORY_LABEL[category]}${suffix})`,
        DEPENDENT_DEDUCTION[category][kind] * count,
      ),
    );
  }
  const mutualAid = Math.max(0, smallBusinessMutualAidDeduction);
  if (mutualAid > 0) nodes.push(manyen('小規模企業共済等掛金控除(iDeCo等)', mutualAid));
  return nodes;
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
// 計算根拠(Detailed 版)の共通ヘルパー(explain.ts の移行規約に従う)
// ---------------------------------------------------------------------------

/** 率(小数)を表示用の % 数値に直す(0.021 → 2.1。浮動小数の桁ゴミは表示側で丸める)。 */
const toPercent = (rate: number): number => rate * 100;

/** 率(小数)を式リテラルに埋め込む % 表記に整形する(例: 0.0915 → '9.15%')。 */
const percentLabel = (rate: number): string =>
  `${toPercent(rate).toLocaleString('ja-JP', { maximumFractionDigits: 3 })}%`;

/** 復興特別所得税を含むことを式に付記するリテラル。 */
const surtaxNote = (): string => `(復興特別所得税${percentLabel(RECONSTRUCTION_SURTAX_RATE)}込)`;

/**
 * 課税所得ノードを作る。値は課税標準の丸め(1,000円未満切捨て・0未満は0)を適用した後の額にし、
 * 丸めの存在は式のリテラルで付記する(式の各項の計算値とのずれを説明する)。
 */
function taxableIncomeNode(label: string, taxableYen: number, terms: FormulaPart[]): CalcNode {
  return fromYen(label, Math.max(0, roundDownTo1000(taxableYen)), {
    formula: [...terms, '(1,000円未満切捨て・0未満は0)'],
  });
}

/**
 * `calcIncomeTax` の計算根拠つき版。課税標準の項として `taxableNode` を式に埋め込む
 * (給与・事業・年金・退職所得の各所得税で共用する)。
 */
export function calcIncomeTaxDetailed(taxableIncomeYen: number, taxableNode: CalcNode): CalcNode {
  const taxable = Math.max(0, roundDownTo1000(taxableIncomeYen));
  const incomeTaxYen = calcIncomeTax(taxableIncomeYen);
  if (taxable === 0) {
    return fromYen('所得税', incomeTaxYen, {
      formula: [`${taxableNode.label}が0円のため非課税`],
    });
  }
  const bracket = findBracket(INCOME_TAX_BRACKETS, taxable);
  return fromYen('所得税', incomeTaxYen, {
    formula: [
      { node: taxableNode },
      { op: '×', node: percent('所得税率', toPercent(bracket.rate)) },
      { op: '−', node: fromYen('速算控除額', bracket.deduction) },
      surtaxNote(),
    ],
  });
}

// ---------------------------------------------------------------------------
// 給与の税・社会保険料の総合計算
// ---------------------------------------------------------------------------

/** 給与所得者の税・社会保険料計算の入力(金額は万円)。 */
export interface SalaryTaxInput extends PersonalDeductionOptions {
  /** 額面給与(年額・万円)。 */
  grossSalary: number;
  /** 本人の年齢(歳)。40〜64歳の年は健康保険料に介護分が上乗せされる。未指定なら介護分なし。 */
  age?: number;
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
  return calcSalaryTaxDetailed(input).result;
}

/** 給与所得控除の計算根拠ノード。速算表の該当区分の式を表示する。 */
function salaryIncomeDeductionNode(grossSalaryYen: number): CalcNode {
  const bracket = findBracket(SALARY_INCOME_DEDUCTION, grossSalaryYen);
  const constantMan = toManyen(Math.abs(bracket.constant));
  const formula: FormulaPart[] =
    bracket.rate > 0
      ? [
          `給与収入 × ${percentLabel(bracket.rate)} ${bracket.constant >= 0 ? '+' : '−'} ${constantMan}万円(速算表)`,
        ]
      : [`${constantMan}万円(速算表の定額区分)`];
  return fromYen('給与所得控除', calcSalaryIncomeDeduction(grossSalaryYen), { formula });
}

/** `calcSalaryTax` の計算根拠つき版の結果。 */
export interface SalaryTaxDetailedResult {
  result: SalaryTaxResult;
  /** 出力フィールドごとの計算根拠(段階的移行中。現状は所得税のみ)。 */
  explain: { incomeTax: CalcNode };
}

/**
 * `calcSalaryTax` の計算根拠つき版。給与税の算術の本体はこちらに置き、
 * legacy 関数は `.result` を返すラッパーにする(移行規約)。
 */
export function calcSalaryTaxDetailed(input: SalaryTaxInput): SalaryTaxDetailedResult {
  const grossYen = toYen(input.grossSalary);

  const salaryIncome = calcSalaryIncome(grossYen);
  const social = calcSocialInsurance(grossYen, input.age);
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
  const result: SalaryTaxResult = { breakdown, netSalary: toManyen(netYen) };

  // --- 計算根拠ツリー(所得税): 課税所得(給与) = 給与所得 − 社会保険料控除 − 人的控除 ---
  const salaryIncomeNode = fromYen('給与所得', salaryIncome, {
    formula: [
      { node: fromYen('給与収入(額面)', grossYen) },
      { op: '−', node: salaryIncomeDeductionNode(grossYen) },
      '(0未満は0)',
    ],
  });
  const socialNode = fromYen('社会保険料控除', social.total, {
    formula: [
      { node: fromYen('健康保険', social.health) },
      { op: '+', node: fromYen('厚生年金', social.pension) },
      { op: '+', node: fromYen('雇用保険', social.employment) },
      '(給与収入 × 概算料率)',
    ],
  });
  const taxableNode = taxableIncomeNode('課税所得(給与)', incomeTaxable, [
    { node: salaryIncomeNode },
    { op: '−', node: socialNode },
    ...personalDeductionNodes(input, 'incomeTax').map((node) => ({ op: '−', node })),
  ]);

  return { result, explain: { incomeTax: calcIncomeTaxDetailed(incomeTaxable, taxableNode) } };
}

/**
 * 手取り給与(万円)だけを返すユーティリティ(額面 − 所得税 − 住民税 − 社会保険料)。
 */
export function calcNetSalary(input: SalaryTaxInput): number {
  return calcSalaryTax(input).netSalary;
}

// ---------------------------------------------------------------------------
// 個人事業主の税・社会保険料の総合計算
// ---------------------------------------------------------------------------

/**
 * 事業所得(円)= 事業所得(売上 − 経費)− 青色申告特別控除。0 未満は 0 とする。
 */
export function calcBusinessIncome(businessIncomeYen: number): number {
  return Math.max(0, businessIncomeYen - BLUE_RETURN_DEDUCTION);
}

/**
 * 国民健康保険料の1区分(円)を求める。
 * 所得割 = (所得 − 基礎控除)× incomeRate、均等割 = perCapita(本人1人分)。区分ごとの賦課限度額で頭打ち。
 */
function calcNhiCategory(baseYen: number, category: NhiCategoryRate): number {
  const premium = baseYen * category.incomeRate + category.perCapita;
  return Math.min(premium, category.annualCap);
}

/**
 * 国民健康保険料(円)を概算する。
 * 区分(医療分・後期高齢者支援金分・子ども子育て支援金分・介護分)ごとに
 * 所得割 +均等割 を算定し、賦課限度額は区分ごとに独立して適用する。
 *
 * @param incomeYen 算定基礎となる所得(円)。青色申告特別控除後の事業所得を渡す。
 * @param age 本人の年齢(歳)。40〜64歳の年のみ介護分を賦課する。未指定の場合は介護分を課さない。
 */
export function calcNationalHealthInsurance(incomeYen: number, age?: number): number {
  const { deduction, medical, elderlySupport, childRearingSupport, care } =
    NATIONAL_HEALTH_INSURANCE;
  const base = Math.max(0, incomeYen - deduction);

  let premium =
    calcNhiCategory(base, medical) +
    calcNhiCategory(base, elderlySupport) +
    calcNhiCategory(base, childRearingSupport);

  // 40〜64歳(介護保険第2号被保険者)の年のみ介護分を賦課する。
  if (isCareInsuranceAge(age)) {
    premium += calcNhiCategory(base, care);
  }

  return floorYen(premium);
}

/**
 * 個人事業主の社会保険料(円)= 国民健康保険 + 国民年金(定額)。
 * 雇用保険・厚生年金には加入しないため 0。`SocialInsuranceBreakdown` の
 * `health` に国保、`pension` に国民年金を割り当てる。
 *
 * @param incomeYen 国保の算定基礎となる所得(円)。青色申告特別控除後の事業所得を渡す。
 * @param age 本人の年齢(歳)。40〜64歳の年は国保に介護分が加わる。未指定の場合は介護分を課さない。
 */
export function calcSelfEmployedSocialInsurance(
  incomeYen: number,
  age?: number,
): SocialInsuranceBreakdown {
  const health = calcNationalHealthInsurance(incomeYen, age);
  const pension = NATIONAL_PENSION.annualAmount;
  return { health, pension, employment: 0, total: health + pension };
}

/** 個人事業主の税・社会保険料計算の入力(金額は万円)。 */
export interface SelfEmployedTaxInput extends PersonalDeductionOptions {
  /** 事業所得(売上 − 経費。年額・万円)。 */
  businessIncome: number;
  /** 本人の年齢(歳)。40〜64歳の年は国民健康保険に介護分が加わる。未指定なら介護分なし。 */
  age?: number;
}

/** 個人事業主の税・社会保険料計算の結果(金額は万円)。 */
export interface SelfEmployedTaxResult {
  /** 控除内訳(healthInsurance = 国民健康保険、pensionInsurance = 国民年金、雇用保険は 0)。 */
  breakdown: TaxBreakdown;
  /** 手取り(事業所得 − 所得税 − 住民税 − 国保 − 国民年金)。 */
  netIncome: number;
}

/**
 * 個人事業主(青色申告)の事業所得から、税・社会保険料の内訳と手取りを求める。
 *
 * 所得 = 事業所得 − 青色申告特別控除(65万円)。
 * 課税所得 = 所得 − 社会保険料控除(国保 + 国民年金)− 基礎控除 − 配偶者控除 − 扶養控除。
 * 所得税・住民税は給与所得者と同じ累進課税ロジックを流用する。
 */
export function calcSelfEmployedTax(input: SelfEmployedTaxInput): SelfEmployedTaxResult {
  return calcSelfEmployedTaxDetailed(input).result;
}

/** `calcSelfEmployedTax` の計算根拠つき版の結果。 */
export interface SelfEmployedTaxDetailedResult {
  result: SelfEmployedTaxResult;
  /** 出力フィールドごとの計算根拠(段階的移行中。現状は所得税のみ)。 */
  explain: { incomeTax: CalcNode };
}

/**
 * `calcSelfEmployedTax` の計算根拠つき版。事業税の算術の本体はこちらに置き、
 * legacy 関数は `.result` を返すラッパーにする(移行規約)。
 */
export function calcSelfEmployedTaxDetailed(
  input: SelfEmployedTaxInput,
): SelfEmployedTaxDetailedResult {
  const grossYen = toYen(input.businessIncome);

  const businessIncome = calcBusinessIncome(grossYen);
  const social = calcSelfEmployedSocialInsurance(businessIncome, input.age);
  const deductions = calcPersonalDeductions(input);

  const incomeTaxable = businessIncome - social.total - deductions.incomeTax;
  const residentTaxable = businessIncome - social.total - deductions.residentTax;

  const incomeTaxYen = calcIncomeTax(incomeTaxable);
  const residentTaxYen = calcResidentTax(residentTaxable);

  const netYen = grossYen - incomeTaxYen - residentTaxYen - social.total;

  const breakdown: TaxBreakdown = {
    incomeTax: toManyen(incomeTaxYen),
    residentTax: toManyen(residentTaxYen),
    healthInsurance: toManyen(social.health),
    pensionInsurance: toManyen(social.pension),
    employmentInsurance: 0,
    socialInsurance: toManyen(social.total),
  };
  const result: SelfEmployedTaxResult = { breakdown, netIncome: toManyen(netYen) };

  // --- 計算根拠ツリー(所得税): 課税所得(事業) = 控除後所得 − 社会保険料控除 − 人的控除 ---
  const businessIncomeNode = fromYen('青色申告特別控除後の所得', businessIncome, {
    formula: [
      { node: fromYen('事業所得(売上 − 経費)', grossYen) },
      { op: '−', node: fromYen('青色申告特別控除', BLUE_RETURN_DEDUCTION) },
      '(0未満は0)',
    ],
  });
  const socialNode = fromYen('社会保険料控除', social.total, {
    formula: [
      {
        node: fromYen('国民健康保険', social.health, {
          formula: ['所得に応じた概算(所得割 + 均等割。区分ごとの限度額あり)'],
        }),
      },
      {
        op: '+',
        node: fromYen('国民年金', social.pension, { formula: ['定額(月額 × 12ヶ月)'] }),
      },
    ],
  });
  const taxableNode = taxableIncomeNode('課税所得(事業)', incomeTaxable, [
    { node: businessIncomeNode },
    { op: '−', node: socialNode },
    ...personalDeductionNodes(input, 'incomeTax').map((node) => ({ op: '−', node })),
  ]);

  return { result, explain: { incomeTax: calcIncomeTaxDetailed(incomeTaxable, taxableNode) } };
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
  return calcPensionTaxDetailed(input).result;
}

/** `calcPensionTax` の計算根拠つき版の結果。 */
export interface PensionTaxDetailedResult {
  result: PensionTaxResult;
  /** 出力フィールドごとの計算根拠(段階的移行中。現状は所得税のみ)。 */
  explain: { incomeTax: CalcNode };
}

/**
 * `calcPensionTax` の計算根拠つき版。年金税の算術の本体はこちらに置き、
 * legacy 関数は `.result` を返すラッパーにする(移行規約)。
 */
export function calcPensionTaxDetailed(input: PensionTaxInput): PensionTaxDetailedResult {
  const pensionYen = toYen(input.pension);
  const taxableIncome = calcPensionTaxableIncome(pensionYen, input.age);
  const deductions = calcPersonalDeductions(input);

  const incomeTaxYen = calcIncomeTax(taxableIncome - deductions.incomeTax);
  const residentTaxYen = calcResidentTax(taxableIncome - deductions.residentTax);
  const netYen = pensionYen - incomeTaxYen - residentTaxYen;

  const result: PensionTaxResult = {
    incomeTax: toManyen(incomeTaxYen),
    residentTax: toManyen(residentTaxYen),
    netPension: toManyen(netYen),
  };

  // --- 計算根拠ツリー(所得税): 課税所得(年金) = 雑所得(収入 − 公的年金等控除) − 人的控除 ---
  const table = input.age >= 65 ? PENSION_DEDUCTION.from65 : PENSION_DEDUCTION.under65;
  const bracket = findBracket(table, pensionYen);
  const pensionDeductionNode = fromYen('公的年金等控除', calcPensionDeduction(pensionYen, input.age), {
    formula: [
      bracket.rate > 0
        ? `年金収入 × ${percentLabel(bracket.rate)} + ${toManyen(bracket.constant)}万円`
        : `${toManyen(bracket.constant)}万円(定額区分)`,
      `(${input.age >= 65 ? '65歳以上' : '65歳未満'}の速算表)`,
    ],
  });
  const miscIncomeNode = fromYen('公的年金等の雑所得', taxableIncome, {
    formula: [
      { node: fromYen('年金収入(額面)', pensionYen) },
      { op: '−', node: pensionDeductionNode },
      '(0未満は0)',
    ],
  });
  const taxableNode = taxableIncomeNode('課税所得(年金)', taxableIncome - deductions.incomeTax, [
    { node: miscIncomeNode },
    ...personalDeductionNodes(input, 'incomeTax').map((node) => ({ op: '−', node })),
  ]);

  return {
    result,
    explain: { incomeTax: calcIncomeTaxDetailed(taxableIncome - deductions.incomeTax, taxableNode) },
  };
}

// ---------------------------------------------------------------------------
// 公的年金受給額の推定(就労履歴からの概算。#21)
// ---------------------------------------------------------------------------

/** 年率(%)を年数 n 分だけ複利で成長させる係数(推定用の平均年収の算定に使う)。 */
const growthFactor = (ratePercent: number, years: number): number =>
  Math.pow(1 + ratePercent / 100, years);

/**
 * 就労履歴(働き方期間)から公的年金の受給額(年額・万円)を概算する(#21)。
 *
 * 老齢基礎年金 + 老齢厚生年金の簡易モデル:
 * - **老齢基礎年金**: 全就労期間(会社員・個人事業主とも)のうち加入対象年齢
 *   (20歳以上60歳未満)に重なる年数を合算(40年で頭打ち)し、満額 × 加入年数 / 40 で概算する。
 * - **老齢厚生年金(報酬比例)**: 会社員期間ごとに 平均年収 × 乗率 × 加入年数 を合算する。
 *   平均年収は期間の開始年収を昇給率で期間の中央年まで成長させた値とする。個人事業主期間は
 *   厚生年金に加入しないため対象外。
 *
 * 期間は重複しない前提(UI でバリデーション)。実際の年金額とは異なる概算である(SPEC.md 1.4)。
 *
 * @param income 収入情報(働き方期間を参照する)。
 * @returns 推定した公的年金の年額(万円)。就労期間が無ければ 0。
 */
export function estimatePension(income: IncomeInput): number {
  const { basicFullAnnual, basicFullYears, basicCoverageAge, employeeAccrualRate } =
    PENSION_ESTIMATE;

  // 老齢基礎年金: 加入対象年齢(20〜59歳)に重なる就労年数を合算し、40年で満額に達する比例配分。
  let coverageYears = 0;
  for (const p of income.workPeriods) {
    // 就労期間 [startAge, endAge](両端含む)と加入対象 [from, to)(to は含まない)の重なり年数。
    const lower = Math.max(p.startAge, basicCoverageAge.from);
    const upper = Math.min(p.endAge + 1, basicCoverageAge.to);
    coverageYears += Math.max(0, upper - lower);
  }
  const cappedCoverage = Math.min(coverageYears, basicFullYears);
  const basicYen = basicFullAnnual * (cappedCoverage / basicFullYears);

  // 老齢厚生年金(報酬比例部分): 会社員期間ごとに 平均年収 × 乗率 × 加入年数 を合算する。
  let employeeYen = 0;
  for (const p of income.workPeriods) {
    if (p.workStyle !== 'employee') continue;
    const years = p.endAge - p.startAge + 1; // 両端を含む加入年数
    if (years <= 0) continue;
    // 平均年収 = 開始年収 × 昇給率の期間中央(=(years−1)/2 年後)までの成長係数。
    const avgIncomeYen = toYen(p.income * growthFactor(p.raiseRate, (years - 1) / 2));
    employeeYen += avgIncomeYen * employeeAccrualRate * years;
  }

  return toManyen(basicYen + employeeYen);
}

// ---------------------------------------------------------------------------
// 退職所得(退職金の退職所得控除・1/2課税・分離課税)
// ---------------------------------------------------------------------------

/**
 * 退職所得控除額(円)を勤続年数から求める。
 *
 * - 勤続20年以下: 40万円 × 勤続年数(ただし最低 80万円)。
 * - 勤続20年超  : 800万円 + 70万円 ×(勤続年数 − 20年)。
 *
 * 勤続年数の1年未満の端数は切り上げる(税法の扱いに合わせる)。0 年や端数は最低 1 年として扱う。
 * 障害退職による 100万円加算・短期退職手当等の特例は考慮しない(簡易化。SPEC.md 1.4)。
 *
 * @param yearsOfService 勤続年数(年)。小数は切り上げる。
 * @returns 退職所得控除額(円)。
 */
export function calcRetirementIncomeDeduction(yearsOfService: number): number {
  const { perYearUpTo20, perYearOver20, thresholdYears, minimum } = RETIREMENT_INCOME_DEDUCTION;
  // 勤続年数の1年未満は切り上げ。勤続0年でも最低1年分として扱う。
  const years = Math.max(1, Math.ceil(yearsOfService));

  const deduction =
    years <= thresholdYears
      ? perYearUpTo20 * years
      : perYearUpTo20 * thresholdYears + perYearOver20 * (years - thresholdYears);

  return Math.max(minimum, deduction);
}

/**
 * 課税退職所得金額(円)=(退職金 − 退職所得控除)× 1/2。0 未満は 0 とする。
 *
 * この金額に対して所得税・住民税が分離課税される(他の所得と合算しない)。
 *
 * @param retirementBonusYen 退職金の収入金額(円)。
 * @param yearsOfService 勤続年数(年)。小数は切り上げる。
 * @returns 課税退職所得金額(円)。
 */
export function calcRetirementTaxableIncome(
  retirementBonusYen: number,
  yearsOfService: number,
): number {
  const afterDeduction = retirementBonusYen - calcRetirementIncomeDeduction(yearsOfService);
  return Math.max(0, afterDeduction) * RETIREMENT_INCOME_TAXABLE_RATE;
}

/** 退職金の税計算の入力(金額は万円)。 */
export interface RetirementTaxInput {
  /** 退職金の収入金額(額面・年額・万円)。 */
  retirementBonus: number;
  /** 勤続年数(年)。小数は切り上げる。 */
  yearsOfService: number;
}

/** 退職金の税計算の結果(金額は万円)。 */
export interface RetirementTaxResult {
  /** 所得税(復興特別所得税を含む。分離課税)。 */
  incomeTax: number;
  /** 住民税(所得割のみ。分離課税では均等割は課さない)。 */
  residentTax: number;
  /** 手取り退職金(退職金 − 所得税 − 住民税)。 */
  netRetirementBonus: number;
}

/**
 * 退職金に退職所得控除・1/2課税・分離課税を適用し、税額と手取りを求める。
 *
 * 課税退職所得金額 =(退職金 − 退職所得控除)× 1/2 を課税標準として:
 * - 所得税: 給与等と同じ超過累進速算表(復興特別所得税込み)を分離して適用する。
 * - 住民税: 所得割(10%)のみを課す。分離課税のため均等割は課さない。
 *
 * 他の所得(給与・年金等)とは合算しない分離課税として計算するため、引数は退職金額と
 * 勤続年数のみで完結する。この関数は #73(iDeCo・小規模企業共済の一時金)でも
 * 退職所得課税の共通ロジックとして再利用できるよう、汎用的な引数で公開している。
 *
 * @param input 退職金額(万円)と勤続年数(年)。
 * @returns 所得税・住民税・手取り退職金(いずれも万円)。
 */
export function calcRetirementTax(input: RetirementTaxInput): RetirementTaxResult {
  return calcRetirementTaxDetailed(input).result;
}

// ---------------------------------------------------------------------------
// 退職所得課税の計算根拠つき(Detailed)版(explain.ts の移行規約に従う)
// ---------------------------------------------------------------------------

/**
 * `calcRetirementIncomeDeduction` の計算根拠つき版。値の算出は legacy 関数に委譲する。
 *
 * @returns 退職所得控除のノード(万円)。勤続年数の切り上げが起きた場合のみ、勤続年数の項が
 *   切り上げの根拠(formula)を持つ(整数入力なら葉のままにしてノイズを避ける)。
 */
export function calcRetirementIncomeDeductionDetailed(yearsOfService: number): CalcNode {
  const { perYearUpTo20, perYearOver20, thresholdYears, minimum } = RETIREMENT_INCOME_DEDUCTION;
  const yearsCounted = Math.max(1, Math.ceil(yearsOfService));
  const deductionYen = calcRetirementIncomeDeduction(yearsOfService);

  const yearsNode = years('勤続年数', yearsCounted);
  if (yearsCounted !== yearsOfService) {
    yearsNode.formula = [`${yearsOfService}年 の1年未満を切り上げ(最低1年)`];
  }

  const formula: FormulaPart[] =
    yearsCounted <= thresholdYears
      ? [`${toManyen(perYearUpTo20)}万円 ×`, { node: yearsNode }]
      : [
          `${toManyen(perYearUpTo20 * thresholdYears)}万円 + ${toManyen(perYearOver20)}万円 × (`,
          { node: yearsNode },
          `− ${thresholdYears}年)`,
        ];
  if (perYearUpTo20 * yearsCounted < minimum) {
    formula.push(`(最低${toManyen(minimum)}万円を適用)`);
  }

  return fromYen('退職所得控除', deductionYen, {
    formula,
    notes: [
      {
        severity: 'info',
        text: 'iDeCo等の一時金と近い年に受け取る場合の控除枠の重複調整(10年ルール)は簡易化のため未適用',
      },
    ],
  });
}

/**
 * `calcRetirementTaxableIncome` の計算根拠つき版。値の算出は legacy 関数に委譲する。
 *
 * @returns 課税退職所得のノード(万円)。式は「(額面 − 退職所得控除) × 1/2」で、
 *   退職所得控除の項からさらにドリルダウンできる。
 */
export function calcRetirementTaxableIncomeDetailed(
  retirementBonusYen: number,
  yearsOfService: number,
): CalcNode {
  const taxableYen = calcRetirementTaxableIncome(retirementBonusYen, yearsOfService);
  const deductionNode = calcRetirementIncomeDeductionDetailed(yearsOfService);

  const formula: FormulaPart[] = [
    '(',
    { node: fromYen('退職金 額面', retirementBonusYen) },
    { op: '−', node: deductionNode },
    ') × 1/2',
  ];
  if (retirementBonusYen < calcRetirementIncomeDeduction(yearsOfService)) {
    formula.push('(0未満のため0円)');
  }

  return fromYen('課税退職所得', taxableYen, { formula });
}

/**
 * `calcRetirementTax` の計算根拠つき版。退職所得課税の算術の本体はこちらに置き、
 * legacy 関数は `.result` を返すラッパーにする(移行規約)。
 *
 * @returns `result`: 従来どおりの税額・手取り(万円)。`explain`: 手取り退職金を根とする
 *   計算根拠ツリー(額面 − 所得税 − 住民税。所得税・住民税の項からドリルダウンできる)。
 */
export function calcRetirementTaxDetailed(input: RetirementTaxInput): {
  result: RetirementTaxResult;
  explain: CalcNode;
} {
  const retirementBonusYen = toYen(input.retirementBonus);
  const taxableIncomeYen = calcRetirementTaxableIncome(retirementBonusYen, input.yearsOfService);
  const taxableNode = calcRetirementTaxableIncomeDetailed(retirementBonusYen, input.yearsOfService);

  // 所得税は給与等と同じ速算表(復興特別所得税込み)を分離適用する。課税標準は1,000円未満切り捨て。
  const taxable = roundDownTo1000(Math.max(0, taxableIncomeYen));
  const incomeTaxYen = calcIncomeTax(taxableIncomeYen);
  const incomeTaxNode = calcIncomeTaxDetailed(taxableIncomeYen, taxableNode);

  // 住民税は所得割(10%)のみ。均等割は分離課税では課さない。
  const residentTaxYen = floorYen(taxable * RESIDENT_TAX.incomeRate);
  const residentTaxNode: CalcNode =
    taxable === 0
      ? fromYen('住民税', residentTaxYen, { formula: ['課税退職所得が0円のため非課税'] })
      : fromYen('住民税', residentTaxYen, {
          formula: [
            { node: taxableNode },
            { op: '×', node: percent('住民税率(所得割)', toPercent(RESIDENT_TAX.incomeRate)) },
            '(分離課税のため均等割なし)',
          ],
        });

  const netYen = retirementBonusYen - incomeTaxYen - residentTaxYen;
  const result: RetirementTaxResult = {
    incomeTax: toManyen(incomeTaxYen),
    residentTax: toManyen(residentTaxYen),
    netRetirementBonus: toManyen(netYen),
  };

  return {
    result,
    explain: {
      label: '退職金(手取り)',
      value: result.netRetirementBonus,
      formula: [
        { node: fromYen('退職金 額面', retirementBonusYen) },
        { op: '−', node: incomeTaxNode },
        { op: '−', node: residentTaxNode },
      ],
    },
  };
}
