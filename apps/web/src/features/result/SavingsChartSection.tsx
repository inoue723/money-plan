/**
 * 年末現預金残高の推移グラフ(issue #29 / 画面 S-01)。
 *
 * nivo(@nivo/line)で各年末時点の現預金残高(`YearlyResult.savings`・万円)を
 * 折れ線で描画する。
 * - 横軸: 年(西暦 + 本人年齢を2段で併記)、縦軸: 現預金残高(万円)
 * - ホバーで 年・年齢・現預金残高 をツールチップ表示
 * - 残高がマイナスの年があっても値域を負側へ広げて描画し、0 のガイド線を引く
 *   (マイナス年の点は警告色で強調)
 * - 点クリックでその年を選択(`setSelectedYear`)し、年次内訳セクションが購読する
 *
 * 結果は `useSimulationResult()` から取得する(再計算は行わない)。
 */
import { useMemo } from 'react';
import { ResponsiveLine, isPoint } from '@nivo/line';
import type { LineCustomSvgLayer, LineSvgLayer, PointTooltipProps } from '@nivo/line';
import { useSimulationResult, useSimulationStore } from '../../stores/simulationStore';
import { COLORS, formatMan, makeYearAgeTick, nivoTheme, thinYrTicks, truncMan } from './chartKit';

interface SavingsPoint {
  /** 西暦の文字列(x 値・point スケールのキー)。 */
  x: string;
  /** 年末の現預金残高(万円・万円未満切り捨て)。 */
  y: number;
  year: number;
  age: number;
}

interface SavingsSeries {
  id: string;
  data: readonly SavingsPoint[];
}

const SERIES_ID = '現預金残高';

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      <span
        className="inline-block"
        style={{ width: 14, height: 0, borderTop: `2px solid ${color}` }}
      />
      {label}
    </span>
  );
}

function SavingsTooltip({ point }: PointTooltipProps<SavingsSeries>) {
  const { year, age, y } = point.data;
  return (
    <div className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-md">
      <div className="mb-1 font-semibold text-slate-800">
        {year}年（{age}歳）
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: y < 0 ? COLORS.negative : COLORS.savings,
            }}
          />
          現預金残高
        </span>
        <span className={`font-semibold ${y < 0 ? 'text-red-600' : ''}`}>{formatMan(y)}万円</span>
      </div>
    </div>
  );
}

/** 選択中の年に縦のハイライト線を引くカスタムレイヤを生成する。 */
function makeSelectedYearLayer(selectedYr: string | null): LineCustomSvgLayer<SavingsSeries> {
  return function SelectedYearLayer({ xScale, innerHeight }) {
    if (!selectedYr) return null;
    const x = xScale(selectedYr);
    if (!Number.isFinite(x)) return null;
    return (
      <line
        x1={x}
        x2={x}
        y1={0}
        y2={innerHeight}
        stroke={COLORS.selected}
        strokeWidth={3}
        opacity={0.45}
      />
    );
  };
}

export function SavingsChartSection() {
  const result = useSimulationResult();
  const selectedYear = useSimulationStore((s) => s.selectedYear);
  const setSelectedYear = useSimulationStore((s) => s.setSelectedYear);

  const points = useMemo<SavingsPoint[]>(
    () =>
      result.map((r) => ({
        x: String(r.year),
        y: truncMan(r.savings),
        year: r.year,
        age: r.age,
      })),
    [result],
  );

  const series = useMemo<SavingsSeries[]>(() => [{ id: SERIES_ID, data: points }], [points]);

  const ageByYr = useMemo(() => new Map(points.map((p) => [p.x, p.age] as const)), [points]);
  const tickValues = useMemo(
    () => thinYrTicks(points.map((p) => ({ yr: p.x, age: p.age }))),
    [points],
  );

  // 値域: 0 を基準に含め、マイナス年があれば負側へ広げる(上下に 5% の余白)。
  const bounds = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const p of points) {
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }
    const pad = (max - min) * 0.05;
    return {
      min: min === 0 ? 0 : Math.floor(min - pad),
      max: Math.ceil(max + pad),
    };
  }, [points]);

  const hasNegative = bounds.min < 0;

  const layers = useMemo<LineSvgLayer<SavingsSeries>[]>(
    () => [
      'grid',
      makeSelectedYearLayer(selectedYear == null ? null : String(selectedYear)),
      'markers',
      'axes',
      'areas',
      'lines',
      'points',
      'mesh',
    ],
    [selectedYear],
  );

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4"
      aria-label="現預金残高の推移グラフ"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">現預金残高の推移</h3>
        <LegendChip color={COLORS.savings} label="年末の現預金残高" />
      </div>

      {points.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
          入力に基づく結果がありません
        </div>
      ) : (
        <div style={{ height: 320 }}>
          <ResponsiveLine<SavingsSeries>
            data={series}
            margin={{ top: 16, right: 24, bottom: 52, left: 64 }}
            xScale={{ type: 'point' }}
            yScale={{ type: 'linear', min: bounds.min, max: bounds.max }}
            colors={[COLORS.savings]}
            theme={nivoTheme}
            lineWidth={2}
            pointSize={6}
            pointColor={(ctx: { point: { data: SavingsPoint } }) =>
              ctx.point.data.y < 0 ? COLORS.negative : COLORS.savings
            }
            pointBorderWidth={1}
            pointBorderColor="#ffffff"
            enableArea
            areaBaselineValue={0}
            areaOpacity={0.08}
            enableGridX={false}
            axisLeft={{
              format: (v) => formatMan(Number(v)),
              legend: '現預金残高（万円）',
              legendOffset: -52,
              legendPosition: 'middle',
            }}
            axisBottom={{ tickValues, renderTick: makeYearAgeTick(ageByYr) }}
            markers={
              hasNegative
                ? [
                    {
                      axis: 'y',
                      value: 0,
                      lineStyle: {
                        stroke: COLORS.negative,
                        strokeWidth: 1,
                        strokeDasharray: '4 4',
                      },
                    },
                  ]
                : []
            }
            layers={layers}
            tooltip={SavingsTooltip}
            useMesh
            enableCrosshair={false}
            onClick={(datum) => {
              if (isPoint(datum)) setSelectedYear(datum.data.year);
            }}
            isInteractive
          />
        </div>
      )}
    </section>
  );
}
