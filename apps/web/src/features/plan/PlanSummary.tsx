/**
 * プラン概要(F-09。issue #12 / SPEC.md 4.1)。
 *
 * 入力フィールドの上に表示するアクティブプランの見出し。
 * - プラン名をここで編集する(タブのダブルクリック編集は廃止)。名前は全タブでユニーク。
 * - 「変更を保存」でアクティブタブを上書き保存、「変更を破棄」で最後の保存内容へ戻す。
 *   どちらも未保存の変更があるときのみ有効。Cmd+S(Windows は Ctrl+S)でも保存できる。
 *   保存すると「保存しました」トーストを表示する(#65)。
 * - 「複製」で現在のプランを複製し、複製タブをアクティブにする(#45)。
 * - 「エクスポート」で選択したプランを 1 つの JSON ファイルとしてダウンロード、
 *   「インポート」で JSON ファイルからプランを新規タブとして復元する(#71)。
 *   どちらも完了時にトースト(#65)で件数を通知する。外部送信はしない。
 *
 * 保存先はブラウザの localStorage のみ(ストアの persist 経由)。外部送信はしない。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTabDirty, useSimulationStore } from '../../stores/simulationStore';
import { showToast } from '../../stores/toastStore';
import { downloadPlans, parseImportFile, PlanImportError } from './planTransfer';

export function PlanSummary() {
  const activeTabId = useSimulationStore((s) => s.activeTabId);
  const tabs = useSimulationStore((s) => s.tabs);
  const renameTab = useSimulationStore((s) => s.renameTab);
  const saveActiveTab = useSimulationStore((s) => s.saveActiveTab);
  const discardActiveTabChanges = useSimulationStore((s) => s.discardActiveTabChanges);
  const duplicateTab = useSimulationStore((s) => s.duplicateTab);
  const addImportedPlans = useSimulationStore((s) => s.addImportedPlans);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const dirty = activeTab ? isTabDirty(activeTab) : false;
  const storedName = activeTab?.name ?? '';

  // 入力中は表示テキスト(ローカル state)のみ更新し、確定(blur / Enter)でストアへ反映する。
  // タブ切替やユニーク化による改名でストア側の名前が変わったら表示を同期する。
  const [name, setName] = useState(storedName);
  useEffect(() => {
    setName(storedName);
  }, [activeTabId, storedName]);

  // 保存はボタンと Cmd/Ctrl+S の2経路。どちらも保存後に「保存しました」トーストを出す(#65)。
  const save = useCallback(() => {
    saveActiveTab();
    showToast('保存しました');
  }, [saveActiveTab]);

  // Cmd+S / Ctrl+S でアクティブタブを上書き保存する(ブラウザの保存ダイアログは抑止)。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== storedName) {
      renameTab(activeTabId, trimmed);
    } else {
      setName(storedName); // 空・無変更は元へ戻す。
    }
  };

  // --- エクスポート(#71) ---------------------------------------------------
  // 選択ダイアログの開閉と、チェックされたプラン(タブ ID)の集合。
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ダイアログを開くたびに全タブを選択状態(デフォルト全選択)にする。
  const openExport = () => {
    setSelectedIds(new Set(tabs.map((t) => t.id)));
    setExportOpen(true);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runExport = () => {
    // 選択されたタブの現在編集中の内容(draftInput)を書き出す(ユーザー確認済み)。
    const plans = tabs
      .filter((t) => selectedIds.has(t.id))
      .map((t) => ({ name: t.name, input: t.draftInput }));
    if (plans.length === 0) return;
    downloadPlans(plans);
    setExportOpen(false);
    showToast(`${plans.length}件のプランをエクスポートしました`);
  };

  // --- インポート(#71) -----------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同じファイルを続けて選べるよう、読み取り後に input を必ずリセットする。
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const plans = parseImportFile(text);
      addImportedPlans(plans);
      showToast(`${plans.length}件のプランをインポートしました`);
    } catch (err) {
      // 不正なファイル・新しすぎる version などは中断してエラー表示(既存タブは壊さない)。
      const message =
        err instanceof PlanImportError ? err.message : 'ファイルのインポートに失敗しました';
      showToast(message);
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
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
        <button
          type="button"
          onClick={() => duplicateTab(activeTabId)}
          className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          title="このプランを複製して新しいタブを開く"
        >
          複製
        </button>
        <button
          type="button"
          onClick={openExport}
          className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          title="プランを JSON ファイルに書き出す"
        >
          エクスポート
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          title="JSON ファイルからプランを読み込む"
        >
          インポート
        </button>
        {/* import 用の非表示ファイル入力。ボタンから click() で開く。 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onFileSelected}
        />
        {dirty && (
          <span className="truncate text-xs text-sky-600" title="未保存の変更があります">
            未保存
          </span>
        )}
      </div>

      {exportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setExportOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-96 flex-col rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-slate-800">エクスポートするプランを選択</p>
            <p className="mt-1 text-xs text-slate-500">
              選択したプランを 1 つの JSON ファイルとしてダウンロードします(外部送信はしません)。
            </p>
            <div className="mt-3 flex flex-col gap-1 overflow-y-auto">
              {tabs.map((tab) => (
                <label
                  key={tab.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(tab.id)}
                    onChange={() => toggleSelected(tab.id)}
                    className="h-4 w-4 shrink-0 accent-sky-600"
                  />
                  <span className="truncate" title={tab.name}>
                    {tab.name}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={runExport}
                disabled={selectedIds.size === 0}
                className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                エクスポート
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
