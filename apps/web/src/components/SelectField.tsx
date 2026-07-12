/**
 * セレクト(ドロップダウン)入力フィールド(共通入力UI。#9)。
 *
 * 値は文字列 union で扱う。呼び出し側で `as` により具体的な union 型へ絞り込む。
 */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  disabled,
}: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
