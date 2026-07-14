/**
 * CF表(キャッシュフロー表)セクション(issue #26 / SPEC.md 2.4 F-08 相当)。
 *
 * 従来の「年次一覧テーブル(行=年次・列=指標)」を廃止し、FP のキャッシュフロー表形式
 * (横=年次・縦=内訳)に置き換えたもの。
 *
 * - 先頭の項目名列(左)と年次ヘッダー(西暦・年齢, 上)を sticky 固定し、横・縦スクロールに追従させる。
 * - 年(西暦)ヘッダーのクリックで `setSelectedYear` を呼び、その列をハイライトする(グラフの
 *   選択年マーカーとも `selectedYear` 経由で連動する)。
 * - 負の値は `text-rose-600` の赤字で表示する。金額は `formatMan`(万円未満切り捨て・桁区切り)で整形。
 */
import type { ReactNode } from 'react';
import { useSimulationResult, useSimulationStore } from '../../stores/simulationStore';
import { buildAgeHeaderRows, buildCashflowSections, formatMan } from './yearColumns';

export function CashflowTableSection() {
  const result = useSimulationResult();
  const selectedYear = useSimulationStore((s) => s.selectedYear);
  const setSelectedYear = useSimulationStore((s) => s.setSelectedYear);

  const hasData = result.length > 0;
  // 先頭の項目名列 + 各年の列。セクション見出し行を全幅に伸ばす際の colSpan に使う。
  const totalCols = result.length + 1;
  // 支出項目(#31)を含むため、行構成は結果から動的に組み立てる。
  const sections = buildCashflowSections(result);
  // 年次ヘッダ付近に表示する配偶者・子どもの年齢行(#48)。配偶者なし・子0人なら空。
  const ageHeaderRows = buildAgeHeaderRows(result);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800">キャッシュフロー表</h3>
        {hasData && (
          <p className="text-sm text-slate-500">
            {result[0]?.year}〜{result[result.length - 1]?.year} 年・単位: 万円
          </p>
        )}
      </div>

      {hasData ? (
        <div className="max-h-[32rem] overflow-auto rounded-md border border-slate-200">
          <table className="border-collapse text-sm">
            <caption className="sr-only">
              全期間({result[0]?.year}年〜{result[result.length - 1]?.year}
              年)のキャッシュフロー表。列が年次、行が収入・控除・支出・収支/資産の内訳。金額の単位は万円。
              西暦ヘッダーをクリックすると該当年の列をハイライトします。
            </caption>
            <thead>
              {/* 西暦(上段・sticky top-0)。列ヘッダーをクリックで選択年を切り替える。 */}
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-30 h-9 min-w-[8rem] border-b border-r border-slate-200 bg-slate-50 px-3 text-left font-semibold text-slate-600"
                >
                  西暦
                </th>
                {result.map((r) => {
                  const isSelected = r.year === selectedYear;
                  return (
                    <th
                      key={r.year}
                      scope="col"
                      aria-current={isSelected ? 'true' : undefined}
                      className={`sticky top-0 z-20 h-9 min-w-[5.5rem] border-b border-slate-200 px-3 text-right font-semibold ${
                        isSelected ? 'bg-sky-100 text-sky-800' : 'bg-slate-50 text-slate-600'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedYear(r.year)}
                        className="font-semibold text-sky-700 underline-offset-2 hover:underline"
                        aria-label={`${r.year}年(${r.age}歳)の詳細内訳を表示`}
                      >
                        {r.year}
                      </button>
                    </th>
                  );
                })}
              </tr>
              {/* 年齢(下段・sticky top-9 で西暦の直下に固定)。 */}
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 top-9 z-30 h-8 min-w-[8rem] border-b border-r border-slate-200 bg-slate-50 px-3 text-left font-normal text-slate-500"
                >
                  年齢
                </th>
                {result.map((r) => {
                  const isSelected = r.year === selectedYear;
                  return (
                    <td
                      key={r.year}
                      className={`sticky top-9 z-20 h-8 border-b border-slate-200 px-3 text-right tabular-nums ${
                        isSelected ? 'bg-sky-50 text-sky-800' : 'bg-slate-50 text-slate-500'
                      }`}
                    >
                      {r.age}歳
                    </td>
                  );
                })}
              </tr>
              {/* 配偶者・子どもの年齢(#48)。西暦(h-9)+年齢(h-8)の下に順に sticky 固定する。 */}
              {ageHeaderRows.map((ageRow, k) => {
                // 上端からの sticky オフセット(px): 西暦 36 + 年齢 32 + それより上の年齢行 × 32。
                const top = 68 + k * 32;
                return (
                  <tr key={ageRow.label}>
                    <th
                      scope="row"
                      style={{ top }}
                      className="sticky left-0 z-30 h-8 min-w-[8rem] border-b border-r border-slate-200 bg-slate-50 px-3 text-left font-normal text-slate-500"
                    >
                      {ageRow.label}
                    </th>
                    {result.map((r) => {
                      const isSelected = r.year === selectedYear;
                      return (
                        <td
                          key={r.year}
                          style={{ top }}
                          className={`sticky z-20 h-8 border-b border-slate-200 px-3 text-right tabular-nums ${
                            isSelected ? 'bg-sky-50 text-sky-800' : 'bg-slate-50 text-slate-500'
                          }`}
                        >
                          {ageRow.get(r)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </thead>
            <tbody>
              {sections.map((section) => (
                <FragmentSection
                  key={section.heading}
                  heading={section.heading}
                  totalCols={totalCols}
                >
                  {section.rows.map((row, rowIdx) => (
                    <tr key={`${row.label}-${rowIdx}`} className="border-b border-slate-100">
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 min-w-[8rem] border-r border-slate-200 bg-white px-3 py-1.5 text-left font-normal ${
                          row.emphasize ? 'font-semibold text-slate-800' : 'text-slate-600'
                        }`}
                      >
                        {row.label}
                      </th>
                      {result.map((r, colIdx) => {
                        const value = row.get(r, colIdx, result);
                        const isSelected = r.year === selectedYear;
                        const negative = !row.text && typeof value === 'number' && value < 0;
                        return (
                          <td
                            key={r.year}
                            className={`px-3 py-1.5 tabular-nums ${row.text ? 'text-left' : 'text-right'} ${
                              isSelected ? 'bg-sky-50' : ''
                            } ${
                              negative
                                ? 'text-rose-600'
                                : row.emphasize
                                  ? 'font-semibold text-slate-800'
                                  : 'text-slate-700'
                            }`}
                          >
                            {row.text
                              ? value || '—'
                              : typeof value === 'number'
                                ? formatMan(value)
                                : value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </FragmentSection>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
          結果がありません
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        金額の単位は万円(万円未満切り捨て)。西暦ヘッダーをクリックすると、その年の列がハイライトされます。
      </p>
    </section>
  );
}

/** セクション見出し行 + 内訳行のまとまり。見出しは全幅に伸ばし、横スクロール時も左端に固定する。 */
function FragmentSection({
  heading,
  totalCols,
  children,
}: {
  heading: string;
  totalCols: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={totalCols}
          className="sticky left-0 z-10 border-y border-slate-200 bg-slate-100 px-3 py-1 text-left text-xs font-semibold text-slate-500"
        >
          {heading}
        </th>
      </tr>
      {children}
    </>
  );
}
