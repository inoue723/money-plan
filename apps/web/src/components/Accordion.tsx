/**
 * アコーディオン(開閉セクション。共通入力UI。#9)。
 *
 * 入力フォームの各セクション(基本情報 / 収入 / 支出 / ライフイベント / 投資)を
 * 開閉できるようにする。開閉状態は各インスタンスのローカル state で保持する。
 */
import { useState, type ReactNode } from 'react';

export interface AccordionProps {
  title: string;
  /** 初期状態で開いておくか。 */
  defaultOpen?: boolean;
  /** タイトル右に表示する補助情報(件数など)。 */
  badge?: ReactNode;
  children: ReactNode;
}

export function Accordion({ title, defaultOpen = false, badge, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          {badge}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-slate-100 px-3 py-3">{children}</div>
      )}
    </section>
  );
}
