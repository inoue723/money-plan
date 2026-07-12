/**
 * 入力パネル(S-01 左サイドパネル)。
 *
 * === スロット: #9(入力フォーム T7)の実装先 ===
 * 現状はプレースホルダ。#9 はこのファイル内で「基本情報 / 収入 / 支出 / ライフイベント / 投資」
 * のアコーディオン式フォーム(SPEC.md 3.2)を実装する。値の読み書きは
 * `useSimulationStore` の各 setter(setBasic / setIncome / ...)経由で行い、
 * App.tsx / stores 定義は編集しない方針。
 */
import { useSimulationStore } from '../../stores/simulationStore';

export function InputPanel() {
  // ストア入力への疎通確認(#9 実装時はフォームの初期値として利用する)。
  const basic = useSimulationStore((s) => s.input.basic);
  const income = useSimulationStore((s) => s.input.income);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-slate-800">入力</h2>
      <p className="text-sm text-slate-500">
        入力フォーム(基本情報 / 収入 / 支出 / ライフイベント / 投資)はここに実装されます。
        <span className="text-slate-400">(#9)</span>
      </p>

      {/* 疎通確認: デフォルト入力がストアから読めていること */}
      <dl className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <div className="flex justify-between py-0.5">
          <dt>現在の年齢</dt>
          <dd className="font-medium">{basic.currentAge} 歳</dd>
        </div>
        <div className="flex justify-between py-0.5">
          <dt>終了年齢</dt>
          <dd className="font-medium">{basic.endAge} 歳</dd>
        </div>
        <div className="flex justify-between py-0.5">
          <dt>年収(額面)</dt>
          <dd className="font-medium">{income.salary} 万円</dd>
        </div>
      </dl>
    </div>
  );
}
