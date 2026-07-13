/**
 * 数値入力フィールド(共通入力UI。#9)。
 *
 * - 表示は「万円」「%」「歳」などの単位付き。値は number でストアに書き戻す。
 * - 入力中は表示テキスト(ローカル state)のみ更新し、ストアへの書き戻しは行わない。
 *   フォーカスアウト(blur)または Enter キーで確定し、値が変わっていれば `onChange` を呼ぶ(#28)。
 * - 確定時に `min` / `max` でクランプし、不正入力は 0(クランプ後)にフォールバックする。
 */
import { useEffect, useState, type ReactNode } from 'react';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 単位表記(例: 万円 / % / 歳)。 */
  unit?: string;
  required?: boolean;
  /** 補足説明(小さく灰色で表示)。 */
  hint?: string;
  disabled?: boolean;
  /**
   * フォーカス中に入力欄の上へ表示する補足ツールチップを生成する(#47)。
   * 引数は「現在編集中の数値」(入力途中の表示テキストをパースした値)で、
   * 入力に追従してリアルタイムに再評価される。`null` を返すと非表示にする。
   * 主に本人年齢入力に対する子どもの年齢表示に使う(`AgeNumberField`)。
   */
  focusTooltip?: (currentValue: number) => ReactNode | null;
}

const clamp = (n: number, min?: number, max?: number): number => {
  let v = n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
};

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  required,
  hint,
  disabled,
  focusTooltip,
}: NumberFieldProps) {
  const [text, setText] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);

  // 外部(ストア)の値が変わったら表示を同期する。ただし編集中の等価な入力は上書きしない。
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // text は編集中に更新されるため依存に含めない(value 変化時のみ同期する)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // フォーカス中のみ、現在編集中の値に対するツールチップを毎レンダー再評価する(入力に追従)。
  const tooltip = focused && focusTooltip ? focusTooltip(Number(text)) : null;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      <div className="relative flex items-center gap-1.5">
        {tooltip != null && (
          <div
            role="tooltip"
            className="absolute bottom-full left-0 z-10 mb-1 w-max max-w-[16rem] whitespace-pre-line rounded-md bg-slate-800 px-2 py-1 text-[11px] leading-tight text-white shadow-md"
          >
            {tooltip}
          </div>
        )}
        <input
          type="number"
          inputMode="decimal"
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            // 入力中は表示テキストのみ更新する(ストアへの書き戻しは確定時に行う)。
            setText(e.target.value);
          }}
          onBlur={() => {
            setFocused(false);
            const n = Number(text);
            const next = Number.isNaN(n) ? clamp(0, min, max) : clamp(n, min, max);
            setText(String(next));
            if (next !== value) onChange(next);
          }}
          onKeyDown={(e) => {
            // Enter でも blur と同じ確定処理を走らせる(blur させて onBlur に委譲)。
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {unit && <span className="shrink-0 text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
