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

/**
 * 配偶者情報(#49)。
 *
 * 収入は本人(`IncomeInput`)と完全に同等の構造で持ち、税・社会保険料は本人と同じ
 * 計算ロジックを「配偶者の年齢」を基準に適用する。`age` は起点年齢で、シミュレーション
 * 各年では `age + 経過年数` を配偶者年齢として扱う。
 */
export interface Spouse {
  /** 年齢(歳)。シミュレーション起点での配偶者年齢。 */
  age: number;
  /** 収入情報(本人と同等: 働き方期間・退職金・年金・その他収入)。 */
  income: IncomeInput;
}

/** F-01 基本情報。 */
export interface BasicInput {
  /** 現在の年齢(歳、18〜80)。シミュレーション起点。 */
  currentAge: number;
  /** シミュレーション終了年齢(歳、〜100)。デフォルト 90。 */
  endAge: number;
  /** 現在の預金残高(万円)。 */
  savings: number;
  /**
   * 計算開始年(西暦、#51)。年次計算の最初の年に対応する(CF表の先頭年)。
   * 未設定なら現在の年を起点とする(従来挙動)。年齢の起点は `currentAge` のままで、
   * この年に本人年齢 = `currentAge` とする(開始年を変えても年齢の起点は変わらない)。
   */
  startYear?: number;
  /**
   * 計算開始月(1〜12、#51)。初年はこの月から 12 月までを月割で計上する
   * (例: 7 → 初年は 7〜12 月の 6 ヶ月分として経常収支を 6/12 に按分する)。
   * 2 年目以降はつねに 12 ヶ月分。一時収支(ライフイベント・退職金)は按分せず発生年に全額計上する。
   * 未設定なら月割なし(1 月開始相当=初年もフル 12 ヶ月。従来挙動)。
   */
  startMonth?: number;
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

/** F-03 支出項目の年齢期間。本人年齢がこの範囲(両端を含む)にある年に月額を計上する。 */
export interface ExpensePeriod {
  /** 開始年齢(本人年齢・歳)。 */
  startAge: number;
  /** 終了年齢(この年齢まで計上=両端を含む)。 */
  endAge: number;
  /** 月額(万円)。 */
  monthlyAmount: number;
}

/**
 * F-03 支出項目(#31)。
 *
 * 項目名・物価上昇率(項目ごと)・年齢期間ごとの月額を持つ自由項目。
 * 物価上昇はシミュレーション起点からの経過年数で項目ごとに複利適用する。
 */
export interface ExpenseItem {
  /** 項目名(例: 家賃、生活費)。 */
  name: string;
  /** 物価上昇率(年率 %)。この項目にのみ適用。 */
  inflationRate: number;
  /** 年齢期間ごとの月額(期間の重複は不可。どの期間にも該当しない年齢は計上なし)。 */
  periods: ExpensePeriod[];
}

/**
 * 家賃期間(#50)。引っ越し等で家賃が変わる場合は複数期間で表す。
 * 本人年齢がこの範囲(両端を含む)にある年に月額を計上する。
 */
export interface RentPeriod {
  /** 開始年齢(本人年齢・歳)。 */
  startAge: number;
  /** 終了年齢(この年齢まで計上=両端を含む)。 */
  endAge: number;
  /** 月額(万円)。 */
  monthlyAmount: number;
  /** 更新料(未設定なら計上なし)。 */
  renewal?: {
    /** 何年おきに計上するか(周期年)。 */
    cycleYears: number;
    /** その時点の月額の何ヶ月分か。 */
    months: number;
  };
}

/**
 * 家賃入力(#50)。賃貸の家賃を専用の型として持つ(汎用の ExpenseItem とは別)。
 * 家賃固有の仕様(更新料・住宅購入イベント連動)を表現する。
 */
export interface RentInput {
  /** 物価上昇率(年率 %)。家賃の月額に複利適用。 */
  inflationRate: number;
  /** 家賃期間の一覧(期間の重複は不可。どの期間にも該当しない年齢は計上なし)。 */
  periods: RentPeriod[];
}

/** F-03 支出情報(#31 / #50)。家賃(専用型)+ 自由に追加できる支出項目のリスト。 */
export interface ExpenseInput {
  /** 家賃(#50)。賃貸でない(持ち家等)場合は未設定。 */
  rent?: RentInput;
  /** 支出項目の一覧。 */
  items: ExpenseItem[];
}

/**
 * 分割取崩(#69)。指定した年齢期間で、その枠の残高を**均等に取り崩し切る**設定。
 *
 * 金額の入力は持たない。毎年の取崩額は「取崩直前の評価額 ÷ 残り年数」で動的に決まる:
 * ```
 * 残り年数   = endAge − 当年年齢 + 1   (両端を含むため +1)
 * 当年の取崩額 = 取崩直前の評価額 ÷ 残り年数
 * ```
 * この式により `endAge` の年は残り年数が 1 になり、残額をすべて取り崩す(= 期間末に残高 0)。
 * 運用益が出ている間は毎年の取崩額は完全な定額にはならず、残高に応じて増減する。
 */
export interface SpreadWithdrawal {
  type: 'spread';
  /** 取り崩し開始年齢(歳。この年齢から取り崩す = 両端を含む)。 */
  startAge: number;
  /** 取り崩し終了年齢(歳。この年齢の年に残額をすべて取り崩す = 両端を含む)。 */
  endAge: number;
}

/**
 * 一括取崩(#69)。指定した年齢の年に、指定額を一度だけ取り崩す設定。
 *
 * 取崩直前の評価額が指定額に満たない場合は残高全額を取り崩す(`min(amount, 残高)`)。
 * 「残高を全額取り崩したい」場合は、残高以上の金額を入力する運用とする。
 */
export interface LumpSumWithdrawal {
  type: 'lumpSum';
  /** 取り崩す年齢(歳)。この年齢の年にのみ適用される。 */
  age: number;
  /** 取崩額(万円)。残高が足りない場合は残高全額までに制限される。 */
  amount: number;
}

/**
 * 投資の取り崩し設定(判別可能union。#69)。`type` フィールドで種別を判別する。
 *
 * 1 つの投資枠は複数の取り崩し設定を持てる(`InvestmentAccount.withdrawals`)。
 * 同一年に複数の設定が該当する場合の適用順(spread → lumpSum、同種は定義順)は
 * finance-core 側の仕様。詳細は `src/investment.ts` の冒頭コメントを参照。
 */
export type WithdrawalSetting = SpreadWithdrawal | LumpSumWithdrawal;

/** 投資口座の種別。'nisa' は非課税(NISA 上限あり)、'taxable' は課税口座(特定口座等)。 */
export type AccountType = 'nisa' | 'taxable';

/**
 * 投資枠の名義(#52)。'self' は本人、'spouse' は配偶者。
 * NISA の生涯投資枠(1800 万)・年間投資枠(360 万)は 1 人 1 口座の制度のため、
 * 名義ごとに独立して上限を適用する(本人と配偶者の枠は別々に上限を持つ)。
 */
export type AccountOwner = 'self' | 'spouse';

/**
 * F-05 投資枠(1 つの口座設定)。
 * 積立額・利回り・積立終了年齢・取り崩し設定を枠ごとに独立して持ち、独立に運用する。
 */
export interface InvestmentAccount {
  /** 枠の名前(例: NISA、特定口座)。表示・識別用。 */
  name: string;
  /** 口座種別。'nisa' は非課税(上限あり)、'taxable' は取崩時に運用益へ課税。 */
  accountType: AccountType;
  /**
   * 名義(#52)。デフォルト 'self'(本人)。NISA 枠の生涯・年間投資枠は名義ごとに独立適用する。
   * 課税口座にも名義は持つが、計算上の差は当面なし(表示・整理用)。
   */
  owner: AccountOwner;
  /**
   * 現在投資額(初期保有額・万円)。この枠がシミュレーション起点で既に保有している評価額(時価)。
   * デフォルト 0。運用・取崩の評価額の初期値になる。
   */
  initialHolding: number;
  /**
   * 取得価額(簿価・万円、#59)。この枠の初期保有分を取得したときの元本。**任意**。
   * 未指定(undefined)の場合は `initialHolding`(時価)と同値とみなす(= 含み益 0 の簡易化。
   * #46/#52 と後方互換)。時価 > 取得価額 のとき含み益があり:
   *   - NISA 枠は生涯投資枠(1800 万)を**簿価ぶんだけ**消費する(含み益は枠を消費しない)。
   *   - 課税枠は取崩時の譲渡益課税の簿価按分に用いる(含み益に正しく課税される)。
   */
  acquisitionCost?: number;
  /** 毎月の積立額(万円)。デフォルト 0。 */
  monthlyAmount: number;
  /** 想定利回り(年率 %、0〜15)。デフォルト 3.0。 */
  annualReturn: number;
  /** 積立開始年齢(歳)。この年齢「以降」に積立を開始する。デフォルトは現在年齢。 */
  startAge: number;
  /** 積立終了年齢(歳)。デフォルトは退職年齢。 */
  endAge: number;
  /**
   * 取り崩し設定のリスト(枠ごと。#69)。**空配列 = 取り崩しなし**。
   *
   * 1 つの枠に分割取崩(spread)・一括取崩(lumpSum)を任意個数・任意の組み合わせで登録できる
   * (例: 65〜85 歳の分割取崩に加えて、70 歳に一括で 300 万を取り崩す)。
   * 同一年に複数の設定が該当する場合は spread → lumpSum の順、同種は定義順に順次適用する
   * (残高 0 になったら以降の取崩額は 0)。UI 側では期間・年齢の重複を警告するが、
   * 計算側は重複入力でもクラッシュせず順次適用で処理する。
   */
  withdrawals: WithdrawalSetting[];
}

/**
 * F-05 投資設定。複数の投資枠(口座)のリストとして保持する。
 * デフォルトは現行相当の 1 枠(NISA)。各枠は独立に運用され、
 * NISA 枠には制度上の投資上限(生涯 1800 万・年間 360 万)が全 NISA 枠合算で適用される。
 */
export interface InvestmentInput {
  /** 投資枠の一覧。 */
  accounts: InvestmentAccount[];
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
  /**
   * 公的年金の受給額(額面。#79)。
   * 給与(grossSalary)と同じく額面で持ち、年金分の所得税・住民税は `tax.incomeTax` /
   * `tax.residentTax` 側に計上する(手取りは持たない)。これにより CF表の「収入合計」が
   * 純粋な額面合計になり、税を支出側に計上しても年金分の税が二重計上されない。
   */
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

/** 支出項目1つの当年計上額(年額・万円)。 */
export interface ExpenseItemAmount {
  /** 項目名(入力の ExpenseItem.name に対応)。 */
  name: string;
  /** 当年の年額(月額 × 12 × 物価上昇係数)。該当期間が無い年は 0。 */
  amount: number;
}

/**
 * 支出内訳(SPEC.md 2.3.4、金額はすべて万円)。
 *
 * #31 で支出を自由項目リストに再設計したため、内訳は「項目ごとの年額(items)」に加え、
 * 別枠で扱う教育費(education)・住宅ローン返済(loan)・ライフイベント一時支出(events)を持つ。
 */
export interface ExpenseBreakdown {
  /**
   * 家賃の当年年額(#50。月額 × 12 × 物価上昇係数 + 更新料)。
   * 家賃入力(ExpenseInput.rent)が未設定の場合は undefined(CF表・内訳で非表示)。
   * 住宅購入年以降は 0。
   */
  rent?: number;
  /** 支出項目ごとの年額(入力の items と同順・同数)。 */
  items: ExpenseItemAmount[];
  /** 教育費(子どもの進路プランから算出)。 */
  education: number;
  /** 住宅ローン返済額(住宅購入イベント。返済期間内のみ)。 */
  loan: number;
  /** ライフイベントによる一時支出。 */
  events: number;
}

/** シミュレーション結果(1年分。SPEC.md 4.4、金額はすべて万円)。 */
export interface YearlyResult {
  /** 西暦。 */
  year: number;
  /** 本人年齢(歳)。 */
  age: number;
  /** 配偶者の年齢(歳)。配偶者がいない場合は undefined。 */
  spouseAge?: number;
  /**
   * 各子どもの当年の年齢(歳)。入力の `family.children` と同順・同数。
   * まだ生まれていない年は負値になる(表示側で「—」扱い)。
   */
  childAges: number[];
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
  /** 当年に実際に投資した積立額(全枠合計)。NISA 上限で停止した超過分は含まない。 */
  investmentContribution: number;
  /** 当年の運用益。 */
  investmentGain: number;
  /** 総資産(預金残高 + 投資資産評価額)。 */
  totalAssets: number;
  /** 当年に発生したライフイベント名。 */
  events: string[];
}

/** シミュレーション結果全体(年次結果の時系列)。 */
export type SimulationResult = YearlyResult[];
