/* eslint-disable react-refresh/only-export-components --
 * 本ファイルは React コンポーネントを描画する画面モジュールではなく、
 * グラフで共有する定数・テーマ・目盛描画関数を提供するヘルパーモジュール。
 * Fast Refresh の境界にならないため本ルールは対象外。 */
/**
 * グラフ共通ユーティリティ(SPEC.md 2.4 F-07)。
 *
 * 現預金残高グラフ(SavingsChartSection)で使う色定義・nivo テーマ・
 * 数値フォーマットと、横軸目盛(西暦 + 年齢の2段組)の描画関数をまとめる。
 *
 * ここでは React コンポーネントを named export しない(生成関数は camelCase の
 * ファクトリとして提供)。
 */

/**
 * nivo axis の renderTick に渡る props のうち本モジュールで使う最小フィールド。
 * `@nivo/axes` は @nivo/line の推移的依存であり直接 import しないため、ここで定義する。
 */
interface AxisTickLike {
  value: string;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 色・テーマ
// ---------------------------------------------------------------------------

/** グラフ全体で共有する色(Tailwind slate/blue 等に対応)。 */
export const COLORS = {
  savings: '#3b82f6', // 現預金残高の折れ線(blue-500)
  negative: '#ef4444', // 警告色: 残高マイナス年(red-500)
  selected: '#f59e0b', // 選択中の年のハイライト(amber-500)
  axis: '#cbd5e1', // 軸線(slate-300)
  axisText: '#475569', // 軸ラベル(slate-600)
  axisTextFaint: '#94a3b8', // 補助ラベル(slate-400)
  grid: '#e2e8f0', // グリッド(slate-200)
} as const;

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

/**
 * 万円の数値の整形(単位記号は呼び出し側で付与)。
 * 丸めはテーブル/CSV と共通のフォーマッタ(万円未満を0方向に切り捨て)に統一する(issue #27)。
 */
export { formatMan, truncMan } from './yearColumns';

// ---------------------------------------------------------------------------
// 軸目盛
// ---------------------------------------------------------------------------

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

/** 目盛が過密にならないよう、表示する年(yr)を間引く(既定: 5年刻み + 端)。 */
export function thinYrTicks(items: readonly { yr: string; age: number }[], step = 5): string[] {
  return items
    .filter((d, i) => d.age % step === 0 || i === 0 || i === items.length - 1)
    .map((d) => d.yr);
}
