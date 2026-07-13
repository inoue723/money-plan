/**
 * プラン保存・読込 UI(F-09。issue #12 / SPEC.md 4.1)。
 *
 * - 現在の入力条件一式に名前を付けて保存し、保存済みプランからの読込・削除を行う。
 * - 保存先はブラウザの localStorage のみ(#8 ストアの persist 経由)。外部送信はしない。
 * - 入力パネル(InputPanel)上部に配置する。読込むとストアの入力 state 全体が置換され、
 *   既存の即時再計算パイプライン(useSimulationResult)経由でグラフ/内訳へ反映される。
 */
import { useState } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';

/** 保存時刻(epoch ミリ秒)を「YYYY/M/D HH:mm」形式で表示する。 */
function formatSavedAt(savedAt: number): string {
  const d = new Date(savedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function PlanManager() {
  const plans = useSimulationStore((s) => s.plans);
  const savePlan = useSimulationStore((s) => s.savePlan);
  const loadPlan = useSimulationStore((s) => s.loadPlan);
  const deletePlan = useSimulationStore((s) => s.deletePlan);

  const [name, setName] = useState('');

  const trimmed = name.trim();
  const canSave = trimmed.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    savePlan(trimmed);
    setName('');
  };

  // 新しく保存したものを上に表示する。
  const sortedPlans = [...plans].sort((a, b) => b.savedAt - a.savedAt);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">プラン</h3>
        <span className="text-[11px] text-slate-400">ブラウザ内に保存(外部送信なし)</span>
      </div>

      {/* 保存フォーム */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
          placeholder="プラン名を入力"
          maxLength={50}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="shrink-0 rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          保存
        </button>
      </div>

      {/* 保存済みプラン一覧 */}
      {sortedPlans.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          保存済みのプランはありません。現在の入力条件を名前を付けて保存できます。
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sortedPlans.map((plan) => (
            <li
              key={plan.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-800" title={plan.name}>
                  {plan.name}
                </div>
                <div className="text-[11px] text-slate-400">{formatSavedAt(plan.savedAt)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => loadPlan(plan.id)}
                  className="rounded-md border border-sky-300 px-2 py-0.5 text-xs font-medium text-sky-600 hover:bg-sky-50"
                >
                  読込
                </button>
                <button
                  type="button"
                  onClick={() => deletePlan(plan.id)}
                  className="rounded-md border border-rose-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50"
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
