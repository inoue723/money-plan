/**
 * トースト通知のストア(issue #65)。
 *
 * - 外部ライブラリは使わず、Zustand の小さなストアで「最新1件」だけを保持する。
 *   複数同時表示は不要なため、新しいトーストは既存のものを置き換える。
 * - 表示トリガーは module-level の `showToast(message)`。React の外(イベントハンドラや
 *   ストアのアクション)からも呼べるよう、フックではなく関数として公開する。
 *   保存完了(#65)のほか、後続機能(import 完了通知など)からも再利用できる。
 * - 描画は `components/Toast.tsx` の `<ToastViewport/>` が担当する。
 */
import { create } from 'zustand';

/** トーストの表示時間(ミリ秒)。 */
export const TOAST_DURATION_MS = 3000;

export type Toast = {
  /** 同じ文言を連続で表示したときもタイマーを貼り直せるよう、毎回ユニークな id を振る。 */
  id: number;
  message: string;
};

type ToastState = {
  toast: Toast | null;
  show: (message: string) => void;
  dismiss: (id: number) => void;
};

let nextToastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (message) => set({ toast: { id: ++nextToastId, message } }),
  // 表示中のトーストが既に別のものへ差し替わっている場合、古いタイマーで消さない。
  dismiss: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),
}));

/** トーストを表示する。`apps/web/src` 内のどこからでも呼べる。 */
export function showToast(message: string) {
  useToastStore.getState().show(message);
}
