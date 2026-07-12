/**
 * 資産推移グラフ(SPEC.md 2.4 F-07 メイン)。
 *
 * === スロット: #10(グラフ T8)の実装先 ===
 * 現状はプレースホルダ。#10 はこのファイル内で nivo による資産推移グラフ
 * (預金残高・投資資産の積み上げ、総資産の折れ線)を実装する。
 * 結果は `useSimulationResult()` から取得し、年クリック時は
 * `useSimulationStore.getState().setSelectedYear(year)` で選択年を設定する。
 */
import { useSimulationResult } from '../../stores/simulationStore';

export function AssetChartSection() {
  const result = useSimulationResult();

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-base font-semibold text-slate-800">資産推移グラフ</h3>
      <div className="flex h-40 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
        資産推移グラフはここに実装されます(#10)。計算済み: {result.length} 年分
      </div>
    </section>
  );
}
