/**
 * 資産推移グラフ(issue #29 / #70 / 画面 S-01)。
 *
 * nivo(@nivo/line)で各年末時点の資産を1つのグラフに重ねて描画する。
 * - 投資資産評価額(`YearlyResult.investmentValue`・万円)を棒(カスタムレイヤ)
 * - 現預金残高(`YearlyResult.savings`・万円)を折れ線
 * - 横軸: 年(西暦 + 本人年齢を2段で併記)、縦軸: 金額(万円・両系列で共有)
 * - ホバーで 年・年齢・現預金残高・投資資産 をツールチップ表示
 * - 現預金がマイナスの年があっても値域を負側へ広げて描画し、0 のガイド線を引く
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
  /** 年末の投資資産評価額(万円・万円未満切り捨て。非負)。 */
  investment: number;
  year: number;
  age: number;
}

interface SavingsSeries {
  id: string;
  data: readonly SavingsPoint[];
}

const SERIES_ID = '現預金残高';

/** 棒の見た目。棒幅は隣接年の間隔に対する比率で決め、太くなりすぎないよう上限を設ける。 */
const BAR_WIDTH_RATIO = 0.6;
const BAR_MAX_WIDTH = 24;
const BAR_OPACITY = 0.75;

function LegendChip({
  color,
  label,
  variant = 'line',
}: {
  color: string;
  label: string;
  /** 凡例マークの形状(折れ線なら線、棒なら塗り四角)。 */
  variant?: 'line' | 'bar';
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      {variant === 'bar' ? (
        <span
          className="inline-block"
          style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }}
        />
      ) : (
        <span
          className="inline-block"
          style={{ width: 14, height: 0, borderTop: `2px solid ${color}` }}
        />
      )}
      {label}
    </span>
  );
}

function SavingsTooltip({ point }: PointTooltipProps<SavingsSeries>) {
  const { year, age, y, investment } = point.data;
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
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: COLORS.investment,
            }}
          />
          投資資産
        </span>
        <span className="font-semibold">{formatMan(investment)}万円</span>
      </div>
    </div>
  );
}

/**
 * 各年の投資資産評価額を棒で描くカスタムレイヤを生成する。
 *
 * 折れ線の背面(grid の直後)に差し込む。棒自体はポインタイベントを持たず、
 * ホバー・クリックの判定は従来どおり mesh レイヤが担う(棒の上をクリックしても
 * その年の点が最近傍として選択される)。
 */
function makeInvestmentBarsLayer(
  points: readonly SavingsPoint[],
): LineCustomSvgLayer<SavingsSeries> {
  return function InvestmentBarsLayer({ xScale, yScale, innerWidth }) {
    if (points.length === 0) return null;

    // x は point スケールで帯幅を持たないため、棒幅は隣接する2点の間隔から求める
    // (年が1件しかない場合は描画域の幅を間隔とみなす)。
    const first = points[0];
    const second = points[1];
    const step =
      first !== undefined && second !== undefined
        ? Math.abs(xScale(second.x) - xScale(first.x))
        : innerWidth;
    const barWidth = Math.max(2, Math.min(step * BAR_WIDTH_RATIO, BAR_MAX_WIDTH));

    // 投資資産評価額は非負なので、常に 0 を底として上向きに積む。
    const zeroY = yScale(0);
    if (!Number.isFinite(zeroY)) return null;

    return (
      <g style={{ pointerEvents: 'none' }}>
        {points.map((p) => {
          const cx = xScale(p.x);
          const topY = yScale(p.investment);
          if (!Number.isFinite(cx) || !Number.isFinite(topY)) return null;
          const height = zeroY - topY;
          if (height <= 0) return null; // 評価額 0 の年は棒を描かない

          // 端(初年度・最終年)の棒は点が描画域の縁に乗るため、はみ出さないよう幅を切り詰める。
          const left = Math.max(0, cx - barWidth / 2);
          const right = Math.min(innerWidth, cx + barWidth / 2);
          const width = right - left;
          if (width <= 0) return null;

          return (
            <rect
              key={p.x}
              x={left}
              y={topY}
              width={width}
              height={height}
              rx={2}
              fill={COLORS.investment}
              opacity={BAR_OPACITY}
            />
          );
        })}
      </g>
    );
  };
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
        investment: truncMan(r.investmentValue),
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

  // 値域: 0 を基準に含め、棒(投資資産)と折れ線(現預金)の両方が収まるようにする。
  // 現預金がマイナスの年があれば負側へ広げる(上下に 5% の余白)。投資資産は非負なので上側にのみ効く。
  const bounds = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const p of points) {
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
      if (p.investment > max) max = p.investment;
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
      // 棒 → 選択年ハイライトの順に重ねる(ハイライトの縦線が棒の背面に隠れないように)。
      makeInvestmentBarsLayer(points),
      makeSelectedYearLayer(selectedYear == null ? null : String(selectedYear)),
      'markers',
      'axes',
      'areas',
      'lines',
      'points',
      'mesh',
    ],
    [points, selectedYear],
  );

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4"
      aria-label="現預金残高の推移グラフ"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">現預金残高の推移</h3>
        <div className="flex items-center gap-3">
          <LegendChip color={COLORS.savings} label="年末の現預金残高" />
          <LegendChip color={COLORS.investment} label="投資資産" variant="bar" />
        </div>
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
              legend: '金額（万円）',
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
