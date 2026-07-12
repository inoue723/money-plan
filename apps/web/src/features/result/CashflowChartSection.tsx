/**
 * 収支グラフ(SPEC.md 2.4 F-07 / 画面 S-01)。
 *
 * === スロット: #10(グラフ T8)の実装先 ===
 * nivo(@nivo/bar)で年次の収支を描画する。
 * - 収入(手取り給与・年金・児童手当・その他)を正方向に積み上げ棒
 * - 支出(住居費・生活費・教育費・保険料・固定費・イベント費)を負方向に積み上げ棒
 * - 年間収支(balance)を折れ線でオーバーレイ(赤字年の点は警告色)
 * - ライフイベント発生年に縦ガイド + マーカー、ホバーでツールチップ
 * - 棒/点クリックでその年を選択(`setSelectedYear`)し #11 の年次内訳が購読する
 *
 * 手取り(net)は税・社会保険料を控除済みの金額のため、税は支出として二重計上しない。
 * 折れ線の年間収支は結果の `balance` をそのまま用いる(積立額の分だけ棒の収支差と
 * 一致しないことがある)。結果は `useSimulationResult()` から取得する(再計算しない)。
 */
import { useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import type { BarDatum, BarLayer, BarTooltipProps, ComputedDatum } from '@nivo/bar';
import { useSimulationResult, useSimulationStore } from '../../stores/simulationStore';
import {
  COLORS,
  computeValueBounds,
  EXPENSE_COLORS,
  formatMan,
  INCOME_COLORS,
  makeEventMarkerLayer,
  makeSelectedHighlightLayer,
  makeValueLineLayer,
  makeYearAgeTick,
  nivoTheme,
  thinYrTicks,
} from './chartKit';

interface CashflowDatum extends BarDatum {
  yr: string;
  year: number;
  age: number;
  // 収入(正)
  手取り給与: number;
  年金: number;
  児童手当: number;
  その他収入: number;
  // 支出(負で保持)
  住居費: number;
  生活費: number;
  教育費: number;
  保険料: number;
  固定費: number;
  イベント費: number;
  // メタ
  balance: number;
  totalIncome: number;
  totalExpense: number;
  eventLabel: string;
}

const INCOME_KEYS = ['手取り給与', '年金', '児童手当', 'その他収入'];
const EXPENSE_KEYS = ['住居費', '生活費', '教育費', '保険料', '固定費', 'イベント費'];
const ALL_KEYS = [...INCOME_KEYS, ...EXPENSE_KEYS];

const FALLBACK = '#94a3b8';
const keyColor = (id: string): string => INCOME_COLORS[id] ?? EXPENSE_COLORS[id] ?? FALLBACK;

function LegendChip({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      <span
        className="inline-block"
        style={
          line
            ? { width: 14, height: 0, borderTop: `2px solid ${color}` }
            : { width: 10, height: 10, borderRadius: 2, backgroundColor: color }
        }
      />
      {label}
    </span>
  );
}

function CashflowTooltip({ data }: BarTooltipProps<CashflowDatum>) {
  const row = (color: string, label: string, value: number, strong = false) => (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1">
        <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
        {label}
      </span>
      <span className={strong ? 'font-semibold' : ''}>{formatMan(value)}万円</span>
    </div>
  );
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-md">
      <div className="mb-1 font-semibold text-slate-800">
        {data.year}年（{data.age}歳）
      </div>
      {row('#059669', '収入合計', data.totalIncome)}
      {row('#ef4444', '支出合計', data.totalExpense)}
      <div className="my-1 border-t border-slate-100" />
      {row(data.balance < 0 ? COLORS.negative : COLORS.balance, '年間収支', data.balance, true)}
      {data.eventLabel && (
        <div className="mt-1 text-[11px] text-violet-600">◆ {data.eventLabel}</div>
      )}
    </div>
  );
}

export function CashflowChartSection() {
  const result = useSimulationResult();
  const selectedYear = useSimulationStore((s) => s.selectedYear);
  const setSelectedYear = useSimulationStore((s) => s.setSelectedYear);

  const data = useMemo<CashflowDatum[]>(
    () =>
      result.map((r) => {
        const totalIncome = r.income.net + r.income.pension + r.income.childAllowance + r.income.other;
        const e = r.expense;
        const totalExpense = e.housing + e.living + e.education + e.insurance + e.fixed + e.events;
        return {
          yr: String(r.year),
          year: r.year,
          age: r.age,
          手取り給与: Math.round(r.income.net),
          年金: Math.round(r.income.pension),
          児童手当: Math.round(r.income.childAllowance),
          その他収入: Math.round(r.income.other),
          住居費: -Math.round(e.housing),
          生活費: -Math.round(e.living),
          教育費: -Math.round(e.education),
          保険料: -Math.round(e.insurance),
          固定費: -Math.round(e.fixed),
          イベント費: -Math.round(e.events),
          balance: Math.round(r.balance),
          totalIncome: Math.round(totalIncome),
          totalExpense: Math.round(totalExpense),
          eventLabel: r.events.join('、'),
        };
      }),
    [result],
  );

  const ageByYr = useMemo(() => new Map(data.map((d) => [d.yr, d.age] as const)), [data]);
  const tickValues = useMemo(() => thinYrTicks(data), [data]);
  const bounds = useMemo(() => computeValueBounds(data, ALL_KEYS, (d) => d.balance), [data]);

  const layers = useMemo<BarLayer<CashflowDatum>[]>(
    () => [
      makeSelectedHighlightLayer<CashflowDatum>(
        selectedYear == null ? null : String(selectedYear),
      ),
      'grid',
      'axes',
      'bars',
      makeValueLineLayer<CashflowDatum>(data, (d) => d.balance, COLORS.balance),
      makeEventMarkerLayer<CashflowDatum>(data),
    ],
    [data, selectedYear],
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="収支グラフ">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">収支グラフ</h3>
        <div className="flex flex-wrap items-center gap-3">
          <LegendChip color={INCOME_COLORS['手取り給与'] ?? FALLBACK} label="収入" />
          <LegendChip color={EXPENSE_COLORS['生活費'] ?? FALLBACK} label="支出" />
          <LegendChip color={COLORS.balance} label="年間収支" line />
          <LegendChip color={COLORS.event} label="イベント" />
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
          入力に基づく結果がありません
        </div>
      ) : (
        <div style={{ height: 320 }}>
          <ResponsiveBar<CashflowDatum>
            data={data}
            keys={ALL_KEYS}
            indexBy="yr"
            margin={{ top: 16, right: 24, bottom: 52, left: 64 }}
            padding={0.25}
            valueScale={{ type: 'linear', min: bounds.min, max: bounds.max }}
            indexScale={{ type: 'band', round: true }}
            colors={({ id }) => keyColor(String(id))}
            theme={nivoTheme}
            enableLabel={false}
            enableGridX={false}
            axisLeft={{
              format: (v) => formatMan(Number(v)),
              legend: '金額（万円）',
              legendOffset: -52,
              legendPosition: 'middle',
            }}
            axisBottom={{ tickValues, renderTick: makeYearAgeTick(ageByYr) }}
            layers={layers}
            tooltip={CashflowTooltip}
            onClick={(datum: ComputedDatum<CashflowDatum>) => setSelectedYear(datum.data.year)}
            isInteractive
          />
        </div>
      )}
    </section>
  );
}
