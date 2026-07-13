/**
 * プランタブバー(F-09。issue #12 / SPEC.md 4.1)。
 *
 * ヘッダー直下に Chrome ライクなタブを表示する。
 * - 各タブ = 1 プラン。タブ切替でそのプランの入力に切り替わり、即時再計算される。
 * - 「+」で新規プランタブを追加、末尾がアクティブになる。
 * - 未保存(ドラフトが保存内容と異なる)のタブは名前の右に青い ● を表示する。
 * - タブの「×」で閉じる操作は削除確認ダイアログを挟む。
 * - タブを右クリック(コンテキストメニュー)すると「複製」でき、複製タブが直後に開く(#45)。
 * - プラン名の編集・保存/破棄は入力上部の「プラン概要」(PlanSummary)で行う。
 * - アクティブタブは下境界を持たず、直下のプラン内容(白い入力パネル)へつながる。
 */
import { useEffect, useState } from 'react';
import { isTabDirty, useSimulationStore } from '../../stores/simulationStore';

export function PlanTabs() {
  const tabs = useSimulationStore((s) => s.tabs);
  const activeTabId = useSimulationStore((s) => s.activeTabId);
  const addTab = useSimulationStore((s) => s.addTab);
  const duplicateTab = useSimulationStore((s) => s.duplicateTab);
  const selectTab = useSimulationStore((s) => s.selectTab);
  const closeTab = useSimulationStore((s) => s.closeTab);

  // 削除確認ダイアログの対象タブ ID(null で非表示)。
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);

  // 右クリックのコンテキストメニュー(対象タブ ID と表示座標。null で非表示)。
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null,
  );

  // メニュー表示中は、外側クリック・Escape・スクロールで閉じる。
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const pendingTab = tabs.find((t) => t.id === pendingCloseId) ?? null;
  const contextTab = tabs.find((t) => t.id === contextMenu?.tabId) ?? null;

  return (
    <div className="flex items-end gap-1 overflow-x-auto bg-slate-100 px-3 pt-2">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const dirty = isTabDirty(tab);
        return (
          <div
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
            className={`group flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border px-3 py-1.5 text-sm ${
              active
                ? // 下境界を透明にし -mb-px で 1px 重ね、白い入力パネルへ継ぎ目なくつなげる。
                  '-mb-px border-slate-200 border-b-transparent bg-white text-slate-800'
                : 'border-transparent text-slate-500 hover:bg-slate-200/70'
            }`}
          >
            <span className="truncate" title={tab.name}>
              {tab.name}
            </span>
            {dirty && (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-sky-500"
                title="未保存の変更があります"
              />
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

      {contextMenu && contextTab && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              duplicateTab(contextTab.id);
              setContextMenu(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100"
          >
            複製
          </button>
        </div>
      )}

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
