/**
 * プランタブバー(F-09。issue #12 / SPEC.md 4.1)。
 *
 * ヘッダー直下に Chrome ライクなタブを表示する。
 * - 各タブ = 1 プラン。タブ切替でそのプランの入力に切り替わり、即時再計算される。
 * - 「+」で新規プランタブを追加、末尾がアクティブになる。
 * - 上書き保存は「保存」ボタン、または Cmd+S(Windows は Ctrl+S)。
 * - 未保存(ドラフトが保存内容と異なる)のタブは名前の横に ◯ を表示する。
 * - タブの「×」で閉じる操作は削除確認ダイアログを挟む。
 * - タブ名はダブルクリックでインライン編集できる。
 *
 * 保存先はブラウザの localStorage のみ(ストアの persist 経由)。外部送信はしない。
 */
import { useEffect, useState } from 'react';
import { isTabDirty, useSimulationStore } from '../../stores/simulationStore';

export function PlanTabs() {
  const tabs = useSimulationStore((s) => s.tabs);
  const activeTabId = useSimulationStore((s) => s.activeTabId);
  const addTab = useSimulationStore((s) => s.addTab);
  const selectTab = useSimulationStore((s) => s.selectTab);
  const closeTab = useSimulationStore((s) => s.closeTab);
  const renameTab = useSimulationStore((s) => s.renameTab);
  const saveActiveTab = useSimulationStore((s) => s.saveActiveTab);

  // 削除確認ダイアログの対象タブ ID(null で非表示)。
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  // インライン改名中のタブ ID と編集中テキスト。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Cmd+S / Ctrl+S でアクティブタブを上書き保存する(ブラウザの保存ダイアログは抑止)。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveActiveTab]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeDirty = activeTab ? isTabDirty(activeTab) : false;
  const pendingTab = tabs.find((t) => t.id === pendingCloseId) ?? null;

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };
  const commitRename = () => {
    if (editingId) {
      const name = editingName.trim();
      if (name) renameTab(editingId, name);
    }
    setEditingId(null);
  };

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 pt-1.5">
      <div className="flex flex-1 items-end gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const dirty = isTabDirty(tab);
          return (
            <div
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              className={`group flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${
                active
                  ? 'border-slate-200 bg-white text-slate-800'
                  : 'border-transparent text-slate-500 hover:bg-slate-100'
              }`}
            >
              {dirty && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full border border-slate-400"
                  title="未保存の変更があります"
                />
              )}
              {editingId === tab.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  maxLength={50}
                  className="w-28 rounded border border-slate-300 px-1 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              ) : (
                <span
                  className="truncate"
                  title={`${tab.name}(ダブルクリックで名前を変更)`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(tab.id, tab.name);
                  }}
                >
                  {tab.name}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingCloseId(tab.id);
                }}
                className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                aria-label={`${tab.name} を閉じる`}
                title="タブを閉じる"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addTab}
          className="mb-1 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-lg leading-none text-slate-500 hover:bg-slate-200"
          aria-label="プランを追加"
          title="プランを追加"
        >
          +
        </button>
      </div>

      <button
        type="button"
        onClick={saveActiveTab}
        disabled={!activeDirty}
        className="mb-1 shrink-0 rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        title="上書き保存(Cmd/Ctrl+S)"
      >
        保存
      </button>

      {pendingTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setPendingCloseId(null)}
        >
          <div
            className="w-80 rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-slate-800">このプランを削除しますか?</p>
            <p className="mt-1 truncate text-xs text-slate-500">
              「{pendingTab.name}」は削除され、元に戻せません。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCloseId(null)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  closeTab(pendingTab.id);
                  setPendingCloseId(null);
                }}
                className="rounded-md bg-rose-600 px-3 py-1 text-sm font-medium text-white hover:bg-rose-700"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
