/**
 * 年次詳細内訳(SPEC.md 2.4 F-08 / 画面 S-02)。
 *
 * === スロット: #11(年次内訳 T9)の実装先 ===
 * 現状はプレースホルダ。#11 はこのファイル内で、選択年の収入・税・支出・資産の
 * カテゴリ別内訳を表形式で実装する。選択年は `useSimulationStore` の
 * `selectedYear` を購読し、対応する `YearlyResult` を `useSimulationResult()`
 * から引く。
 */
import { useSimulationResult, useSimulationStore } from '../../stores/simulationStore';

export function YearDetailSection() {
  const result = useSimulationResult();
  const selectedYear = useSimulationStore((s) => s.selectedYear);
  const selected = selectedYear == null ? undefined : result.find((r) => r.year === selectedYear);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-base font-semibold text-slate-800">年次詳細</h3>
      <div className="flex h-24 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
        {selected
          ? `${selected.year}年(${selected.age}歳)の内訳はここに実装されます(#11)`
          : '年を選択すると詳細内訳が表示されます(#11)'}
      </div>
    </section>
  );
}
