/**
 * プラン概要(F-09。issue #12 / SPEC.md 4.1)。
 *
 * 入力フィールドの上に表示するアクティブプランの見出し。
 * - プラン名をここで編集する(タブのダブルクリック編集は廃止)。名前は全タブでユニーク。
 * - 「変更を保存」でアクティブタブを上書き保存、「変更を破棄」で最後の保存内容へ戻す。
 *   どちらも未保存の変更があるときのみ有効。Cmd+S(Windows は Ctrl+S)でも保存できる。
 *
 * 保存先はブラウザの localStorage のみ(ストアの persist 経由)。外部送信はしない。
 */
import { useEffect, useState } from 'react';
import { isTabDirty, useSimulationStore } from '../../stores/simulationStore';

export function PlanSummary() {
  const activeTabId = useSimulationStore((s) => s.activeTabId);
  const tabs = useSimulationStore((s) => s.tabs);
  const renameTab = useSimulationStore((s) => s.renameTab);
  const saveActiveTab = useSimulationStore((s) => s.saveActiveTab);
  const discardActiveTabChanges = useSimulationStore((s) => s.discardActiveTabChanges);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const dirty = activeTab ? isTabDirty(activeTab) : false;
  const storedName = activeTab?.name ?? '';

  // 入力中は表示テキスト(ローカル state)のみ更新し、確定(blur / Enter)でストアへ反映する。
  // タブ切替やユニーク化による改名でストア側の名前が変わったら表示を同期する。
  const [name, setName] = useState(storedName);
  useEffect(() => {
    setName(storedName);
  }, [activeTabId, storedName]);

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

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== storedName) {
      renameTab(activeTabId, trimmed);
    } else {
      setName(storedName); // 空・無変更は元へ戻す。
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 pb-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">プラン名</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setName(storedName);
              e.currentTarget.blur();
            }
          }}
          maxLength={50}
          placeholder="プラン名"
          className="rounded-md border border-slate-300 px-2 py-1 text-base font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={saveActiveTab}
          disabled={!dirty}
          className="shrink-0 whitespace-nowrap rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          title="変更を保存(Cmd/Ctrl+S)"
        >
          変更を保存
        </button>
        <button
          type="button"
          onClick={discardActiveTabChanges}
          disabled={!dirty}
          className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          title="最後に保存した内容へ戻す"
        >
          変更を破棄
        </button>
        {dirty && (
          <span className="truncate text-xs text-sky-600" title="未保存の変更があります">
            未保存
          </span>
        )}
      </div>
    </div>
  );
}
