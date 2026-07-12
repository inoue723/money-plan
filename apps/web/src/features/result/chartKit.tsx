/* eslint-disable react-refresh/only-export-components --
 * 本ファイルは React コンポーネントを描画する画面モジュールではなく、
 * グラフ間で共有する定数・テーマ・カスタムレイヤ生成関数を提供する
 * ヘルパーモジュール。Fast Refresh の境界にならないため本ルールは対象外。 */
/**
 * グラフ共通ユーティリティ(#10 / SPEC.md 2.4 F-07)。
 *
 * 資産推移グラフ・収支グラフの両方で使う色定義・nivo テーマ・数値フォーマットと、
 * nivo Bar の `layers` に差し込むカスタムレイヤ生成関数(折れ線オーバーレイ・
 * イベントマーカー・選択年/マイナス年ハイライト・2段組の年軸目盛)をまとめる。
 *
 * ここでは React コンポーネントを named export しない(生成関数は camelCase の
 * ファクトリとして提供)。折れ線や積み上げ棒とスケールを完全に一致させるため、
 * 折れ線は @nivo/line ではなく Bar のスケール(xScale/yScale)を共有する
 * カスタムレイヤとして描画する。
 */
import type { BarCustomLayer, BarCustomLayerProps, BarDatum } from '@nivo/bar';

/**
 * nivo axis の renderTick に渡る props のうち本モジュールで使う最小フィールド。
 * `@nivo/axes` は @nivo/bar の推移的依存であり直接 import しないため、ここで定義する。
 */
interface AxisTickLike {
  value: string;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 色・テーマ
// ---------------------------------------------------------------------------

/** グラフ全体で共有する色(Tailwind slate/blue/emerald 等に対応)。 */
export const COLORS = {
  savings: '#3b82f6', // 預金(blue-500)
  investment: '#10b981', // 投資(emerald-500)
  total: '#0f172a', // 総資産の折れ線(slate-900)
  balance: '#0f172a', // 年間収支の折れ線(slate-900)
  negative: '#ef4444', // 警告色: 資産マイナス年(red-500)
  event: '#8b5cf6', // ライフイベントマーカー(violet-500)
  selected: '#f59e0b', // 選択中の年のハイライト(amber-500)
  axis: '#cbd5e1', // 軸線(slate-300)
  axisText: '#475569', // 軸ラベル(slate-600)
  axisTextFaint: '#94a3b8', // 補助ラベル(slate-400)
  grid: '#e2e8f0', // グリッド(slate-200)
} as const;

/** 収支グラフ 収入系列の色(正方向積み上げ)。 */
export const INCOME_COLORS: Record<string, string> = {
  手取り給与: '#059669', // emerald-600
  年金: '#0d9488', // teal-600
  児童手当: '#22c55e', // green-500
  その他収入: '#84cc16', // lime-500
};

/** 収支グラフ 支出系列の色(負方向積み上げ)。 */
export const EXPENSE_COLORS: Record<string, string> = {
  住居費: '#f97316', // orange-500
  生活費: '#ef4444', // red-500
  教育費: '#a855f7', // purple-500
  保険料: '#ec4899', // pink-500
  固定費: '#f59e0b', // amber-500
  イベント費: '#64748b', // slate-500
};

/** nivo に渡す共通テーマ(フォント・軸・グリッド・ツールチップの体裁)。 */
export const nivoTheme = {
  text: { fontSize: 11, fill: COLORS.axisText },
  axis: {
    domain: { line: { stroke: COLORS.axis, strokeWidth: 1 } },
    ticks: { line: { stroke: COLORS.axis }, text: { fill: COLORS.axisText, fontSize: 10 } },
    legend: { text: { fill: COLORS.axisText, fontSize: 11 } },
  },
  grid: { line: { stroke: COLORS.grid, strokeWidth: 1 } },
  tooltip: { container: { background: '#ffffff', color: '#0f172a', fontSize: 12 } },
};

// ---------------------------------------------------------------------------
// フォーマット
// ---------------------------------------------------------------------------

/** 万円の数値を桁区切りで表示(単位記号は呼び出し側で付与)。 */
export const formatMan = (v: number): string => Math.round(v).toLocaleString('ja-JP');

// ---------------------------------------------------------------------------
// スケールの最小型(nivo の AnyScale を呼び出し可能な形に絞る)
// ---------------------------------------------------------------------------

type BandScaleLike = ((value: string) => number | undefined) & { bandwidth: () => number };
type LinearScaleLike = (value: number) => number;

const centerOf = (band: BandScaleLike, yr: string): number => (band(yr) ?? 0) + band.bandwidth() / 2;

// ---------------------------------------------------------------------------
// カスタムレイヤ生成関数
// ---------------------------------------------------------------------------

/**
 * 数値系列を折れ線で重ねるレイヤ(総資産 / 年間収支)。
 * 積み上げ棒と同じ xScale/yScale を共有するため、棒と目盛が完全に整合する。
 * 値が負の点は警告色で強調する。
 */
export function makeValueLineLayer<D extends BarDatum & { yr: string }>(
  data: readonly D[],
  getValue: (d: D) => number,
  color: string,
): BarCustomLayer<D> {
  return function ValueLineLayer({ xScale, yScale }: BarCustomLayerProps<D>) {
    const band = xScale as unknown as BandScaleLike;
    const lin = yScale as unknown as LinearScaleLike;
    if (data.length === 0) return null;
    const pts = data.map((d) => {
      const v = getValue(d);
      return { x: centerOf(band, d.yr), y: lin(v), v };
    });
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    return (
      <g>
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {pts.map((p) => (
          <circle
            key={p.x}
            cx={p.x}
            cy={p.y}
            r={2.5}
            fill={p.v < 0 ? COLORS.negative : color}
            stroke="#ffffff"
            strokeWidth={0.5}
          />
        ))}
      </g>
    );
  };
}

/**
 * ライフイベント発生年にマーカー(上部の三角 + 縦のガイド線)を描くレイヤ。
 * ネイティブの <title> でイベント名をホバー表示する(代替テキストの最小対応)。
 */
export function makeEventMarkerLayer<D extends BarDatum & { yr: string; eventLabel: string }>(
  data: readonly D[],
): BarCustomLayer<D> {
  return function EventMarkerLayer({ xScale, innerHeight }: BarCustomLayerProps<D>) {
    const band = xScale as unknown as BandScaleLike;
    return (
      <g>
        {data.map((d) => {
          if (!d.eventLabel) return null;
          const cx = centerOf(band, d.yr);
          return (
            <g key={d.yr}>
              <title>{`${d.yr}年: ${d.eventLabel}`}</title>
              <line
                x1={cx}
                x2={cx}
                y1={0}
                y2={innerHeight}
                stroke={COLORS.event}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.45}
              />
              <path d={`M${cx},0 L${cx - 5},-8 L${cx + 5},-8 Z`} fill={COLORS.event} />
            </g>
          );
        })}
      </g>
    );
  };
}

/** 選択中の年の帯を半透明でハイライトするレイヤ(#11 の内訳が購読する選択状態の可視化)。 */
export function makeSelectedHighlightLayer<D extends BarDatum & { yr: string }>(
  selectedYr: string | null,
): BarCustomLayer<D> {
  return function SelectedHighlightLayer({ xScale, innerHeight }: BarCustomLayerProps<D>) {
    if (!selectedYr) return null;
    const band = xScale as unknown as BandScaleLike;
    const left = band(selectedYr);
    if (left == null) return null;
    return (
      <rect
        x={left}
        y={0}
        width={band.bandwidth()}
        height={innerHeight}
        fill={COLORS.selected}
        opacity={0.18}
      />
    );
  };
}

/** 指定アクセサの値が負になる年の帯を警告色でハイライトするレイヤ(資産マイナス年の強調)。 */
export function makeNegativeHighlightLayer<D extends BarDatum & { yr: string }>(
  data: readonly D[],
  getValue: (d: D) => number,
): BarCustomLayer<D> {
  return function NegativeHighlightLayer({ xScale, innerHeight }: BarCustomLayerProps<D>) {
    const band = xScale as unknown as BandScaleLike;
    const width = band.bandwidth();
    return (
      <g>
        {data
          .filter((d) => getValue(d) < 0)
          .map((d) => (
            <rect
              key={d.yr}
              x={band(d.yr) ?? 0}
              y={0}
              width={width}
              height={innerHeight}
              fill={COLORS.negative}
              opacity={0.12}
            />
          ))}
      </g>
    );
  };
}

/** 横軸の目盛を「西暦 / 本人年齢」の2段組で描く renderTick を生成する。 */
export function makeYearAgeTick(ageByYr: ReadonlyMap<string, number>) {
  return function YearAgeTick(props: AxisTickLike): JSX.Element {
    const age = ageByYr.get(props.value);
    return (
      <g transform={`translate(${props.x},${props.y})`}>
        <line y1={0} y2={5} stroke={COLORS.axis} />
        <text textAnchor="middle" y={16} style={{ fontSize: 10, fill: COLORS.axisText }}>
          {props.value}
        </text>
        {age != null && (
          <text textAnchor="middle" y={28} style={{ fontSize: 9, fill: COLORS.axisTextFaint }}>
            {age}歳
          </text>
        )}
      </g>
    );
  };
}

/**
 * 積み上げ棒 + 折れ線の値域(min/max)を明示計算する。
 *
 * nivo の `minValue/maxValue: 'auto'` は符号混在の積み上げで負側の値域を
 * 0 に丸めてしまい、負方向の棒がプロット領域外へはみ出す。これを防ぐため、
 * 各年の「正の積み上げ合計 / 負の積み上げ合計 / 折れ線値」から実際の値域を求め、
 * わずかに余白を付けて返す。
 */
export function computeValueBounds<D extends BarDatum>(
  data: readonly D[],
  keys: readonly string[],
  getLine: (d: D) => number,
): { min: number; max: number } {
  let max = 0;
  let min = 0;
  for (const d of data) {
    let pos = 0;
    let neg = 0;
    for (const k of keys) {
      const v = Number(d[k]) || 0;
      if (v > 0) pos += v;
      else neg += v;
    }
    const line = getLine(d);
    max = Math.max(max, pos, line);
    min = Math.min(min, neg, line);
  }
  const pad = (max - min) * 0.05;
  return {
    min: min === 0 ? 0 : Math.floor(min - pad),
    max: Math.ceil(max + pad),
  };
}

/** 目盛が過密にならないよう、表示する年(yr)を間引く(既定: 5年刻み + 端)。 */
export function thinYrTicks(
  items: readonly { yr: string; age: number }[],
  step = 5,
): string[] {
  return items
    .filter((d, i) => d.age % step === 0 || i === 0 || i === items.length - 1)
    .map((d) => d.yr);
}
