/**
 * F-03 支出情報セクション(#9 / #31)。
 *
 * 支出は「自由に追加できる支出項目」のリストで入力する。
 * 各項目は名前・物価上昇率(項目ごと)を持ち、さらに項目内で「年齢期間ごとの月額」を
 * 複数設定できる(例: 35〜44歳は月10万、45〜60歳は月15万)。期間の重複はバリデーションする。
 * 教育費・ライフイベント費用・住宅ローン返済は別セクション(家族/イベント)で扱う。
 */
import type { ExpenseItem, ExpensePeriod } from '@money-plan/finance-core';
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { AgeNumberField } from '../../components/AgeNumberField';

/** 新規項目の既定値(現在年齢〜終了年齢の1期間・月額0)。 */
const createDefaultItem = (currentAge: number, endAge: number): ExpenseItem => ({
  name: '新しい項目',
  inflationRate: 1.0,
  periods: [{ startAge: currentAge, endAge, monthlyAmount: 0 }],
});

/** 新規期間の既定値(既存期間の直後から終了年齢まで・月額0)。 */
const createDefaultPeriod = (
  periods: ExpensePeriod[],
  currentAge: number,
  endAge: number,
): ExpensePeriod => {
  const startAge = periods.length > 0 ? Math.max(...periods.map((p) => p.endAge)) + 1 : currentAge;
  return { startAge, endAge: Math.max(startAge, endAge), monthlyAmount: 0 };
};

/** 1項目内の期間バリデーション(開始>終了・期間の重複)。警告文の配列を返す。 */
const validatePeriods = (periods: ExpensePeriod[]): string[] => {
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

export function ExpenseSection() {
  const items = useSimulationStore((s) => s.input.expense.items);
  const currentAge = useSimulationStore((s) => s.input.basic.currentAge);
  const endAge = useSimulationStore((s) => s.input.basic.endAge);
  const hasHomePurchase = useSimulationStore((s) =>
    s.input.events.some((e) => e.type === 'homePurchase'),
  );
  const setExpense = useSimulationStore((s) => s.setExpense);

  const updateItem = (index: number, patch: Partial<ExpenseItem>) => {
    setExpense({ items: items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  };

  const removeItem = (index: number) => {
    setExpense({ items: items.filter((_, i) => i !== index) });
  };

  const addItem = () => {
    setExpense({ items: [...items, createDefaultItem(currentAge, endAge)] });
  };

  const updatePeriod = (itemIndex: number, periodIndex: number, patch: Partial<ExpensePeriod>) => {
    const item = items[itemIndex]!;
    updateItem(itemIndex, {
      periods: item.periods.map((p, i) => (i === periodIndex ? { ...p, ...patch } : p)),
    });
  };

  const removePeriod = (itemIndex: number, periodIndex: number) => {
    const item = items[itemIndex]!;
    updateItem(itemIndex, { periods: item.periods.filter((_, i) => i !== periodIndex) });
  };

  const addPeriod = (itemIndex: number) => {
    const item = items[itemIndex]!;
    updateItem(itemIndex, {
      periods: [...item.periods, createDefaultPeriod(item.periods, currentAge, endAge)],
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-slate-600">支出項目</p>
        <p className="text-[11px] text-slate-400">
          項目ごとに年齢期間で月額を分けて設定できます(例:
          35〜44歳は月10万、45〜60歳は月15万)。物価上昇率も項目ごとに設定します。
        </p>
      </div>

      {hasHomePurchase && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
          住宅購入イベントを設定中です。購入後はローン返済が自動計上されるため、家賃項目は購入年齢の前年で終了するよう期間を調整すると二重計上を防げます。
        </p>
      )}

      {items.length === 0 && (
        <p className="text-[11px] text-slate-400">支出項目はまだありません。</p>
      )}

      {items.map((item, itemIndex) => {
        const warnings = validatePeriods(item.periods);
        return (
          <div key={itemIndex} className="rounded-md border border-slate-200 p-2">
            <div className="mb-2 flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">項目名</span>
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateItem(itemIndex, { name: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </label>
              <button
                type="button"
                onClick={() => removeItem(itemIndex)}
                className="mb-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50"
              >
                項目を削除
              </button>
            </div>

            <div className="mb-2">
              <NumberField
                label="物価上昇率"
                value={item.inflationRate}
                onChange={(v) => updateItem(itemIndex, { inflationRate: v })}
                min={0}
                max={20}
                step={0.1}
                unit="%"
                hint="この項目の月額に複利適用"
              />
            </div>

            <p className="mb-1 text-[11px] font-medium text-slate-500">年齢期間ごとの月額</p>
            <div className="flex flex-col gap-2">
              {item.periods.map((period, periodIndex) => (
                <div key={periodIndex} className="rounded-md bg-slate-50 p-2">
                  {/* 年齢期間(開始・終了)を1段目に。狭いパネルでも桁が見切れないよう2列に留める。 */}
                  <div className="grid grid-cols-2 gap-2">
                    <AgeNumberField
                      label="開始年齢"
                      value={period.startAge}
                      onChange={(v) => updatePeriod(itemIndex, periodIndex, { startAge: v })}
                      min={0}
                      max={120}
                      unit="歳"
                    />
                    <AgeNumberField
                      label="終了年齢"
                      value={period.endAge}
                      onChange={(v) => updatePeriod(itemIndex, periodIndex, { endAge: v })}
                      min={0}
                      max={120}
                      unit="歳"
                    />
                  </div>
                  {/* 月額は2段目に単独で置き、削除ボタンと横並び。月額入力に十分な幅を確保する。 */}
                  <div className="mt-2 flex items-end gap-2">
                    <div className="flex-1">
                      <NumberField
                        label="月額"
                        value={period.monthlyAmount}
                        onChange={(v) => updatePeriod(itemIndex, periodIndex, { monthlyAmount: v })}
                        min={0}
                        unit="万円"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePeriod(itemIndex, periodIndex)}
                      disabled={item.periods.length <= 1}
                      className="mb-1 shrink-0 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {warnings.map((w) => (
              <p key={w} className="mt-1 text-[11px] font-medium text-rose-500">
                {w}
              </p>
            ))}

            <button
              type="button"
              onClick={() => addPeriod(itemIndex)}
              className="mt-2 rounded-md border border-sky-300 px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
            >
              + 期間を追加
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addItem}
        className="rounded-md border border-sky-300 px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
      >
        + 支出項目を追加
      </button>
    </div>
  );
}
