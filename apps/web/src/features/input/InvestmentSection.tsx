/**
 * F-05 投資設定セクション(#9 / #33)。
 *
 * 複数の投資枠(口座)を追加・削除・編集できる。枠ごとに 名前 / 種別(NISA・課税口座)/
 * 毎月積立額 / 想定利回り(0〜15%)/ 積立開始年齢 / 積立終了年齢 / 取り崩し設定 を入力する。
 * NISA 枠には制度上の投資上限(生涯 1800 万・年間 360 万)が全 NISA 枠合算で適用され、
 * 上限超過分は積み立てられず預金に残る(計算は finance-core 側)。
 */
import type { AccountType, InvestmentAccount } from '@money-plan/finance-core';
import { NISA_LIFETIME_LIMIT, nisaInitialLifetimeUsage } from '@money-plan/finance-core';
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { AgeNumberField } from '../../components/AgeNumberField';
import { SelectField } from '../../components/SelectField';
import { ToggleField } from '../../components/ToggleField';

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'nisa', label: 'NISA(非課税)' },
  { value: 'taxable', label: '課税口座(特定口座等)' },
];

/** 新規追加時の既定枠(課税口座)。積立開始年齢は現在年齢を既定にする。 */
const createDefaultAccount = (currentAge: number): InvestmentAccount => ({
  name: '特定口座',
  accountType: 'taxable',
  initialHolding: 0,
  monthlyAmount: 0,
  annualReturn: 3.0,
  startAge: currentAge,
  endAge: 65,
  withdrawal: undefined,
});

export function InvestmentSection() {
  const accounts = useSimulationStore((s) => s.input.investment.accounts);
  const currentAge = useSimulationStore((s) => s.input.basic.currentAge);
  const setInvestment = useSimulationStore((s) => s.setInvestment);

  const updateAccount = (index: number, next: InvestmentAccount) => {
    setInvestment({ accounts: accounts.map((a, i) => (i === index ? next : a)) });
  };

  const removeAccount = (index: number) => {
    setInvestment({ accounts: accounts.filter((_, i) => i !== index) });
  };

  const addAccount = () => {
    setInvestment({ accounts: [...accounts, createDefaultAccount(currentAge)] });
  };

  // NISA 枠の初期保有額(現在投資額)の合計。生涯投資枠(1800 万)を消費する扱いのため、
  // 合計が上限を超える入力は警告する。
  const nisaInitialTotal = nisaInitialLifetimeUsage(accounts);
  const nisaInitialOverLimit = nisaInitialTotal > NISA_LIFETIME_LIMIT;

  return (
    <div className="flex flex-col gap-3">
      {accounts.length === 0 && (
        <p className="text-[11px] text-slate-400">投資枠はまだありません。</p>
      )}

      {nisaInitialOverLimit && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-600">
          NISA 枠の現在投資額の合計が {nisaInitialTotal} 万円で、生涯投資枠の上限（
          {NISA_LIFETIME_LIMIT} 万円）を超えています。超過分は生涯枠を消費できません。
        </p>
      )}

      {accounts.map((account, i) => (
        <AccountFields
          key={i}
          account={account}
          currentAge={currentAge}
          onChange={(next) => updateAccount(i, next)}
          onRemove={() => removeAccount(i)}
        />
      ))}

      <button
        type="button"
        onClick={addAccount}
        className="rounded-md border border-sky-300 px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
      >
        + 投資枠を追加
      </button>
    </div>
  );
}

/** 1 つの投資枠の入力欄。 */
function AccountFields({
  account,
  currentAge,
  onChange,
  onRemove,
}: {
  account: InvestmentAccount;
  currentAge: number;
  onChange: (next: InvestmentAccount) => void;
  onRemove: () => void;
}) {
  const withdrawal = account.withdrawal;

  return (
    <div className="rounded-md border border-slate-200 p-2">
      <div className="mb-2 flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">枠の名前</span>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            value={account.name}
            onChange={(e) => onChange({ ...account, name: e.target.value })}
          />
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="mb-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50"
        >
          削除
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="種別"
          value={account.accountType}
          options={ACCOUNT_TYPE_OPTIONS}
          onChange={(v) => onChange({ ...account, accountType: v as AccountType })}
          hint={account.accountType === 'nisa' ? '生涯1800万・年間360万まで' : undefined}
        />
        <NumberField
          label="現在投資額"
          value={account.initialHolding}
          onChange={(v) => onChange({ ...account, initialHolding: v })}
          min={0}
          step={0.1}
          unit="万円"
          hint={account.accountType === 'nisa' ? '初期保有分も生涯枠を消費' : '起点で保有中の額'}
        />
        <NumberField
          label="毎月の積立額"
          value={account.monthlyAmount}
          onChange={(v) => onChange({ ...account, monthlyAmount: v })}
          min={0}
          step={0.1}
          unit="万円"
        />
        <NumberField
          label="想定利回り"
          value={account.annualReturn}
          onChange={(v) => onChange({ ...account, annualReturn: v })}
          min={0}
          max={15}
          step={0.1}
          unit="%"
          hint="0〜15%"
        />
        <AgeNumberField
          label="積立開始年齢"
          value={account.startAge}
          onChange={(v) => onChange({ ...account, startAge: v })}
          min={currentAge}
          max={100}
          unit="歳"
        />
        <AgeNumberField
          label="積立終了年齢"
          value={account.endAge}
          onChange={(v) => onChange({ ...account, endAge: v })}
          min={currentAge}
          max={100}
          unit="歳"
        />
      </div>

      <div className="mt-2 rounded-md bg-slate-50 p-2">
        <ToggleField
          label="取り崩しを設定する"
          checked={withdrawal !== undefined}
          onChange={(checked) =>
            onChange({
              ...account,
              withdrawal: checked ? { startAge: account.endAge, annualAmount: 0 } : undefined,
            })
          }
          hint="老後の投資資産の取り崩し"
        />
        {withdrawal && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <AgeNumberField
              label="開始年齢"
              value={withdrawal.startAge}
              onChange={(v) => onChange({ ...account, withdrawal: { ...withdrawal, startAge: v } })}
              min={currentAge}
              max={100}
              unit="歳"
            />
            <NumberField
              label="年間取崩額"
              value={withdrawal.annualAmount}
              onChange={(v) =>
                onChange({ ...account, withdrawal: { ...withdrawal, annualAmount: v } })
              }
              min={0}
              unit="万円"
            />
          </div>
        )}
      </div>
    </div>
  );
}
