/**
 * CF表(キャッシュフロー表)の行定義(issue #26)。
 *
 * 従来の「年次一覧テーブル(行=年次・列=指標)」を廃止し、FP のキャッシュフロー表形式
 * (横=年次・縦=内訳)に置き換えた。この表の各行(内訳項目)と、収入/支出/収支・資産の
 * セクション構成をここで一元定義する。金額はすべて「万円」。
 *
 * #67 で収入セクションを「額面合計」に簡素化し(運用益・手取り収入の行を削除)、
 * 控除(税・社会保険)セクションを廃止して支出セクションへ統合した。
 *
 * 数値フォーマッタ(formatMan / truncMan)は本ファイルで定義し、CF表・
 * グラフ(chartKit 経由)で共有して表示・丸めを統一する。
 */
import type { CalcNode, YearlyResult } from '@money-plan/finance-core';

/**
 * 金額(万円)の万円未満を切り捨てる(issue #27)。
 * 負の値は 0 方向への切り捨て(Math.trunc)とする(例: -831.1 → -831)。
 * 表示の丸めはすべてこの関数に統一する(finance-core の計算値は丸めない)。
 */
export function truncMan(value: number): number {
  // Math.trunc(-0.1) は -0 になり「-0」と表示されるため、+0 を足して 0 に正規化する。
  return Math.trunc(value) + 0;
}

/** 金額(万円)を万円未満切り捨て + 桁区切りで整形する(issue #27)。 */
export function formatMan(value: number): string {
  return truncMan(value).toLocaleString('ja-JP');
}

/** 支出内訳の合計(万円)。家賃 + 支出項目 + 教育費 + 住宅ローン + イベント費用。 */
export function totalExpense(r: YearlyResult): number {
  const e = r.expense;
  const items = e.items.reduce((sum, it) => sum + it.amount, 0);
  return (e.rent ?? 0) + items + e.education + e.loan + e.events;
}

/**
 * CF表の「収入合計」(万円。#67)。
 * 額面ベースの収入のみを合計し、運用益は含めない(運用益は「投資資産」側で反映されるため)。
 */
function totalIncome(r: YearlyResult): number {
  const i = r.income;
  return i.grossSalary + i.spouseSalary + i.pension + i.childAllowance + i.other;
}

/**
 * CF表の「支出合計」(万円。#67)。
 * 控除セクションを廃止して税・社会保険を支出に統合したため、支出内訳に
 * 所得税・住民税・社会保険料(健康保険 + 厚生年金 + 雇用保険)を加えた額とする。
 */
function totalExpenseWithTax(r: YearlyResult): number {
  return totalExpense(r) + r.tax.incomeTax + r.tax.residentTax + r.tax.socialInsurance;
}

/** CF表の 1 行(内訳項目)の定義。横に年次が並び、各年の値を `get` で取り出す。 */
export interface CashflowRow {
  /** 先頭列に表示する項目名。 */
  label: string;
  /**
   * 年次結果から表示値を取り出す。
   * 前年比のように前年参照が要る行のため、対象年 `r` に加えて列インデックス `index` と
   * 全年配列 `all` も受け取れる(既存の単年参照行はそのまま `(r) => …` で書ける)。
   */
  get: (r: YearlyResult, index: number, all: YearlyResult[]) => number | string;
  /** 文字列行(イベント名など)。数値整形・負値の赤字を適用しない。 */
  text?: boolean;
  /** 小計・合計行として強調表示する。 */
  emphasize?: boolean;
  /**
   * 当年のセル値の計算根拠ツリー(あればセルにツールチップを付ける)。
   * 根拠が存在しない年は undefined を返す(例: 退職金が無い年のその他収入)。
   */
  getDetail?: (r: YearlyResult) => CalcNode | undefined;
}

/** CF表のセクション(見出し + 内訳行)。視覚的なグルーピングに使う。 */
export interface CashflowSection {
  /** セクション見出し(収入 / 控除 / 支出 / 収支・資産)。 */
  heading: string;
  rows: CashflowRow[];
}

/** CF表ヘッダの年齢行(配偶者・子ども)の定義。値は表示用の文字列("32歳" / "—")。 */
export interface AgeHeaderRow {
  /** 先頭列に表示する項目名(配偶者年齢 / 第1子 …)。 */
  label: string;
  /** 各年の表示文字列を返す。配偶者不在・未誕生の年は「—」。 */
  get: (r: YearlyResult) => string;
}

/**
 * CF表の年次ヘッダ付近に表示する年齢行(配偶者・子ども)を組み立てる(#48)。
 * - 配偶者年齢はいずれかの年に配偶者が存在する場合のみ行を出す(不在なら非表示)。
 * - 子どもは人数分「第1子」「第2子」…を出す(0 人なら行なし)。未誕生(負値)の年は「—」。
 * 本人年齢は既存のヘッダ行で表示するためここには含めない。
 */
export function buildAgeHeaderRows(result: YearlyResult[]): AgeHeaderRow[] {
  const rows: AgeHeaderRow[] = [];

  // 配偶者年齢: いずれかの年で spouseAge が定義されていれば表示する。
  if (result.some((r) => r.spouseAge !== undefined)) {
    rows.push({
      label: '配偶者年齢',
      get: (r) => (r.spouseAge === undefined ? '—' : `${r.spouseAge}歳`),
    });
  }

  // 子ども: 人数は全年共通(入力由来で同順・同数)なので先頭年から件数を得る。
  const childCount = result[0]?.childAges.length ?? 0;
  for (let k = 0; k < childCount; k++) {
    rows.push({
      label: `第${k + 1}子`,
      get: (r) => {
        const childAge = r.childAges[k];
        return childAge === undefined || childAge < 0 ? '—' : `${childAge}歳`;
      },
    });
  }

  return rows;
}

/**
 * 支出セクションの内訳行を組み立てる(#31)。支出項目は結果から動的に展開する。
 * #67 で控除(税・社会保険)セクションを廃止し、その5行を支出項目の後・「支出合計」の前に統合した。
 */
function buildExpenseRows(result: YearlyResult[]): CashflowRow[] {
  const rows: CashflowRow[] = [];

  // 家賃(#50)は専用行として先頭に表示する。rent 未設定(undefined)なら行を出さない。
  if (result.some((r) => r.expense.rent !== undefined)) {
    rows.push({ label: '家賃', get: (r) => r.expense.rent ?? 0 });
  }

  // 支出項目は入力由来で全年共通(同順・同数)なので、先頭年の項目名から行を作る。
  const itemNames = result[0]?.expense.items.map((it) => it.name) ?? [];
  itemNames.forEach((name, k) => {
    rows.push({ label: name, get: (r) => r.expense.items[k]?.amount ?? 0 });
  });

  rows.push({ label: '教育費', get: (r) => r.expense.education });
  // 住宅ローンは住宅購入イベントがある場合のみ表示する(常時 0 の行を出さない)。
  if (result.some((r) => r.expense.loan > 0)) {
    rows.push({ label: '住宅ローン', get: (r) => r.expense.loan });
  }
  rows.push({ label: 'イベント費用', get: (r) => r.expense.events });

  // 控除(税・社会保険)は #67 で支出セクションに統合した。支出項目の後・合計の前に並べる。
  rows.push({
    label: '所得税',
    get: (r) => r.tax.incomeTax,
    // 給与/事業・年金・本人/配偶者の内訳と課税所得の導出をツールチップで出す。
    getDetail: (r) => r.details?.incomeTax,
  });
  rows.push({ label: '住民税', get: (r) => r.tax.residentTax });
  rows.push({ label: '健康保険', get: (r) => r.tax.healthInsurance });
  rows.push({ label: '厚生年金', get: (r) => r.tax.pensionInsurance });
  rows.push({ label: '雇用保険', get: (r) => r.tax.employmentInsurance });

  rows.push({ label: '支出合計', get: (r) => totalExpenseWithTax(r), emphasize: true });
  return rows;
}

/**
 * 収支・資産セクションの内訳行を組み立てる。
 * 投資の取り崩し(#69)は取崩が発生する年がある場合のみ行を出す(住宅ローンと同じく、常時 0 の行を出さない)。
 */
function buildBalanceAssetRows(result: YearlyResult[]): CashflowRow[] {
  const rows: CashflowRow[] = [
    { label: '年間収支', get: (r) => r.balance },
    { label: '預金残高', get: (r) => r.savings },
    { label: '年間積立額', get: (r) => r.investmentContribution },
  ];

  // 取崩額は税引前、取崩時課税はその内訳。「投資取崩額 − 取崩時課税」が預金に入る額になる。
  // 課税は取崩とセットでしか発生しないため、2行はまとめて出し入れする(NISA のみなら課税は全年 0)。
  if (result.some((r) => r.investmentWithdrawal > 0)) {
    rows.push({ label: '投資取崩額', get: (r) => r.investmentWithdrawal });
    rows.push({ label: '取崩時課税', get: (r) => r.investmentWithdrawalTax });
  }

  rows.push(
    { label: '投資資産', get: (r) => r.investmentValue },
    { label: '総資産', get: (r) => r.totalAssets, emphasize: true },
    {
      // 総資産の前年差分。初年は比較対象がないため「—」(文字列)を返す。
      label: '総資産 前年比',
      get: (r, index, all) =>
        index === 0 ? '—' : r.totalAssets - (all[index - 1]?.totalAssets ?? 0),
    },
    { label: 'イベント', get: (r) => r.events.join(' / '), text: true },
  );

  return rows;
}

/**
 * CF表の行構成(SPEC.md 2.3.4 の全内訳を縦に展開)。
 * 支出項目(#31)は自由項目のため結果から動的に展開する。それ以外は固定行。
 * `YearlyResult` の既存フィールドをそのまま参照する(結果の再計算はしない)。
 */
export function buildCashflowSections(result: YearlyResult[]): CashflowSection[] {
  return [
    {
      heading: '収入',
      rows: [
        { label: '額面給与', get: (r) => r.income.grossSalary },
        { label: '配偶者給与', get: (r) => r.income.spouseSalary },
        { label: '年金', get: (r) => r.income.pension },
        { label: '児童手当', get: (r) => r.income.childAllowance },
        {
          label: 'その他収入',
          get: (r) => r.income.other,
          // 退職金の発生年は計算根拠(額面・勤続年数・退職所得控除など)をツールチップで出す。
          getDetail: (r) => r.details?.otherIncome,
        },
        { label: '収入合計', get: (r) => totalIncome(r), emphasize: true },
      ],
    },
    {
      heading: '支出',
      rows: buildExpenseRows(result),
    },
    {
      heading: '収支・資産',
      rows: buildBalanceAssetRows(result),
    },
  ];
}
