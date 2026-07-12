/**
 * 全期間の年次テーブル(SPEC.md 2.4 F-08 / 画面 S-03)。
 *
 * === スロット: #11(年次内訳 T9)の実装先 ===
 * 現状はプレースホルダ。#11 はこのファイル内で全期間の年次一覧テーブルと
 * CSV ダウンロードを実装する。結果は `useSimulationResult()` から取得し、
 * 行クリックで `setSelectedYear` を呼んで年次詳細と連動させる。
 */
import { useSimulationResult } from '../../stores/simulationStore';

export function YearTableSection() {
  const result = useSimulationResult();

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-base font-semibold text-slate-800">年次一覧テーブル</h3>
      <div className="flex h-24 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-400">
        年次一覧テーブルと CSV ダウンロードはここに実装されます(#11)。計算済み: {result.length} 行
      </div>
    </section>
  );
}
