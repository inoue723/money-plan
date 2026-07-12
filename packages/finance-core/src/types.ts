/**
 * finance-core 入出力の型定義(SPEC.md 4.4 / 2.2 / 2.3 準拠)。
 *
 * 金額の単位はシステムの基本単位である「万円」に統一する。
 * 率(昇給率・利回り・物価上昇率)は「パーセント(%)」で保持する(例: 1.0 = 1%)。
 * ※税・社会保険の定数テーブル(constants/tax2026.ts)は税法に合わせ「円」で定義しており、
 *   万円↔円 の換算は各計算モジュール(別issue)側で行う。
 */

// ---------------------------------------------------------------------------
// 教育・家族
// ---------------------------------------------------------------------------

/** 小・中・高・未就学の進路区分。 */
export type SchoolType = 'public' | 'private';

/** 大学の進路区分(進学しない場合は 'none')。 */
export type UniversityType = 'none' | 'national' | 'privateLiberal' | 'privateScience';

/**
 * 子ども1人あたりの進路プラン。
 * 各学齢期の公立/私立を選択し、教育費モデル(SPEC.md 2.3.3)の適用に用いる。
 */
export interface EducationPlan {
  preschool: SchoolType; // 未就学(0〜5歳)
  elementary: SchoolType; // 小学校
  juniorHigh: SchoolType; // 中学校
  highSchool: SchoolType; // 高校
  university: UniversityType; // 大学
}

/**
 * 子ども(教育費・児童手当の計算対象)。
 *
 * 「すでに生まれている子ども」と「将来生まれる子ども」の両方を表す。
 * シミュレーション内部では誕生年基準(`bornAtParentAge`)で統一して扱う。
 */
export interface Child {
  /**
   * 誕生時の本人年齢(歳)。
   * 現在年齢以下なら既に生まれている子ども(現在の子ども年齢 = 現在年齢 − bornAtParentAge)、
   * 現在年齢より大きければ将来生まれる子ども。
   */
  bornAtParentAge: number;
  /** 進路プラン。 */
  education: EducationPlan;
}

// ---------------------------------------------------------------------------
// ライフイベント(判別可能union)
// ---------------------------------------------------------------------------

/** ライフイベントの種別。 */
export type LifeEventType = 'homePurchase' | 'carPurchase' | 'oneTimeExpense' | 'oneTimeIncome';

/** 全ライフイベント共通のフィールド。 */
interface LifeEventBase {
  /** 発生時の本人年齢(歳)。 */
  age: number;
}

/** 住宅購入: 頭金を一時支出、以降ローン返済を年次支出に計上し、家賃を 0 にする。 */
export interface HomePurchaseEvent extends LifeEventBase {
  type: 'homePurchase';
  /** 物件価格(万円)。 */
  price: number;
  /** 頭金(万円)。 */
  downPayment: number;
  /** ローン金利(年率 %)。 */
  loanInterestRate: number;
  /** 返済期間(年)。 */
  loanTermYears: number;
}

/** 車購入: 買替周期ごとに一時支出 + 維持費(年額)を計上する。 */
export interface CarPurchaseEvent extends LifeEventBase {
  type: 'carPurchase';
  /** 購入価格(万円)。 */
  price: number;
  /** 買替周期(年)。 */
  replacementCycleYears: number;
  /** 維持費(年額・万円)。 */
  annualMaintenance: number;
}

/** その他一時支出: 指定年に一括計上(例: 旅行、リフォーム)。 */
export interface OneTimeExpenseEvent extends LifeEventBase {
  type: 'oneTimeExpense';
  /** イベント名。 */
  name: string;
  /** 金額(万円)。 */
  amount: number;
}

/** その他一時収入: 指定年に一括計上(例: 相続、贈与)。 */
export interface OneTimeIncomeEvent extends LifeEventBase {
  type: 'oneTimeIncome';
  /** イベント名。 */
  name: string;
  /** 金額(万円)。 */
  amount: number;
}

/** ライフイベント(判別可能union)。`type` フィールドで種別を判別する。 */
export type LifeEvent =
  HomePurchaseEvent | CarPurchaseEvent | OneTimeExpenseEvent | OneTimeIncomeEvent;

// ---------------------------------------------------------------------------
// 入力(SPEC.md 4.4 SimulationInput / 2.2)
// ---------------------------------------------------------------------------

/** 配偶者情報。 */
export interface Spouse {
  /** 年齢(歳)。 */
  age: number;
  /** 年収(額面・万円)。 */
  income: number;
}

/** F-01 基本情報。 */
export interface BasicInput {
  /** 現在の年齢(歳、18〜80)。シミュレーション起点。 */
  currentAge: number;
  /** シミュレーション終了年齢(歳、〜100)。デフォルト 90。 */
  endAge: number;
  /** 現在の預金残高(万円)。 */
  savings: number;
  /** 現在の投資資産額(万円)。デフォルト 0。 */
  investments: number;
}

/** F-01 家族構成。 */
export interface FamilyInput {
  /** 配偶者(いない場合は undefined)。 */
  spouse?: Spouse;
  /** 子ども一覧。 */
  children: Child[];
}

/** 働き方の種別(会社員 / 個人事業主)。 */
export type WorkStyle = 'employee' | 'selfEmployed';

/**
 * 働き方期間(#30)。本人の収入は年齢期間ごとの働き方リストで表す
 * (例: 25〜40歳は会社員、41〜65歳は個人事業主)。
 * 期間同士は重複しない前提(UIでバリデーションする)。隙間 = 無収入期間は許容する。
 */
export interface WorkPeriod {
  /** 開始年齢(歳)。 */
  startAge: number;
  /** 終了年齢(歳、この年齢まで働く=両端を含む)。 */
  endAge: number;
  /** 働き方(会社員 / 個人事業主)。 */
  workStyle: WorkStyle;
  /**
   * 収入(年額・万円)。会社員は年収(額面)、個人事業主は事業所得(売上 − 経費)。
   * 期間の開始年齢時点の金額で、期間内は raiseRate で複利成長する。
   */
  income: number;
  /** 昇給率・収入成長率(年率 %)。期間内で複利適用。 */
  raiseRate: number;
}

/** F-02 収入情報(金額はすべて万円)。 */
export interface IncomeInput {
  /** 本人の働き方期間のリスト(重複なし。隙間 = 無収入期間は許容)。 */
  workPeriods: WorkPeriod[];
  /** 退職金(万円)。最後の会社員期間の終了翌年に一括計上。 */
  retirementBonus: number;
  /** 年金受給額(年額・万円)。全就労期間の終了翌年から受給。 */
  pension: number;
  /** その他の収入(年額・万円、手取り扱い)。 */
  other: number;
}

/** F-03 支出情報。 */
export interface ExpenseInput {
  /** 家賃(月額・万円)。持ち家の場合は 0。 */
  rent: number;
  /** 生活費(月額・万円)。 */
  living: number;
  /** 保険料(月額・万円)。 */
  insurance: number;
  /** その他固定費(月額・万円)。 */
  fixed: number;
  /** 物価上昇率(年率 %)。デフォルト 1.0。生活費・家賃に適用。 */
  inflationRate: number;
}

/** 投資の取り崩し設定。 */
export interface WithdrawalSetting {
  /** 取り崩し開始年齢(歳)。 */
  startAge: number;
  /** 年間取崩額(万円)。 */
  annualAmount: number;
}

/** F-05 投資設定。 */
export interface InvestmentInput {
  /** 毎月の積立額(万円)。デフォルト 0。 */
  monthlyAmount: number;
  /** 想定利回り(年率 %、0〜15)。デフォルト 3.0。 */
  annualReturn: number;
  /** 積立終了年齢(歳)。デフォルトは退職年齢。 */
  endAge: number;
  /** NISA 利用の有無。有の場合、非課税枠内の運用益を非課税とする。 */
  useNisa: boolean;
  /** 取り崩し設定(未設定の場合は undefined)。 */
  withdrawal?: WithdrawalSetting;
}

/** シミュレーション入力一式(SPEC.md 4.4)。 */
export interface SimulationInput {
  basic: BasicInput;
  family: FamilyInput;
  income: IncomeInput;
  expense: ExpenseInput;
  events: LifeEvent[];
  investment: InvestmentInput;
}

// ---------------------------------------------------------------------------
// 出力(SPEC.md 4.4 YearlyResult / 2.3.4)
// ---------------------------------------------------------------------------

/** 収入内訳(SPEC.md 2.3.4、金額はすべて万円)。 */
export interface IncomeBreakdown {
  /** 本人の額面収入(会社員期間は額面給与、個人事業主期間は事業所得)。 */
  grossSalary: number;
  /** 配偶者の額面給与。 */
  spouseSalary: number;
  /** 手取り収入(額面 − 所得税 − 住民税 − 社会保険料)。 */
  net: number;
  /** 公的年金の受給額。 */
  pension: number;
  /** 児童手当。 */
  childAllowance: number;
  /** その他収入(手取り扱い)。 */
  other: number;
  /** 当年の投資運用益(評価益)。 */
  investmentGain: number;
}

/**
 * 控除内訳(所得税・住民税・社会保険料。SPEC.md 2.3.4 / F-08、金額はすべて万円)。
 *
 * F-08 の年次内訳表示では社会保険料を健康保険・厚生年金・雇用保険に分けて表示するため、
 * 個別の内訳フィールドを持つ。`socialInsurance` はこれら3つの合計(後方互換のため保持)。
 */
export interface TaxBreakdown {
  /** 所得税(復興特別所得税を含む)。 */
  incomeTax: number;
  /** 住民税(所得割 + 均等割)。 */
  residentTax: number;
  /** 健康保険料(会社員: 被保険者負担分 / 個人事業主: 国民健康保険料)。 */
  healthInsurance: number;
  /** 年金保険料(会社員: 厚生年金の被保険者負担分 / 個人事業主: 国民年金)。 */
  pensionInsurance: number;
  /** 雇用保険料(被保険者負担分。個人事業主期間は 0)。 */
  employmentInsurance: number;
  /** 社会保険料合計(健康保険 + 年金 + 雇用保険。互換のため保持)。 */
  socialInsurance: number;
}

/** 支出内訳(SPEC.md 2.3.4、金額はすべて万円)。 */
export interface ExpenseBreakdown {
  /** 住居費(家賃または住宅ローン返済額)。 */
  housing: number;
  /** 生活費。 */
  living: number;
  /** 教育費。 */
  education: number;
  /** 保険料。 */
  insurance: number;
  /** その他固定費。 */
  fixed: number;
  /** ライフイベントによる一時支出。 */
  events: number;
}

/** シミュレーション結果(1年分。SPEC.md 4.4、金額はすべて万円)。 */
export interface YearlyResult {
  /** 西暦。 */
  year: number;
  /** 本人年齢(歳)。 */
  age: number;
  /** 収入内訳。 */
  income: IncomeBreakdown;
  /** 控除内訳(所得税・住民税・社会保険料)。 */
  tax: TaxBreakdown;
  /** 支出内訳。 */
  expense: ExpenseBreakdown;
  /** 年間収支。 */
  balance: number;
  /** 預金残高。 */
  savings: number;
  /** 投資資産評価額。 */
  investmentValue: number;
  /** 当年の運用益。 */
  investmentGain: number;
  /** 総資産(預金残高 + 投資資産評価額)。 */
  totalAssets: number;
  /** 当年に発生したライフイベント名。 */
  events: string[];
}

/** シミュレーション結果全体(年次結果の時系列)。 */
export type SimulationResult = YearlyResult[];
