/**
 * 収支グラフ(SPEC.md 2.4 F-07)。
 *
 * === スロット: #10(グラフ T8)の実装先 ===
 * 現状はプレースホルダ。#10 はこのファイル内で nivo による収支グラフ
 * (収入・支出の積み上げ棒 + 年間収支の折れ線)を実装する。
 * 結果は `useSimulationResult()` から取得する。
 */
import { useSimulationResult } from '../../stores/simulationStore';

export function CashflowChartSection() {
  const result = useSimulationResult();

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-base font-semibold text-slate-800">収支グラフ</h3>
      <div className="flex h-40 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
        収支グラフはここに実装されます(#10)。計算済み: {result.length} 年分
      </div>
    </section>
  );
}
