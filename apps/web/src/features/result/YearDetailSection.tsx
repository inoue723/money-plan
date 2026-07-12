/**
 * 年次詳細内訳(SPEC.md 2.4 F-08 / 画面 S-02)。
 *
 * === スロット: #11(年次内訳 T9)の実装 ===
 * 選択年(`useSimulationStore` の `selectedYear`)の収入・税/社保・支出・資産を
 * カテゴリ別に表形式で表示する。選択年が未設定(#10 のグラフクリック前など)の場合は
 * 既定として最終年を表示する。対応する `YearlyResult` は `useSimulationResult()` から引く。
 */
import type { YearlyResult } from '@money-plan/finance-core';
import { useSimulationResult, useSimulationStore } from '../../stores/simulationStore';
import { formatMan, totalExpense } from './yearColumns';

/** カテゴリ表の 1 行。value は万円額(数値)。 */
interface DetailRow {
  label: string;
  value: number;
  /** 小計・合計行として強調するか。 */
  emphasize?: boolean;
}

/** カテゴリ単位の内訳表。 */
function CategoryTable({ caption, rows }: { caption: string; rows: DetailRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="mb-1 text-left text-sm font-semibold text-slate-700">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">項目</th>
          <th scope="col">金額(万円)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-slate-100 last:border-b-0">
            <th
              scope="row"
              className={`py-1 text-left font-normal ${
                row.emphasize ? 'font-semibold text-slate-800' : 'text-slate-600'
              }`}
            >
              {row.label}
            </th>
            <td
              className={`py-1 text-right tabular-nums ${
                row.emphasize ? 'font-semibold text-slate-800' : 'text-slate-700'
              }`}
            >
              {formatMan(row.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 資産状況の前年比行(増減に応じて色と符号を変える)。 */
function ChangeRow({ label, diff }: { label: string; diff: number | null }) {
  const text =
    diff == null
      ? '—'
      : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${formatMan(Math.abs(diff))} 万円`;
  const color =
    diff == null || diff === 0 ? 'text-slate-500' : diff > 0 ? 'text-emerald-600' : 'text-rose-600';
  return (
    <tr className="border-b border-slate-100 last:border-b-0">
      <th scope="row" className="py-1 text-left font-normal text-slate-600">
        {label}
      </th>
      <td className={`py-1 text-right tabular-nums font-medium ${color}`}>{text}</td>
    </tr>
  );
}

function DetailBody({ current, previous }: { current: YearlyResult; previous?: YearlyResult }) {
  const income = current.income;
  const tax = current.tax;
  const expense = current.expense;

  const assetsDiff = previous ? current.totalAssets - previous.totalAssets : null;

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
      <CategoryTable
        caption="収入"
        rows={[
          { label: '額面給与', value: income.grossSalary },
          { label: '配偶者給与', value: income.spouseSalary },
          { label: '手取り収入', value: income.net },
          { label: '年金', value: income.pension },
          { label: '児童手当', value: income.childAllowance },
          { label: 'その他収入', value: income.other },
          { label: '運用益', value: income.investmentGain },
        ]}
      />

      <CategoryTable
        caption="税・社会保険料"
        rows={[
          { label: '所得税', value: tax.incomeTax },
          { label: '住民税', value: tax.residentTax },
          { label: '健康保険', value: tax.healthInsurance },
          { label: '厚生年金', value: tax.pensionInsurance },
          { label: '雇用保険', value: tax.employmentInsurance },
          { label: '社会保険料計', value: tax.socialInsurance, emphasize: true },
        ]}
      />

      <CategoryTable
        caption="支出"
        rows={[
          { label: '住居費', value: expense.housing },
          { label: '生活費', value: expense.living },
          { label: '教育費', value: expense.education },
          { label: '保険料', value: expense.insurance },
          { label: 'その他固定費', value: expense.fixed },
          { label: 'イベント費用', value: expense.events },
          { label: '支出合計', value: totalExpense(current), emphasize: true },
        ]}
      />

      <table className="w-full border-collapse text-sm">
        <caption className="mb-1 text-left text-sm font-semibold text-slate-700">資産状況</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">項目</th>
            <th scope="col">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <th scope="row" className="py-1 text-left font-normal text-slate-600">
              年間収支
            </th>
            <td
              className={`py-1 text-right tabular-nums ${
                current.balance < 0 ? 'text-rose-600' : 'text-slate-700'
              }`}
            >
              {formatMan(current.balance)}
            </td>
          </tr>
          <tr className="border-b border-slate-100">
            <th scope="row" className="py-1 text-left font-normal text-slate-600">
              預金残高
            </th>
            <td className="py-1 text-right tabular-nums text-slate-700">
              {formatMan(current.savings)}
            </td>
          </tr>
          <tr className="border-b border-slate-100">
            <th scope="row" className="py-1 text-left font-normal text-slate-600">
              投資資産
            </th>
            <td className="py-1 text-right tabular-nums text-slate-700">
              {formatMan(current.investmentValue)}
            </td>
          </tr>
          <tr className="border-b border-slate-100">
            <th scope="row" className="py-1 text-left font-semibold text-slate-800">
              総資産
            </th>
            <td className="py-1 text-right tabular-nums font-semibold text-slate-800">
              {formatMan(current.totalAssets)}
            </td>
          </tr>
          <ChangeRow label="総資産 前年比" diff={assetsDiff} />
        </tbody>
      </table>
    </div>
  );
}

export function YearDetailSection() {
  const result = useSimulationResult();
  const selectedYear = useSimulationStore((s) => s.selectedYear);

  // 選択年の行を探す。未選択(または該当なし)の場合は既定として最終年を表示する。
  const selectedIndex =
    selectedYear == null ? -1 : result.findIndex((r) => r.year === selectedYear);
  const index = selectedIndex >= 0 ? selectedIndex : result.length - 1;
  const current = index >= 0 ? result[index] : undefined;
  const previous = index > 0 ? result[index - 1] : undefined;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-slate-800">年次詳細</h3>
        {current && (
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{current.year}</span> 年(
            {current.age} 歳)
            {selectedYear == null && <span className="text-slate-400">・既定</span>}
          </p>
        )}
      </div>

      {current ? (
        <>
          <DetailBody current={current} previous={previous} />
          {current.events.length > 0 && (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold text-slate-700">ライフイベント: </span>
              {current.events.join(' / ')}
            </p>
          )}
        </>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
          結果がありません
        </div>
      )}
    </section>
  );
}
