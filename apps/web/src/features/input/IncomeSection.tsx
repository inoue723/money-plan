/**
 * F-02 収入情報セクション(#9 / #30)。
 *
 * 本人の収入は「働き方期間」(開始年齢〜終了年齢 × 会社員/個人事業主)のリストで入力する。
 * 期間は複数追加でき、重複しないようバリデーションする(隙間 = 無収入期間は許容)。
 * 退職金 / 年金受給額 / その他収入 は現行どおり入力する。
 * 配偶者年収は F-01(配偶者あり時)で入力するためここでは案内のみ表示する。
 */
import type { WorkPeriod, WorkStyle } from '@money-plan/finance-core';
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { AgeNumberField } from '../../components/AgeNumberField';
import { SelectField } from '../../components/SelectField';

const WORK_STYLE_OPTIONS: { value: WorkStyle; label: string }[] = [
  { value: 'employee', label: '会社員' },
  { value: 'selfEmployed', label: '個人事業主' },
];

/** 新規追加時の既定の働き方期間(既存期間の直後から 65 歳まで・会社員)。 */
const createDefaultPeriod = (periods: WorkPeriod[], currentAge: number): WorkPeriod => {
  const startAge = periods.length > 0 ? Math.max(...periods.map((p) => p.endAge)) + 1 : currentAge;
  return {
    startAge,
    endAge: Math.max(startAge, 65),
    workStyle: 'employee',
    income: 500,
    raiseRate: 1.0,
  };
};

/** 期間リストのバリデーション。問題があれば警告文の配列を返す(重複・開始>終了)。 */
const validatePeriods = (periods: WorkPeriod[]): string[] => {
  const warnings: string[] = [];
  periods.forEach((p, i) => {
    if (p.startAge > p.endAge) {
      warnings.push(`期間${i + 1}: 開始年齢が終了年齢を超えています。`);
    }
  });
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i]!;
      const b = periods[j]!;
      if (a.startAge <= b.endAge && b.startAge <= a.endAge) {
        warnings.push(`期間${i + 1}と期間${j + 1}の年齢が重複しています。`);
      }
    }
  }
  return warnings;
};

export function IncomeSection() {
  const income = useSimulationStore((s) => s.input.income);
  const currentAge = useSimulationStore((s) => s.input.basic.currentAge);
  const hasSpouse = useSimulationStore((s) => s.input.family.spouse !== undefined);
  const setIncome = useSimulationStore((s) => s.setIncome);

  const periods = income.workPeriods;

  const updatePeriod = (index: number, patch: Partial<WorkPeriod>) => {
    setIncome({
      workPeriods: periods.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });
  };

  const removePeriod = (index: number) => {
    setIncome({ workPeriods: periods.filter((_, i) => i !== index) });
  };

  const addPeriod = () => {
    setIncome({ workPeriods: [...periods, createDefaultPeriod(periods, currentAge)] });
  };

  const warnings = validatePeriods(periods);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-slate-600">働き方期間</p>
        <p className="text-[11px] text-slate-400">
          年齢期間ごとに会社員/個人事業主と収入を設定します。期間の隙間は無収入として扱います。
        </p>
      </div>

      {periods.length === 0 && (
        <p className="text-[11px] text-slate-400">働き方期間はまだありません(無収入)。</p>
      )}

      {periods.map((period, i) => (
        <div key={i} className="rounded-md border border-slate-200 p-2">
          <div className="mb-2 flex items-end gap-2">
            <div className="flex-1">
              <SelectField
                label={`期間${i + 1} の働き方`}
                value={period.workStyle}
                options={WORK_STYLE_OPTIONS}
                onChange={(v) => updatePeriod(i, { workStyle: v as WorkStyle })}
              />
            </div>
            <button
              type="button"
              onClick={() => removePeriod(i)}
              className="mb-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50"
            >
              削除
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <AgeNumberField
              label="開始年齢"
              value={period.startAge}
              onChange={(v) => updatePeriod(i, { startAge: v })}
              min={0}
              max={100}
              unit="歳"
            />
            <AgeNumberField
              label="終了年齢"
              value={period.endAge}
              onChange={(v) => updatePeriod(i, { endAge: v })}
              min={0}
              max={100}
              unit="歳"
              hint="この年齢まで働く"
            />
            <NumberField
              label={period.workStyle === 'employee' ? '年収(額面)' : '事業所得'}
              value={period.income}
              onChange={(v) => updatePeriod(i, { income: v })}
              min={0}
              unit="万円"
              required
              hint={
                period.workStyle === 'employee'
                  ? '税・社会保険料は自動計算されます'
                  : '売上−経費。青色申告・国保・国民年金で計算します'
              }
            />
            <NumberField
              label="昇給率"
              value={period.raiseRate}
              onChange={(v) => updatePeriod(i, { raiseRate: v })}
              min={0}
              max={20}
              step={0.1}
              unit="%"
              hint="期間内で複利適用"
            />
          </div>
        </div>
      ))}

      {warnings.map((w) => (
        <p key={w} className="text-[11px] font-medium text-rose-500">
          {w}
        </p>
      ))}

      <button
        type="button"
        onClick={addPeriod}
        className="rounded-md border border-sky-300 px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
      >
        + 働き方期間を追加
      </button>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="退職金"
          value={income.retirementBonus}
          onChange={(v) => setIncome({ retirementBonus: v })}
          min={0}
          unit="万円"
          hint="最後の会社員期間の終了翌年に計上"
        />
        <NumberField
          label="年金受給額(年額)"
          value={income.pension}
          onChange={(v) => setIncome({ pension: v })}
          min={0}
          unit="万円"
          hint="就労終了の翌年から受給"
        />
      </div>
      <NumberField
        label="その他の収入(年額)"
        value={income.other}
        onChange={(v) => setIncome({ other: v })}
        min={0}
        unit="万円"
        hint="副業・不動産収入など(手取り扱い)"
      />
      <p className="text-[11px] text-slate-400">
        {hasSpouse
          ? '配偶者の年収は「基本情報」で入力します。'
          : '配偶者の年収は「基本情報」で配偶者ありにすると入力できます。'}
      </p>
    </div>
  );
}
