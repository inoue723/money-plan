/**
 * トグル(有 / 無)入力フィールド(共通入力UI。#9)。
 *
 * 配偶者有無・NISA 利用有無など、真偽の切り替えに用いる。
 */
export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function ToggleField({ label, checked, onChange, hint }: ToggleFieldProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2">
      <span className="flex flex-col">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-sky-500' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
