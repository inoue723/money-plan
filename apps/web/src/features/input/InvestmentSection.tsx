/**
 * F-05 投資設定セクション(#9 / #33)。
 *
 * 複数の投資枠(口座)を追加・削除・編集できる。枠ごとに 名前 / 種別(NISA・課税口座)/
 * 毎月積立額 / 想定利回り(0〜15%)/ 積立開始年齢 / 積立終了年齢 / 取り崩し設定 を入力する。
 * NISA 枠には制度上の投資上限(生涯 1800 万・年間 360 万)が全 NISA 枠合算で適用され、
 * 上限超過分は積み立てられず預金に残る(計算は finance-core 側)。
 *
 * 取り崩し(#69)は枠ごとに**複数**設定できる。分割取崩(期間で均等に取り崩し切る)と
 * 一括取崩(指定年齢に指定額)の 2 種類をリストで追加・削除する。期間・年齢が重複する設定は
 * 警告を表示するが、保存は妨げない(計算側は定義順に順次適用する)。
 */
import { useMemo } from 'react';
import type {
  AccountOwner,
  AccountType,
  Child,
  InvestmentAccount,
  WithdrawalSetting,
} from '@money-plan/finance-core';
import {
  investmentAccountValuesBeforeWithdrawal,
  NISA_LIFETIME_LIMIT,
  nisaInitialLifetimeUsage,
} from '@money-plan/finance-core';
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { AgeNumberField } from '../../components/AgeNumberField';
import { SelectField } from '../../components/SelectField';
import { formatChildAgeLines } from '../../components/childAges';

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'nisa', label: 'NISA(非課税)' },
  { value: 'taxable', label: '課税口座(特定口座等)' },
  { value: 'ideco', label: 'iDeCo(拠出全額所得控除)' },
  { value: 'mutualAid', label: '小規模企業共済(拠出全額所得控除)' },
];

/**
 * 口座種別ごとの補足ヒント(#73)。iDeCo・小規模企業共済は拠出が全額所得控除になる旨と拠出上限の目安を示す。
 * 拠出上限はモデル化せず(簡易化)、目安の注意書きに留める。
 */
const ACCOUNT_TYPE_HINT: Record<AccountType, string | undefined> = {
  nisa: '生涯1800万・年間360万まで',
  taxable: undefined,
  ideco: '拠出額は全額所得控除。上限は職業により月1.2〜6.8万円が目安',
  mutualAid: '拠出額は全額所得控除。上限は月7万円が目安(個人事業主・小規模法人役員向け)',
};

const OWNER_OPTIONS: { value: AccountOwner; label: string }[] = [
  { value: 'self', label: '本人' },
  { value: 'spouse', label: '配偶者' },
];

const OWNER_LABEL: Record<AccountOwner, string> = { self: '本人', spouse: '配偶者' };

/** 新規追加時の既定枠(課税口座)。積立開始年齢は現在年齢を既定にする。名義は本人。 */
const createDefaultAccount = (currentAge: number): InvestmentAccount => ({
  name: '特定口座',
  accountType: 'taxable',
  owner: 'self',
  initialHolding: 0,
  monthlyAmount: 0,
  annualReturn: 3.0,
  startAge: currentAge,
  endAge: 65,
  withdrawals: [], // 取り崩し設定(#69)。空配列 = 取り崩しなし
});

/** 取り崩し種別の選択肢(#69)。 */
const WITHDRAWAL_TYPE_OPTIONS: { value: WithdrawalSetting['type']; label: string }[] = [
  { value: 'spread', label: '分割取崩(期間で均等)' },
  { value: 'lumpSum', label: '一括取崩(金額指定)' },
];

/**
 * 「+ 取り崩しを追加」の既定設定(#69)。積立終了年齢からシミュレーション終了年齢まで
 * 分割して取り崩し切る設定を初期値にする(老後の取り崩しの典型パターン)。
 */
const createDefaultWithdrawal = (accountEndAge: number, planEndAge: number): WithdrawalSetting => ({
  type: 'spread',
  startAge: accountEndAge,
  endAge: Math.max(accountEndAge, planEndAge),
});

/**
 * 取り崩し設定の種別を切り替える(#69)。種別ごとに持つフィールドが異なるため、
 * 入力済みの年齢を引き継ぎつつ新しい種別のオブジェクトを組み立てる。
 */
const changeWithdrawalType = (
  setting: WithdrawalSetting,
  type: WithdrawalSetting['type'],
  planEndAge: number,
): WithdrawalSetting => {
  if (type === 'spread') {
    if (setting.type === 'spread') return setting; // 種別が変わらないならそのまま
    // 一括 → 分割: 対象年齢を開始年齢として引き継ぎ、シミュレーション終了年齢まで取り崩す。
    return { type: 'spread', startAge: setting.age, endAge: Math.max(setting.age, planEndAge) };
  }
  if (setting.type === 'lumpSum') return setting; // 種別が変わらないならそのまま
  // 分割 → 一括: 開始年齢を対象年齢として引き継ぐ(取崩額は未入力 = 0 から)。
  return { type: 'lumpSum', age: setting.startAge, amount: 0 };
};

/**
 * 取り崩し設定 `index` が他の設定と期間・年齢で重複している場合の警告文(#69)。重複がなければ undefined。
 *
 * 重複しても保存・計算は妨げない(計算側は spread → lumpSum、同種は定義順に順次適用する)。
 * ユーザーの意図しない二重取り崩しに気づけるよう、警告として表示するに留める。
 */
const overlapWarning = (withdrawals: WithdrawalSetting[], index: number): string | undefined => {
  const target = withdrawals[index];
  if (!target) return undefined;
  const others = withdrawals.filter((_, i) => i !== index);

  if (target.type === 'spread') {
    // 期間 [startAge, endAge] が他の分割取崩の期間と交差するか(両端を含む)。
    const overlapping = others.some(
      (w) => w.type === 'spread' && w.startAge <= target.endAge && target.startAge <= w.endAge,
    );
    return overlapping
      ? '他の分割取崩と期間が重複しています。重複する年は設定の順に続けて取り崩されます。'
      : undefined;
  }

  if (others.some((w) => w.type === 'lumpSum' && w.age === target.age)) {
    return '同じ年齢の一括取崩が他にもあります。同じ年に続けて取り崩されます。';
  }
  if (
    others.some((w) => w.type === 'spread' && w.startAge <= target.age && target.age <= w.endAge)
  ) {
    return '分割取崩の期間と重なっています。その年は分割取崩のあとに一括取崩が適用されます。';
  }
  return undefined;
};

export function InvestmentSection() {
  const investment = useSimulationStore((s) => s.input.investment);
  const accounts = investment.accounts;
  const currentAge = useSimulationStore((s) => s.input.basic.currentAge);
  // 取り崩し設定の既定値(分割取崩の終了年齢)に使う(#69)。
  const planEndAge = useSimulationStore((s) => s.input.basic.endAge);
  // 一括取崩の対象年齢 tooltip 用の月割起点(#72 / #51)。
  const startMonth = useSimulationStore((s) => s.input.basic.startMonth);
  // 一括取崩の対象年齢 tooltip に子どもの年齢も併記する(#47 の挙動を維持)。
  const children = useSimulationStore((s) => s.input.family.children);
  const hasSpouse = useSimulationStore((s) => s.input.family.spouse !== undefined);
  const setInvestment = useSimulationStore((s) => s.setInvestment);

  // 各投資枠の「運用成長後・取崩処理適用前」の年次評価額(#72)。現在の入力全体
  // (他の取り崩し設定・NISA 上限を含む)を反映してシミュレーション本体と同じ計算で求める。
  // 一括取崩の対象年齢欄の tooltip 表示に使う(入力変更→即時再計算のパイプラインに乗る)。
  const valueSeries = useMemo(
    () =>
      investmentAccountValuesBeforeWithdrawal({
        investment,
        currentAge,
        endAge: planEndAge,
        startMonth,
      }),
    [investment, currentAge, planEndAge, startMonth],
  );

  // 枠 index と年齢から、その年齢時点(取崩適用前)の枠評価額を引く。
  // 範囲外(現在年齢未満・終了年齢超)や非対象の年齢は undefined を返す(呼び出し側で「—」表示)。
  const valueAtAge = (accountIndex: number, age: number): number | undefined =>
    valueSeries.find((s) => s.age === age)?.values[accountIndex];

  const updateAccount = (index: number, next: InvestmentAccount) => {
    setInvestment({ accounts: accounts.map((a, i) => (i === index ? next : a)) });
  };

  const removeAccount = (index: number) => {
    setInvestment({ accounts: accounts.filter((_, i) => i !== index) });
  };

  const addAccount = () => {
    setInvestment({ accounts: [...accounts, createDefaultAccount(currentAge)] });
  };

  // NISA 枠の初期保有額の簿価(取得価額)合計を名義ごとに集計する(#52 / #59)。生涯投資枠
  // (1800 万)は簿価ベースかつ名義ごとに独立適用されるため、いずれかの名義で上限を超える入力は
  // 名義別に警告する。
  const nisaInitialUsage = nisaInitialLifetimeUsage(accounts);
  const overLimitOwners = OWNER_OPTIONS.map((o) => o.value).filter(
    (owner) => nisaInitialUsage[owner] > NISA_LIFETIME_LIMIT,
  );

  // 配偶者なしのプランで配偶者名義の枠が残っている場合の警告(family から配偶者を外した後など)。
  const hasStaleSpouseAccount = !hasSpouse && accounts.some((a) => a.owner === 'spouse');

  return (
    <div className="flex flex-col gap-3">
      {accounts.length === 0 && (
        <p className="text-[11px] text-slate-400">投資枠はまだありません。</p>
      )}

      {overLimitOwners.map((owner) => (
        <p
          key={owner}
          className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-600"
        >
          {OWNER_LABEL[owner]}名義の NISA 枠の取得価額(簿価)の合計が {nisaInitialUsage[owner]}{' '}
          万円で、生涯投資枠の上限（{NISA_LIFETIME_LIMIT}{' '}
          万円）を超えています。超過分は生涯枠を消費できません。
        </p>
      ))}

      {hasStaleSpouseAccount && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
          配偶者名義の投資枠がありますが、このプランには配偶者が設定されていません。名義を本人に変更するか、家族構成で配偶者を追加してください。
        </p>
      )}

      {accounts.map((account, i) => (
        <AccountFields
          key={i}
          account={account}
          currentAge={currentAge}
          planEndAge={planEndAge}
          hasSpouse={hasSpouse}
          familyChildren={children}
          valueAtAge={(age) => valueAtAge(i, age)}
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
  planEndAge,
  hasSpouse,
  familyChildren,
  valueAtAge,
  onChange,
  onRemove,
}: {
  account: InvestmentAccount;
  currentAge: number;
  /** シミュレーション終了年齢(basic.endAge)。分割取崩の既定の終了年齢に使う(#69)。 */
  planEndAge: number;
  hasSpouse: boolean;
  /** 子ども一覧(一括取崩の対象年齢 tooltip に子ども年齢を併記する。#47 / #72)。 */
  familyChildren: Child[];
  /**
   * この枠の指定年齢時点(運用成長後・取崩適用前)の評価額を引く(#72)。範囲外は undefined。
   * 一括取崩の対象年齢欄の tooltip に使う。
   */
  valueAtAge: (age: number) => number | undefined;
  onChange: (next: InvestmentAccount) => void;
  onRemove: () => void;
}) {
  // 取り崩し設定(#69)。空配列 = 取り崩しなし。
  const withdrawals = account.withdrawals;

  const updateWithdrawal = (index: number, next: WithdrawalSetting) => {
    onChange({
      ...account,
      withdrawals: withdrawals.map((w, i) => (i === index ? next : w)),
    });
  };

  const removeWithdrawal = (index: number) => {
    onChange({ ...account, withdrawals: withdrawals.filter((_, i) => i !== index) });
  };

  const addWithdrawal = () => {
    onChange({
      ...account,
      withdrawals: [...withdrawals, createDefaultWithdrawal(account.endAge, planEndAge)],
    });
  };

  // 配偶者なしのプランでは配偶者名義を選べない。ただし既に配偶者名義の枠(旧データ等)は
  // 値を表示できるよう選択肢に残す(上位で警告を出す)。
  const ownerOptions =
    hasSpouse || account.owner === 'spouse' ? OWNER_OPTIONS : [OWNER_OPTIONS[0]!];

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
          hint={ACCOUNT_TYPE_HINT[account.accountType]}
        />
        <SelectField
          label="名義"
          value={account.owner}
          options={ownerOptions}
          onChange={(v) => onChange({ ...account, owner: v as AccountOwner })}
          hint={
            !hasSpouse
              ? '配偶者は家族構成で追加すると選択可'
              : account.accountType === 'nisa'
                ? '名義ごとに生涯・年間枠を適用'
                : undefined
          }
        />
        <NumberField
          label="現在投資額(時価)"
          value={account.initialHolding}
          onChange={(v) => onChange({ ...account, initialHolding: v })}
          min={0}
          step={0.1}
          unit="万円"
          hint="起点で保有中の評価額"
        />
        <NumberField
          label="取得価額(簿価)"
          value={account.acquisitionCost ?? account.initialHolding}
          onChange={(v) =>
            // 時価と同額なら acquisitionCost を保持せず undefined に戻す(=時価を簿価とみなす簡易化)。
            onChange({
              ...account,
              acquisitionCost: v === account.initialHolding ? undefined : v,
            })
          }
          min={0}
          step={0.1}
          unit="万円"
          hint={
            account.accountType === 'nisa'
              ? '未入力は時価と同額。簿価が生涯枠を消費'
              : '未入力は時価と同額。取崩時の課税に使用'
          }
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
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">取り崩し</span>
          <span className="text-[11px] text-slate-400">老後の投資資産の取り崩し</span>
        </div>

        {withdrawals.length === 0 && (
          <p className="mt-1 text-[11px] text-slate-400">取り崩しの設定はありません。</p>
        )}

        <div className="mt-2 flex flex-col gap-2">
          {withdrawals.map((withdrawal, i) => (
            <WithdrawalFields
              key={i}
              withdrawal={withdrawal}
              currentAge={currentAge}
              planEndAge={planEndAge}
              familyChildren={familyChildren}
              valueAtAge={valueAtAge}
              warning={overlapWarning(withdrawals, i)}
              onChange={(next) => updateWithdrawal(i, next)}
              onRemove={() => removeWithdrawal(i)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={addWithdrawal}
          className="mt-2 rounded-md border border-sky-300 px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50"
        >
          + 取り崩しを追加
        </button>
      </div>
    </div>
  );
}

/** 1 つの取り崩し設定の入力欄(#69。分割取崩 / 一括取崩)。 */
function WithdrawalFields({
  withdrawal,
  currentAge,
  planEndAge,
  familyChildren,
  valueAtAge,
  warning,
  onChange,
  onRemove,
}: {
  withdrawal: WithdrawalSetting;
  currentAge: number;
  planEndAge: number;
  /** 子ども一覧(一括取崩の対象年齢 tooltip に子ども年齢を併記する。#47 / #72)。 */
  familyChildren: Child[];
  /** この枠の指定年齢時点(取崩適用前)の評価額を引く(#72)。範囲外は undefined。 */
  valueAtAge: (age: number) => number | undefined;
  /** 他の設定と期間・年齢が重複する場合の警告文(重複がなければ undefined)。 */
  warning?: string;
  onChange: (next: WithdrawalSetting) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <SelectField
            label="種別"
            value={withdrawal.type}
            options={WITHDRAWAL_TYPE_OPTIONS}
            onChange={(v) =>
              onChange(changeWithdrawalType(withdrawal, v as WithdrawalSetting['type'], planEndAge))
            }
            hint={
              withdrawal.type === 'spread'
                ? '期間中に残高を均等に取り崩し切る'
                : '指定年齢にその額を取り崩す'
            }
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mb-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-500 hover:bg-rose-50"
        >
          削除
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {withdrawal.type === 'spread' ? (
          <>
            <AgeNumberField
              label="開始年齢"
              value={withdrawal.startAge}
              onChange={(v) => onChange({ ...withdrawal, startAge: v })}
              min={currentAge}
              max={100}
              unit="歳"
            />
            <AgeNumberField
              label="終了年齢"
              value={withdrawal.endAge}
              onChange={(v) => onChange({ ...withdrawal, endAge: v })}
              min={currentAge}
              max={100}
              unit="歳"
              hint="この年に残額をすべて取り崩す"
            />
          </>
        ) : (
          <>
            <NumberField
              label="対象年齢"
              value={withdrawal.age}
              onChange={(v) => onChange({ ...withdrawal, age: v })}
              min={currentAge}
              max={100}
              unit="歳"
              focusTooltip={(currentValue) => {
                // 入力途中で数値にならない場合は tooltip を出さない。
                if (Number.isNaN(currentValue)) return null;
                const value = valueAtAge(currentValue);
                // シミュレーション範囲外(現在年齢未満・終了年齢超)は「—」を表示する(#72)。
                const valueLine =
                  value === undefined
                    ? 'この年齢時点の評価額: —'
                    : `この年齢時点の評価額: 約${Math.round(value).toLocaleString('ja-JP')}万円`;
                // #47 の挙動を維持し、子どもがいれば年齢も併記する。
                return [valueLine, ...formatChildAgeLines(familyChildren, currentValue)].join('\n');
              }}
            />
            <NumberField
              label="取崩額"
              value={withdrawal.amount}
              onChange={(v) => onChange({ ...withdrawal, amount: v })}
              min={0}
              unit="万円"
              hint="残高が不足する場合は残高まで"
            />
          </>
        )}
      </div>

      {warning && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
          {warning}
        </p>
      )}
    </div>
  );
}
