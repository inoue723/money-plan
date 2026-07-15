/**
 * 共通トーストの描画(issue #65)。
 *
 * - 状態と表示トリガー(`showToast`)は `stores/toastStore.ts` に置く。
 * - `<ToastViewport/>` は App のルートに1つだけマウントする。画面右下に表示し、
 *   TOAST_DURATION_MS 経過後に自動で消える(同時表示は最新1件のみ)。
 */
import { useEffect } from 'react';
import { TOAST_DURATION_MS, useToastStore } from '../stores/toastStore';

/** トーストの描画先。App のルートに1つだけマウントする。 */
export function ToastViewport() {
  const toast = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-50 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-lg"
    >
      {toast.message}
    </div>
  );
}
