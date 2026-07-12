/**
 * 資産推移グラフ(SPEC.md 2.4 F-07 メイン / 画面 S-01)。
 *
 * === スロット: #10(グラフ T8)の実装先 ===
 * nivo(@nivo/bar)で資産推移を描画する。
 * - 横軸: 年(西暦 + 本人年齢を2段で併記)、縦軸: 金額(万円)
 * - 系列: 預金残高・投資資産を積み上げ棒、総資産を折れ線でオーバーレイ
 * - 総資産がマイナスの年は警告色で帯を強調、当年の点も警告色にする
 * - ライフイベント発生年に縦ガイド + マーカー(ホバーでイベント名)
 * - ホバーで該当年の主要数値をツールチップ表示
 * - 棒/点クリックでその年を選択(`setSelectedYear`)し、#11 の年次内訳が購読する
 *
 * 結果は `useSimulationResult()` から取得する(再計算は行わない)。
 */
import { useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import type { BarDatum, BarLayer, BarTooltipProps, ComputedDatum } from '@nivo/bar';
import { useSimulationResult, useSimulationStore } from '../../stores/simulationStore';
import {
  COLORS,
  computeValueBounds,
  formatMan,
  makeEventMarkerLayer,
  makeNegativeHighlightLayer,
  makeSelectedHighlightLayer,
  makeValueLineLayer,
  makeYearAgeTick,
  nivoTheme,
  thinYrTicks,
} from './chartKit';

interface AssetDatum extends BarDatum {
  yr: string;
  year: number;
  age: number;
  預金: number;
  投資: number;
  total: number;
  eventLabel: string;
}

const ASSET_KEYS = ['預金', '投資'];

const assetColor = (id: string): string => (id === '預金' ? COLORS.savings : COLORS.investment);

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

function AssetTooltip({ data }: BarTooltipProps<AssetDatum>) {
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
      {row(COLORS.savings, '預金', data.預金)}
      {row(COLORS.investment, '投資', data.投資)}
      <div className="my-1 border-t border-slate-100" />
      {row(COLORS.total, '総資産', data.total, true)}
      {data.eventLabel && (
        <div className="mt-1 text-[11px] text-violet-600">◆ {data.eventLabel}</div>
      )}
    </div>
  );
}

export function AssetChartSection() {
  const result = useSimulationResult();
  const selectedYear = useSimulationStore((s) => s.selectedYear);
  const setSelectedYear = useSimulationStore((s) => s.setSelectedYear);

  const data = useMemo<AssetDatum[]>(
    () =>
      result.map((r) => ({
        yr: String(r.year),
        year: r.year,
        age: r.age,
        預金: Math.round(r.savings),
        投資: Math.round(r.investmentValue),
        total: Math.round(r.totalAssets),
        eventLabel: r.events.join('、'),
      })),
    [result],
  );

  const ageByYr = useMemo(
    () => new Map(data.map((d) => [d.yr, d.age] as const)),
    [data],
  );
  const tickValues = useMemo(() => thinYrTicks(data), [data]);
  const bounds = useMemo(() => computeValueBounds(data, ASSET_KEYS, (d) => d.total), [data]);

  const layers = useMemo<BarLayer<AssetDatum>[]>(
    () => [
      makeNegativeHighlightLayer<AssetDatum>(data, (d) => d.total),
      makeSelectedHighlightLayer<AssetDatum>(selectedYear == null ? null : String(selectedYear)),
      'grid',
      'axes',
      'bars',
      makeValueLineLayer<AssetDatum>(data, (d) => d.total, COLORS.total),
      makeEventMarkerLayer<AssetDatum>(data),
    ],
    [data, selectedYear],
  );

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4"
      aria-label="資産推移グラフ"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">資産推移グラフ</h3>
        <div className="flex flex-wrap items-center gap-3">
          <LegendChip color={COLORS.savings} label="預金" />
          <LegendChip color={COLORS.investment} label="投資" />
          <LegendChip color={COLORS.total} label="総資産" line />
          <LegendChip color={COLORS.event} label="イベント" />
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
          入力に基づく結果がありません
        </div>
      ) : (
        <div style={{ height: 320 }}>
          <ResponsiveBar<AssetDatum>
            data={data}
            keys={ASSET_KEYS}
            indexBy="yr"
            margin={{ top: 16, right: 24, bottom: 52, left: 64 }}
            padding={0.25}
            valueScale={{ type: 'linear', min: bounds.min, max: bounds.max }}
            indexScale={{ type: 'band', round: true }}
            colors={({ id }) => assetColor(String(id))}
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
            tooltip={AssetTooltip}
            onClick={(datum: ComputedDatum<AssetDatum>) => setSelectedYear(datum.data.year)}
            isInteractive
          />
        </div>
      )}
    </section>
  );
}
