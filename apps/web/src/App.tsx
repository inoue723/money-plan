/**
 * アプリのルート。S-01 メイン画面(SPEC.md 3.1 / 3.2)を構成する。
 *
 * レイアウト方針(後続チケットはこのファイルを極力編集しない):
 * - 左サイドパネル = 入力フォーム領域 → <InputPanel/>(#9)
 * - 右メイン       = 結果領域        → <ResultPanel/>(内部で #10 / #11 のセクションを合成)
 * - 下部           = 免責 + プライバシー(SPEC.md 1.4 / 4.1)
 * - 対象は PC のみ。最小画面幅 1280px(SPEC.md 3.2 / 5、min-width は index.css で確保)。
 */
import { InputPanel } from './features/input/InputPanel';
import { ResultPanel } from './features/result/ResultPanel';
import { PlanTabs } from './features/plan/PlanTabs';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { ToastViewport } from './components/Toast';

export function App() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-xl font-bold">資産推移シミュレーション</h1>
      </header>

      {/* プランタブ(F-09。ヘッダー直下に Chrome ライクなタブを表示) */}
      <PlanTabs />

      {/* S-01: 左=入力サイドパネル / 右=結果メイン */}
      <div className="flex flex-1 items-stretch">
        <aside className="w-96 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-6">
          {/* スロット: 入力フォーム(#9) */}
          <InputPanel />
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {/* スロット合成: 結果領域(#10 グラフ / #11 年次内訳) */}
          <ResultPanel />
        </main>
      </div>

      <DisclaimerBanner />

      {/* トースト通知(#65。画面状態によらず表示できるようルート直下に置く) */}
      <ToastViewport />
    </div>
  );
}
