/**
 * 年次結果テーブル / CSV の共有定義(issue #11)。
 *
 * 画面テーブル(YearTableSection)と CSV エクスポートで列定義を共有し、
 * 表示とダウンロード内容が食い違わないようにする。金額はすべて「万円」。
 */
import type { YearlyResult } from '@money-plan/finance-core';

/** 金額(万円)を桁区切り + 小数1桁までで整形する。 */
export function formatMan(value: number): string {
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/** 支出内訳の合計(万円)。 */
export function totalExpense(r: YearlyResult): number {
  const e = r.expense;
  return e.housing + e.living + e.education + e.insurance + e.fixed + e.events;
}

/** 前年比(当年 − 前年)。前年が無い場合は null。 */
export function yearOverYear(
  current: number,
  previous: YearlyResult | undefined,
  pick: (r: YearlyResult) => number,
): number | null {
  return previous ? current - pick(previous) : null;
}

/** テーブル/CSV 1 列の定義。 */
export interface ResultColumn {
  /** ヘッダー表示名。 */
  label: string;
  /** 数値列か文字列列か(整形・右寄せの分岐に使う)。 */
  numeric: boolean;
  /** 行から表示値を取り出す。 */
  get: (r: YearlyResult) => number | string;
}

/**
 * CSV に出力する全項目の列定義(SPEC.md 2.3.4 の全内訳)。
 * 画面テーブルはこの一部(TABLE_COLUMNS)のみ表示するが、CSV は全項目を含める。
 */
export const CSV_COLUMNS: ResultColumn[] = [
  { label: '西暦', numeric: true, get: (r) => r.year },
  { label: '年齢', numeric: true, get: (r) => r.age },
  { label: '額面給与(万円)', numeric: true, get: (r) => r.income.grossSalary },
  { label: '配偶者給与(万円)', numeric: true, get: (r) => r.income.spouseSalary },
  { label: '手取り収入(万円)', numeric: true, get: (r) => r.income.net },
  { label: '年金(万円)', numeric: true, get: (r) => r.income.pension },
  { label: '児童手当(万円)', numeric: true, get: (r) => r.income.childAllowance },
  { label: 'その他収入(万円)', numeric: true, get: (r) => r.income.other },
  { label: '運用益(万円)', numeric: true, get: (r) => r.income.investmentGain },
  { label: '所得税(万円)', numeric: true, get: (r) => r.tax.incomeTax },
  { label: '住民税(万円)', numeric: true, get: (r) => r.tax.residentTax },
  { label: '健康保険(万円)', numeric: true, get: (r) => r.tax.healthInsurance },
  { label: '厚生年金(万円)', numeric: true, get: (r) => r.tax.pensionInsurance },
  { label: '雇用保険(万円)', numeric: true, get: (r) => r.tax.employmentInsurance },
  { label: '社会保険料計(万円)', numeric: true, get: (r) => r.tax.socialInsurance },
  { label: '住居費(万円)', numeric: true, get: (r) => r.expense.housing },
  { label: '生活費(万円)', numeric: true, get: (r) => r.expense.living },
  { label: '教育費(万円)', numeric: true, get: (r) => r.expense.education },
  { label: '保険料(万円)', numeric: true, get: (r) => r.expense.insurance },
  { label: 'その他固定費(万円)', numeric: true, get: (r) => r.expense.fixed },
  { label: 'イベント費用(万円)', numeric: true, get: (r) => r.expense.events },
  { label: '支出合計(万円)', numeric: true, get: (r) => totalExpense(r) },
  { label: '年間収支(万円)', numeric: true, get: (r) => r.balance },
  { label: '預金残高(万円)', numeric: true, get: (r) => r.savings },
  { label: '投資資産(万円)', numeric: true, get: (r) => r.investmentValue },
  { label: '総資産(万円)', numeric: true, get: (r) => r.totalAssets },
  { label: 'イベント', numeric: false, get: (r) => r.events.join(' / ') },
];

/**
 * 画面テーブルに表示する要約列(グラフの代替となる主要指標)。
 * 各年の詳細内訳は行クリックで YearDetailSection に表示する。
 */
export const TABLE_COLUMNS: ResultColumn[] = [
  { label: '年齢', numeric: true, get: (r) => r.age },
  { label: '手取り収入', numeric: true, get: (r) => r.income.net },
  { label: '年金', numeric: true, get: (r) => r.income.pension },
  { label: '支出合計', numeric: true, get: (r) => totalExpense(r) },
  { label: '運用益', numeric: true, get: (r) => r.income.investmentGain },
  { label: '年間収支', numeric: true, get: (r) => r.balance },
  { label: '総資産', numeric: true, get: (r) => r.totalAssets },
];
