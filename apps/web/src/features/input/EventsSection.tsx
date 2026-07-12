/**
 * F-04 ライフイベントセクション(#9)。
 *
 * 住宅購入 / 車購入 / その他一時支出 / その他一時収入 を任意の年に複数登録できる。
 * ライフイベントは判別可能union(`type`)であり、種別ごとに必要なパラメータ入力欄を出し分ける。
 * ※将来生まれる子どもは基本情報(F-01)の家族構成で登録する(#32)。
 */
import type { LifeEvent, LifeEventType } from '@money-plan/finance-core';
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { SelectField } from '../../components/SelectField';

const EVENT_TYPE_OPTIONS: { value: LifeEventType; label: string }[] = [
  { value: 'homePurchase', label: '住宅購入' },
  { value: 'carPurchase', label: '車購入' },
  { value: 'oneTimeExpense', label: 'その他一時支出' },
  { value: 'oneTimeIncome', label: 'その他一時収入' },
];

/** 種別ごとの既定イベントを生成する(種別変更・新規追加時の初期値)。 */
const createDefaultEvent = (type: LifeEventType, age: number): LifeEvent => {
  switch (type) {
    case 'homePurchase':
      return { type, age, price: 4000, downPayment: 800, loanInterestRate: 1.0, loanTermYears: 35 };
    case 'carPurchase':
      return { type, age, price: 250, replacementCycleYears: 10, annualMaintenance: 30 };
    case 'oneTimeExpense':
      return { type, age, name: '一時支出', amount: 100 };
    case 'oneTimeIncome':
      return { type, age, name: '一時収入', amount: 100 };
  }
};

export function EventsSection() {
  const events = useSimulationStore((s) => s.input.events);
  const currentAge = useSimulationStore((s) => s.input.basic.currentAge);
  const setEvents = useSimulationStore((s) => s.setEvents);

  const updateEvent = (index: number, next: LifeEvent) => {
    setEvents(events.map((e, i) => (i === index ? next : e)));
  };

  const removeEvent = (index: number) => {
    setEvents(events.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-3">
      {events.length === 0 && (
        <p className="text-[11px] text-slate-400">ライフイベントはまだありません。</p>
      )}

      {events.map((event, i) => (
        <div key={i} className="rounded-md border border-slate-200 p-2">
          <div className="mb-2 flex items-end gap-2">
            <div className="flex-1">
              <SelectField
                label="種別"
                value={event.type}
                options={EVENT_TYPE_OPTIONS}
                onChange={(v) => updateEvent(i, createDefaultEvent(v as LifeEventType, event.age))}
              />
            </div>
            <button
              type="button"
              onClick={() => removeEvent(i)}
              className="mb-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50"
            >
              削除
            </button>
          </div>

          <NumberField
            label="発生年齢"
            value={event.age}
            onChange={(v) => updateEvent(i, { ...event, age: v })}
            min={currentAge}
            max={100}
            unit="歳"
          />

          <div className="mt-2">
            <EventFields event={event} onChange={(next) => updateEvent(i, next)} />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setEvents([...events, createDefaultEvent('homePurchase', currentAge)])}
        className="rounded-md border border-sky-300 px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
      >
        + イベントを追加
      </button>
    </div>
  );
}

/** 種別ごとのパラメータ入力欄。判別可能union の `type` で出し分ける。 */
function EventFields({
  event,
  onChange,
}: {
  event: LifeEvent;
  onChange: (next: LifeEvent) => void;
}) {
  switch (event.type) {
    case 'homePurchase':
      return (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="物件価格"
            value={event.price}
            onChange={(v) => onChange({ ...event, price: v })}
            min={0}
            unit="万円"
          />
          <NumberField
            label="頭金"
            value={event.downPayment}
            onChange={(v) => onChange({ ...event, downPayment: v })}
            min={0}
            unit="万円"
          />
          <NumberField
            label="ローン金利"
            value={event.loanInterestRate}
            onChange={(v) => onChange({ ...event, loanInterestRate: v })}
            min={0}
            max={20}
            step={0.1}
            unit="%"
          />
          <NumberField
            label="返済期間"
            value={event.loanTermYears}
            onChange={(v) => onChange({ ...event, loanTermYears: v })}
            min={1}
            max={50}
            unit="年"
          />
        </div>
      );
    case 'carPurchase':
      return (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="価格"
            value={event.price}
            onChange={(v) => onChange({ ...event, price: v })}
            min={0}
            unit="万円"
          />
          <NumberField
            label="買替周期"
            value={event.replacementCycleYears}
            onChange={(v) => onChange({ ...event, replacementCycleYears: v })}
            min={1}
            max={50}
            unit="年"
          />
          <NumberField
            label="維持費(年額)"
            value={event.annualMaintenance}
            onChange={(v) => onChange({ ...event, annualMaintenance: v })}
            min={0}
            unit="万円"
          />
        </div>
      );
    case 'oneTimeExpense':
    case 'oneTimeIncome':
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">名称</span>
            <input
              type="text"
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={event.name}
              onChange={(e) => onChange({ ...event, name: e.target.value })}
            />
          </label>
          <NumberField
            label="金額"
            value={event.amount}
            onChange={(v) => onChange({ ...event, amount: v })}
            min={0}
            unit="万円"
          />
        </div>
      );
  }
}
