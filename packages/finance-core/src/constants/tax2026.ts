/**
 * 2026年度基準の税・社会保険関連の定数テーブル。
 *
 * SPEC.md 2.3.2 / 5「保守性」に基づき、税率・料率・控除額を年度別ファイルに分離する。
 * 税制改正時は本ファイルを複製して `tax2027.ts` 等を追加し、計算モジュール側で参照先を
 * 切り替えることで対応する。
 *
 * 単位について:
 * - 本ファイルの金額はすべて「円」で定義する(税法の速算表が円単位のため)。
 *   システムの基本単位である「万円」との換算は、各計算モジュール(別issue)側で行う。
 * - 率は小数(例: 0.15 = 15%)で定義する。
 *
 * ※簡易シミュレーション用の概算モデルであり、実際の税額とは異なる場合がある(SPEC.md 1.4)。
 */

// ---------------------------------------------------------------------------
// 給与所得控除(速算表)
// ---------------------------------------------------------------------------

/** 給与所得控除の速算表の1区分。給与収入(円)が upTo 以下に該当する。 */
export interface SalaryDeductionBracket {
  /** この区分の給与収入上限(円)。最上限区分は Infinity。 */
  upTo: number;
  /** 給与収入に乗じる率。 */
  rate: number;
  /** 定数控除(円)。控除額 = 収入 × rate + constant。 */
  constant: number;
}

/**
 * 給与所得控除 速算表(2020年分以降)。
 * 控除額 = min( 上限, 収入 × rate + constant )。下限は 550,000 円。
 */
export const SALARY_INCOME_DEDUCTION: readonly SalaryDeductionBracket[] = [
  { upTo: 1_625_000, rate: 0, constant: 550_000 },
  { upTo: 1_800_000, rate: 0.4, constant: -100_000 },
  { upTo: 3_600_000, rate: 0.3, constant: 80_000 },
  { upTo: 6_600_000, rate: 0.2, constant: 440_000 },
  { upTo: 8_500_000, rate: 0.1, constant: 1_100_000 },
  { upTo: Infinity, rate: 0, constant: 1_950_000 },
] as const;

// ---------------------------------------------------------------------------
// 社会保険料(概算モデル)
// ---------------------------------------------------------------------------

/**
 * 社会保険料の概算料率と上限。
 * 健康保険・厚生年金・雇用保険の被保険者負担分の合計を概算 15% とする(SPEC.md 2.3.2)。
 */
export const SOCIAL_INSURANCE = {
  /** 給与に乗じる概算料率(被保険者負担分の合計)。 */
  rate: 0.15,
  /**
   * 社会保険料の年間上限額(円)の概算。
   * 厚生年金・健康保険には標準報酬月額の上限があるため、保険料にも実質的な上限が生じる。
   */
  annualCap: 2_000_000,
} as const;

// ---------------------------------------------------------------------------
// 所得税(超過累進税率)
// ---------------------------------------------------------------------------

/** 所得税 速算表の1区分。課税所得(円)が upTo 以下に該当する。 */
export interface IncomeTaxBracket {
  /** この区分の課税所得上限(円)。最上限区分は Infinity。 */
  upTo: number;
  /** 税率。 */
  rate: number;
  /** 速算控除額(円)。税額 = 課税所得 × rate − deduction。 */
  deduction: number;
}

/** 所得税の超過累進税率 速算表(2015年分以降)。復興特別所得税は別途 rate を乗じる。 */
export const INCOME_TAX_BRACKETS: readonly IncomeTaxBracket[] = [
  { upTo: 1_950_000, rate: 0.05, deduction: 0 },
  { upTo: 3_300_000, rate: 0.1, deduction: 97_500 },
  { upTo: 6_950_000, rate: 0.2, deduction: 427_500 },
  { upTo: 9_000_000, rate: 0.23, deduction: 636_000 },
  { upTo: 18_000_000, rate: 0.33, deduction: 1_536_000 },
  { upTo: 40_000_000, rate: 0.4, deduction: 2_796_000 },
  { upTo: Infinity, rate: 0.45, deduction: 4_796_000 },
] as const;

/** 復興特別所得税の税率(基準所得税額 × 2.1%)。2037年まで課税。 */
export const RECONSTRUCTION_SURTAX_RATE = 0.021;

// ---------------------------------------------------------------------------
// 住民税
// ---------------------------------------------------------------------------

/** 住民税の定数。 */
export const RESIDENT_TAX = {
  /** 所得割の税率(道府県民税 4% + 市町村民税 6% = 10%)。 */
  incomeRate: 0.1,
  /** 均等割の年額(円。道府県民税 + 市町村民税 + 森林環境税を含む概算)。 */
  perCapita: 5_000,
} as const;

// ---------------------------------------------------------------------------
// 所得控除(基礎・配偶者・扶養)
// ---------------------------------------------------------------------------

/**
 * 基礎控除(円)。所得税と住民税で控除額が異なる。
 * 合計所得金額 2,400万円以下を前提とした基本額。
 */
export const BASIC_DEDUCTION = {
  incomeTax: 480_000,
  residentTax: 430_000,
} as const;

/**
 * 配偶者控除(円)。納税者の合計所得 900万円以下・配偶者70歳未満を前提とした基本額。
 */
export const SPOUSE_DEDUCTION = {
  incomeTax: 380_000,
  residentTax: 330_000,
} as const;

/** 扶養控除の区分。 */
export type DependentCategory = 'general' | 'specific' | 'elderly';

/**
 * 扶養控除(円)。年少扶養(16歳未満)は児童手当の対象のため控除額 0。
 * - general: 一般扶養親族(16〜18歳、23〜69歳)
 * - specific: 特定扶養親族(19〜22歳)
 * - elderly: 老人扶養親族(70歳以上、同居老親等以外)
 */
export const DEPENDENT_DEDUCTION: Record<
  DependentCategory,
  { incomeTax: number; residentTax: number }
> = {
  general: { incomeTax: 380_000, residentTax: 330_000 },
  specific: { incomeTax: 630_000, residentTax: 450_000 },
  elderly: { incomeTax: 480_000, residentTax: 380_000 },
} as const;

// ---------------------------------------------------------------------------
// 児童手当(2024年10月改正基準)
// ---------------------------------------------------------------------------

/** 児童手当の1区分。子の年齢が [fromAge, toAge] に該当する(高校生年代まで)。 */
export interface ChildAllowanceBracket {
  /** 対象年齢の下限(歳、含む)。 */
  fromAge: number;
  /** 対象年齢の上限(歳、含む)。18 は高校生年代(18歳到達年度末)を表す。 */
  toAge: number;
  /** 月額支給額(円)。 */
  monthlyAmount: number;
}

/**
 * 児童手当テーブル(2024年10月〜、所得制限撤廃)。
 * 第3子以降の加算は別途 thirdChildMonthlyAmount を用いる。
 */
export const CHILD_ALLOWANCE: readonly ChildAllowanceBracket[] = [
  { fromAge: 0, toAge: 2, monthlyAmount: 15_000 },
  { fromAge: 3, toAge: 18, monthlyAmount: 10_000 },
] as const;

/** 第3子以降の児童手当 月額(円、高校生年代まで一律)。 */
export const CHILD_ALLOWANCE_THIRD_CHILD_MONTHLY = 30_000;

// ---------------------------------------------------------------------------
// 公的年金等控除(簡易)
// ---------------------------------------------------------------------------

/** 公的年金等控除の1区分。年金収入(円)が upTo 以下に該当する。 */
export interface PensionDeductionBracket {
  /** この区分の公的年金等の収入上限(円)。最上限区分は Infinity。 */
  upTo: number;
  /** 年金収入に乗じる率。 */
  rate: number;
  /** 定数控除(円)。控除額 = 収入 × rate + constant。 */
  constant: number;
}

/**
 * 公的年金等控除の簡易速算表(合計所得1,000万円以下、公的年金等以外の所得なしを前提)。
 * 65歳未満・65歳以上で控除額が異なる。
 */
export const PENSION_DEDUCTION = {
  /** 65歳未満。 */
  under65: [
    { upTo: 1_300_000, rate: 0, constant: 600_000 },
    { upTo: 4_100_000, rate: 0.25, constant: 275_000 },
    { upTo: 7_700_000, rate: 0.15, constant: 685_000 },
    { upTo: 10_000_000, rate: 0.05, constant: 1_455_000 },
    { upTo: Infinity, rate: 0, constant: 1_955_000 },
  ] as readonly PensionDeductionBracket[],
  /** 65歳以上。 */
  from65: [
    { upTo: 3_300_000, rate: 0, constant: 1_100_000 },
    { upTo: 4_100_000, rate: 0.25, constant: 275_000 },
    { upTo: 7_700_000, rate: 0.15, constant: 685_000 },
    { upTo: 10_000_000, rate: 0.05, constant: 1_455_000 },
    { upTo: Infinity, rate: 0, constant: 1_955_000 },
  ] as readonly PensionDeductionBracket[],
} as const;

// ---------------------------------------------------------------------------
// 投資益への課税
// ---------------------------------------------------------------------------

/**
 * 上場株式等の譲渡益・配当に対する課税率 20.315%
 * (所得税 15% + 復興特別所得税 0.315% + 住民税 5%)。NISA 枠は非課税(SPEC.md 2.3.2)。
 */
export const CAPITAL_GAINS_TAX_RATE = 0.20315;
