/**
 * 全期間の年次テーブル(SPEC.md 2.4 F-08 / 画面 S-03)。
 *
 * === スロット: #11(年次内訳 T9)の実装 ===
 * 全期間(現在年齢〜終了年齢)の年次一覧をテーブル表示し、CSV ダウンロードを提供する。
 * 各行の年をクリックすると `setSelectedYear` を呼び、YearDetailSection と連動する。
 * グラフ(#10)の代替となるアクセシブルな表(caption / scope 付き)として実装する。
 */
import { useSimulationResult, useSimulationStore } from '../../stores/simulationStore';
import { TABLE_COLUMNS, formatMan } from './yearColumns';
import { downloadCsv } from './yearCsv';

export function YearTableSection() {
  const result = useSimulationResult();
  const selectedYear = useSimulationStore((s) => s.selectedYear);
  const setSelectedYear = useSimulationStore((s) => s.setSelectedYear);

  const hasData = result.length > 0;

  const handleDownload = () => {
    const from = result[0]?.year;
    const to = result[result.length - 1]?.year;
    downloadCsv(result, `money-plan_${from}-${to}.csv`);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800">年次一覧テーブル</h3>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!hasData}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          CSV ダウンロード
        </button>
      </div>

      {hasData ? (
        <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              全期間({result[0]?.year}年〜{result[result.length - 1]?.year}
              年)の年次収支・資産一覧。金額の単位は万円。年をクリックすると詳細内訳を表示します。
            </caption>
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th scope="col" className="px-3 py-2 text-left font-semibold text-slate-600">
                  西暦
                </th>
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    scope="col"
                    className="px-3 py-2 text-right font-semibold text-slate-600"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.map((r) => {
                const isSelected = r.year === selectedYear;
                return (
                  <tr
                    key={r.year}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`border-b border-slate-100 last:border-b-0 ${
                      isSelected ? 'bg-sky-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      <button
                        type="button"
                        onClick={() => setSelectedYear(r.year)}
                        className="font-medium text-sky-700 underline-offset-2 hover:underline"
                        aria-label={`${r.year}年(${r.age}歳)の詳細内訳を表示`}
                      >
                        {r.year}
                      </button>
                    </th>
                    {TABLE_COLUMNS.map((col) => {
                      const value = col.get(r);
                      const negative = typeof value === 'number' && value < 0;
                      return (
                        <td
                          key={col.label}
                          className={`px-3 py-1.5 text-right tabular-nums ${
                            negative ? 'text-rose-600' : 'text-slate-700'
                          }`}
                        >
                          {typeof value === 'number' ? formatMan(value) : value}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
          結果がありません
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        金額の単位は万円。CSV はお使いのブラウザ内で生成され、外部には送信されません。
      </p>
    </section>
  );
}
