/**
 * 計算根拠ツールチップ(CF表のセル用)。
 *
 * finance-core の計算根拠ツリー(CalcNode)を受け取り、セルのホバーで
 * 「label = 値」と計算式(例: 2,000万円(退職金 額面) − 122.93万円(所得税) − 80万円(住民税))を表示する。
 * 式中の項のうち、さらに根拠(formula / notes)を持つものはクリックでその項の式を
 * 直下にインデント展開できる(ドリルダウン)。
 *
 * 開閉の仕様:
 * - ホバーで表示(パネルへポインタを移しても閉じない。離れて 150ms 後に閉じる)。
 * - トリガーのクリック/タップでピン留め(モバイル対応)。再クリック・Escape・外側クリックで解除。
 * - CF表は overflow-auto のスクロール box 内にあるため、パネルは createPortal + position:fixed で
 *   body 直下に描画してクリップを回避する(全画面表示オーバーレイ z-50 より上の z-[60])。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  formatNodeRef,
  formatNodeValue,
  type CalcNode,
  type CalcNote,
} from '@money-plan/finance-core';

/** パネルの最大幅(px)。Tailwind の max-w-sm(24rem)に合わせる。 */
const PANEL_MAX_WIDTH = 384;
/** ポインタがトリガー/パネルから離れてから閉じるまでの猶予(ms)。 */
const CLOSE_DELAY_MS = 150;
/** パネルを下に出すのに必要な最低の空き高さ(px)。足りなければ上に反転する。 */
const MIN_SPACE_BELOW = 240;

/** この項からさらにドリルダウンできるか(根拠の式か注記を持つか)。 */
const canExpand = (node: CalcNode): boolean =>
  (node.formula?.length ?? 0) > 0 || (node.notes?.length ?? 0) > 0;

/** 注記(info: 補足 / warning: アラート)の小ボックス表示。 */
function NodeNotes({ notes }: { notes?: CalcNote[] }) {
  if (!notes || notes.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {notes.map((note, i) => (
        <p
          key={i}
          className={
            note.severity === 'warning'
              ? 'rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700'
              : 'rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-500'
          }
        >
          {note.text}
        </p>
      ))}
    </div>
  );
}

/**
 * ノードの計算式 + 注記の描画(再帰)。式中のドリルダウン可能な項はボタンにし、
 * クリックでその項の「label = 値」と式を直下にインデント展開する。
 * hidden の項は先行する演算子(op)ごと表示しない。
 */
function CalcNodeBody({ node }: { node: CalcNode }) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggle = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const parts = node.formula ?? [];
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 leading-5">
        {parts.map((part, i) => {
          if (typeof part === 'string') {
            return (
              <span key={i} className="text-slate-500">
                {part}
              </span>
            );
          }
          if (part.node.hidden) return null;
          return (
            <span key={i} className="whitespace-nowrap">
              {part.op && <span className="text-slate-500">{part.op} </span>}
              {canExpand(part.node) ? (
                <button
                  type="button"
                  aria-expanded={expanded.has(i)}
                  onClick={() => toggle(i)}
                  className="cursor-pointer text-sky-700 underline decoration-dotted decoration-sky-400 underline-offset-2 hover:text-sky-900"
                >
                  {formatNodeRef(part.node)}
                </button>
              ) : (
                <span className="text-slate-700">{formatNodeRef(part.node)}</span>
              )}
            </span>
          );
        })}
      </div>
      {parts.map((part, i) => {
        if (typeof part === 'string' || part.node.hidden || !expanded.has(i)) return null;
        return (
          <div key={`expand-${i}`} className="mt-1 border-l border-slate-200 pl-3">
            <p className="font-medium text-slate-700">
              {part.node.label} = {formatNodeValue(part.node)}
            </p>
            <CalcNodeBody node={part.node} />
          </div>
        );
      })}
      <NodeNotes notes={node.notes} />
    </div>
  );
}

/**
 * セル値を計算根拠ツールチップ付きで表示するトリガー。
 * `children` にはセルの表示値(整形済みテキスト)を渡す。
 */
export function CalcTooltip({ node, children }: { node: CalcNode; children: ReactNode }) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const visible = hoverOpen || pinned;

  const cancelScheduledClose = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };
  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => setHoverOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(() => cancelScheduledClose, []);

  // トリガーのセル位置から fixed 配置を計算する。下の空きが足りなければ上に反転し、
  // bottom 指定で上方向に伸ばす(ドリルダウンでパネルの高さが変わっても位置が安定する)。
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_MAX_WIDTH - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    setStyle(
      spaceBelow < MIN_SPACE_BELOW
        ? { left, bottom: window.innerHeight - rect.top + 4 }
        : { left, top: rect.bottom + 4 },
    );
  }, []);

  useEffect(() => {
    if (visible) updatePosition();
  }, [visible, updatePosition]);

  // 表示中はスクロール・リサイズに追従して位置を再計算する(CF表内側のスクロールも
  // capture で拾う)。Escape で閉じる際は全画面表示オーバーレイの Escape ハンドラより
  // 先に capture で受けて伝播を止め、ツールチップだけを閉じる。
  useEffect(() => {
    if (!visible) return;
    const onReposition = () => updatePosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.stopImmediatePropagation();
      setPinned(false);
      setHoverOpen(false);
    };
    window.addEventListener('scroll', onReposition, { capture: true, passive: true });
    window.addEventListener('resize', onReposition);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('scroll', onReposition, { capture: true });
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [visible, updatePosition]);

  // ピン留め中はトリガー・パネルの外側のクリック/タップで解除する。
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setPinned(false);
      setHoverOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pinned]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={visible}
        aria-describedby={visible ? panelId : undefined}
        onMouseEnter={() => {
          cancelScheduledClose();
          setHoverOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onFocus={() => setHoverOpen(true)}
        onBlur={() => {
          if (!pinned) setHoverOpen(false);
        }}
        onClick={() => setPinned((p) => !p)}
        className="cursor-help underline decoration-dotted decoration-slate-400 underline-offset-2"
      >
        {children}
      </button>
      {visible &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="tooltip"
            style={style}
            onMouseEnter={cancelScheduledClose}
            onMouseLeave={scheduleClose}
            className="fixed z-[60] max-h-[60vh] w-max max-w-sm overflow-auto rounded-md border border-slate-200 bg-white p-3 text-left text-xs tabular-nums text-slate-700 shadow-lg"
          >
            <p className="font-semibold text-slate-800">
              {node.label} = {formatNodeValue(node)}
            </p>
            <div className="mt-1">
              <CalcNodeBody node={node} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
