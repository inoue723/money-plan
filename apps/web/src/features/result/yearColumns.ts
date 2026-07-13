/**
 * CF表(キャッシュフロー表)の行定義(issue #26)。
 *
 * 従来の「年次一覧テーブル(行=年次・列=指標)」を廃止し、FP のキャッシュフロー表形式
 * (横=年次・縦=内訳)に置き換えた。この表の各行(内訳項目)と、収入/控除/支出/収支・資産の
 * セクション構成をここで一元定義する。金額はすべて「万円」。
 *
 * 数値フォーマッタ(formatMan / truncMan)は本ファイルで定義し、CF表・年次詳細・
 * グラフ(chartKit 経由)で共有して表示・丸めを統一する。
 */
import type { YearlyResult } from '@money-plan/finance-core';

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

/** 支出内訳の合計(万円)。支出項目 + 教育費 + 住宅ローン + イベント費用。 */
export function totalExpense(r: YearlyResult): number {
  const e = r.expense;
  const items = e.items.reduce((sum, it) => sum + it.amount, 0);
  return items + e.education + e.loan + e.events;
}

/** CF表の 1 行(内訳項目)の定義。横に年次が並び、各年の値を `get` で取り出す。 */
export interface CashflowRow {
  /** 先頭列に表示する項目名。 */
  label: string;
  /** 年次結果から表示値を取り出す。 */
  get: (r: YearlyResult) => number | string;
  /** 文字列行(イベント名など)。数値整形・負値の赤字を適用しない。 */
  text?: boolean;
  /** 小計・合計行として強調表示する。 */
  emphasize?: boolean;
}

/** CF表のセクション(見出し + 内訳行)。視覚的なグルーピングに使う。 */
export interface CashflowSection {
  /** セクション見出し(収入 / 控除 / 支出 / 収支・資産)。 */
  heading: string;
  rows: CashflowRow[];
}

/** 支出セクションの内訳行を組み立てる(#31)。支出項目は結果から動的に展開する。 */
function buildExpenseRows(result: YearlyResult[]): CashflowRow[] {
  // 支出項目は入力由来で全年共通(同順・同数)なので、先頭年の項目名から行を作る。
  const itemNames = result[0]?.expense.items.map((it) => it.name) ?? [];
  const rows: CashflowRow[] = itemNames.map((name, k) => ({
    label: name,
    get: (r) => r.expense.items[k]?.amount ?? 0,
  }));

  rows.push({ label: '教育費', get: (r) => r.expense.education });
  // 住宅ローンは住宅購入イベントがある場合のみ表示する(常時 0 の行を出さない)。
  if (result.some((r) => r.expense.loan > 0)) {
    rows.push({ label: '住宅ローン', get: (r) => r.expense.loan });
  }
  rows.push({ label: 'イベント費用', get: (r) => r.expense.events });
  rows.push({ label: '支出合計', get: (r) => totalExpense(r), emphasize: true });
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
        { label: 'その他収入', get: (r) => r.income.other },
        { label: '運用益', get: (r) => r.income.investmentGain },
        { label: '手取り収入', get: (r) => r.income.net, emphasize: true },
      ],
    },
    {
      heading: '控除(税・社会保険)',
      rows: [
        { label: '所得税', get: (r) => r.tax.incomeTax },
        { label: '住民税', get: (r) => r.tax.residentTax },
        { label: '健康保険', get: (r) => r.tax.healthInsurance },
        { label: '厚生年金', get: (r) => r.tax.pensionInsurance },
        { label: '雇用保険', get: (r) => r.tax.employmentInsurance },
      ],
    },
    {
      heading: '支出',
      rows: buildExpenseRows(result),
    },
    {
      heading: '収支・資産',
      rows: [
        { label: '年間収支', get: (r) => r.balance },
        { label: '預金残高', get: (r) => r.savings },
        { label: '投資資産', get: (r) => r.investmentValue },
        { label: '総資産', get: (r) => r.totalAssets, emphasize: true },
        { label: 'イベント', get: (r) => r.events.join(' / '), text: true },
      ],
    },
  ];
}
