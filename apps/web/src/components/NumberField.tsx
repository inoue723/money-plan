/**
 * 数値入力フィールド(共通入力UI。#9)。
 *
 * - 表示は「万円」「%」「歳」などの単位付き。値は number でストアに書き戻す。
 * - 入力途中(空文字・末尾ドットなど)でも編集できるよう、表示テキストはローカル state で保持し、
 *   数値としてパースできたときだけ `onChange` を呼ぶ。
 * - `min` / `max` が指定されていれば blur 時にクランプする(最小限の範囲バリデーション)。
 */
import { useEffect, useState } from 'react';

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
}: NumberFieldProps) {
  const [text, setText] = useState<string>(String(value));

  // 外部(ストア)の値が変わったら表示を同期する。ただし編集中の等価な入力は上書きしない。
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // text は編集中に更新されるため依存に含めない(value 変化時のみ同期する)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            if (raw === '') return;
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(clamp(n, min, max));
          }}
          onBlur={() => {
            const n = Number(text);
            const next = Number.isNaN(n) ? clamp(0, min, max) : clamp(n, min, max);
            setText(String(next));
            if (next !== value) onChange(next);
          }}
        />
        {unit && <span className="shrink-0 text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
