/**
 * シミュレーションの状態管理ストア(Zustand。SPEC.md 4.2)。
 *
 * ## 設計方針(issue #8)
 * - state は `SimulationInput` 全体を保持する。計算結果(`SimulationResult`)は
 *   **入力の派生**として算出し、別 state として二重管理しない(SPEC.md 4.4 / issue 技術方針)。
 * - 各セクション(basic / family / income / expense / events / investment)に対して
 *   型安全な部分更新 setter を提供する。setter は必ず `input` オブジェクトの参照を
 *   新しくすることで、下記の派生セレクタのメモ化が正しく無効化される。
 * - 結果は `useSimulationResult()` から取得する。`runSimulation` の呼び出しは
 *   入力の参照が変わったときだけ行い(メモ化)、入力変更→即時再計算のパイプラインを
 *   100ms 以内(SPEC.md 5)で回す前提の実装とする。
 * - `selectedYear`(選択中の年)も保持する。グラフ(#10)のクリックや CF表(#26)の
 *   西暦ヘッダークリックで設定し、グラフの選択年マーカーと CF表の列ハイライトが購読する共有 state。
 *
 * ## プランタブ / 永続化(issue #12, F-09, SPEC.md 4.1)
 * - プランは「タブ」として複数保持する(`tabs`)。各タブは保存済みスナップショット
 *   (`savedInput`)と編集中ドラフト(`draftInput`)を持つ。アクティブタブのドラフトは
 *   `input` と常に同期し、既存の setter / 即時再計算パイプラインをそのまま使える。
 * - `draftInput` が `savedInput` と値として異なれば「未保存」(`isTabDirty`)。UI は
 *   タブ名の右に未保存マーク(●)を表示する。`saveActiveTab`(「変更を保存」/ Cmd|Ctrl+S)で
 *   アクティブタブの `savedInput` を現在入力で上書きし、`discardActiveTabChanges`
 *   (「変更を破棄」)で `savedInput` へ戻す。
 * - `persist` middleware で `tabs` / `activeTabId` / `input` を localStorage に保存する。
 *   保存はローカルのみで、外部送信は一切行わない。`selectedYear` は一時 UI 状態のため
 *   永続化しない(partialize で除外)。
 * - スキーマは `version`(下記 PERSIST_VERSION)を持ち、`migrate` で旧データを変換する
 *   (v1: `{ input, plans }` → v2: `{ input, tabs, activeTabId }`、
 *    v2 → v3: `basic.investments` を廃止し投資枠ごとの `initialHolding` へ移行し、
 *    名前が「家賃」の ExpenseItem を家賃専用型 `expense.rent` へ変換、
 *    v3 → v4: `spouse.income`(固定年収)を本人と同等の `IncomeInput` 構造へ変換(#49)し、
 *    投資枠に名義 `owner` を追加して既存枠はすべて `'self'`(本人)とする(#52)、
 *    v5 → v6: 投資枠の取り崩しを単一の年額指定 `withdrawal` から複数設定 `withdrawals` へ再設計(#69)、
 *    v6 → v7: 投資枠の積立を単一の月額 + 積立開始/終了年齢から複数の積立設定 `contributions`
 *    (年齢別の月額積立 + 一括投資)へ再設計、
 *    v7 → v8: 収入情報に年金の受給開始年齢 `pensionStartAge`(#18)と自動推定フラグ
 *    `pensionAutoEstimate`(#21)を追加)。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { runSimulation } from '@money-plan/finance-core';
import type {
  AccountOwner,
  BasicInput,
  ContributionSetting,
  ExpenseInput,
  FamilyInput,
  IncomeInput,
  InvestmentAccount,
  InvestmentInput,
  LifeEvent,
  RentInput,
  SimulationInput,
  SimulationResult,
  Spouse,
  WithdrawalSetting,
} from '@money-plan/finance-core';

// ---------------------------------------------------------------------------
// デフォルト入力(SPEC.md 2.2 の各デフォルト値)
// ---------------------------------------------------------------------------

/** 新規プランの計算開始年月のデフォルト(#51)。当月を起点にする。 */
const DEFAULT_START = new Date();

/** SPEC.md 2.2 のデフォルト値に基づく初期入力。金額は万円、率は %。 */
export const DEFAULT_INPUT: SimulationInput = {
  basic: {
    currentAge: 30, // シミュレーション起点(18〜80)
    endAge: 90, // SPEC.md 2.2 デフォルト 90 歳
    savings: 300, // 現在の預金残高(万円)
    // 計算開始年月(#51)。デフォルトは当月。初年はこの月から 12 月までを月割で計算する。
    startYear: DEFAULT_START.getFullYear(),
    startMonth: DEFAULT_START.getMonth() + 1,
  },
  family: {
    spouse: undefined, // 配偶者なし
    children: [],
  },
  income: {
    // 働き方期間: 現在年齢〜65歳・会社員の1期間(現行デフォルト相当。#30)
    workPeriods: [
      {
        startAge: 30, // 開始年齢(= デフォルトの現在年齢)
        endAge: 65, // 65 歳まで働く
        workStyle: 'employee', // 会社員
        income: 500, // 年収(額面・万円)
        raiseRate: 1.0, // SPEC.md 2.2 デフォルト 1.0%
      },
    ],
    retirementBonus: 0,
    pension: 150, // 年金受給額(年額・万円)。自動計算 OFF 時の手動入力の初期値
    pensionStartAge: 65, // 受給開始年齢(#18)。退職年齢とは独立(デフォルト 65 歳)
    pensionAutoEstimate: true, // 就労履歴から受給額を自動推定(#21)。新規プランはデフォルト ON
    other: 0,
  },
  expense: {
    // 家賃(#50)は専用型で保持する。現行デフォルト値を「現在年齢(30)〜終了年齢(90)」の1期間で表す。
    rent: {
      inflationRate: 1.0,
      periods: [{ startAge: 30, endAge: 90, monthlyAmount: 8 }],
    },
    // 支出項目(#31)。現行デフォルト値を「現在年齢(30)〜終了年齢(90)」の1期間で表す。
    // 物価上昇は現行挙動に合わせ、生活費のみ 1.0%(保険料・その他固定費は 0%)。
    items: [
      {
        name: '生活費',
        inflationRate: 1.0,
        periods: [{ startAge: 30, endAge: 90, monthlyAmount: 15 }],
      },
      {
        name: '保険料',
        inflationRate: 0,
        periods: [{ startAge: 30, endAge: 90, monthlyAmount: 1 }],
      },
      {
        name: 'その他固定費',
        inflationRate: 0,
        periods: [{ startAge: 30, endAge: 90, monthlyAmount: 2 }],
      },
    ],
  },
  events: [],
  investment: {
    // デフォルトは 1 枠(本人 NISA)。SPEC.md 2.2 の各デフォルト値に準拠。
    accounts: [
      {
        name: 'NISA',
        accountType: 'nisa', // NISA 利用(非課税枠内の運用益を非課税)
        owner: 'self', // 名義。デフォルトは本人(#52)
        initialHolding: 0, // 現在投資額(初期保有額・万円)。デフォルト 0
        annualReturn: 3.0, // SPEC.md 2.2 デフォルト 3.0%
        // 積立設定。デフォルトは現在年齢(30)〜退職前年(64)の月額積立 1 件(月額 0)。
        contributions: [{ type: 'monthly', startAge: 30, endAge: 64, monthlyAmount: 0 }],
        withdrawals: [], // 取り崩し設定(#69)。空配列 = 取り崩しなし
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 配偶者の収入(#49)
// ---------------------------------------------------------------------------

/**
 * 空の収入情報(働き方期間なし = 無収入)。配偶者を新規に有効化したときの初期値に使う。
 * 本人の収入と同じ `IncomeInput` 構造で、ユーザーが働き方期間を追加するまで収入は 0。
 */
export const createEmptyIncome = (): IncomeInput => ({
  workPeriods: [],
  retirementBonus: 0,
  pension: 0,
  pensionStartAge: 65, // 受給開始年齢(#18)。デフォルト 65 歳
  pensionAutoEstimate: true, // 就労履歴から自動推定(#21)。就労なしなら推定額 0
  other: 0,
});

/** 配偶者を新規に有効化するときの既定値(年齢のみ指定、収入は空)。 */
export const createDefaultSpouse = (age: number): Spouse => ({
  age,
  income: createEmptyIncome(),
});

// ---------------------------------------------------------------------------
// ストア定義
// ---------------------------------------------------------------------------

/**
 * プランタブ(F-09)。1 タブ = 1 プラン。
 * - `savedInput`: 最後に保存(上書き)された入力のスナップショット。
 * - `draftInput`: 編集中の入力。`savedInput` と値が異なれば「未保存」。
 *   アクティブタブの `draftInput` はストアの `input` と常に同じ値に保たれる。
 */
export interface PlanTab {
  /** 一意 ID(タブ生成時に採番)。 */
  id: string;
  /** タブ名(プラン名)。 */
  name: string;
  /** 最後に保存された入力のスナップショット(独立コピー)。 */
  savedInput: SimulationInput;
  /** 編集中の入力(独立コピー)。 */
  draftInput: SimulationInput;
}

/**
 * import 用のプラン 1 件(#71)。名前と入力一式のみを持つ最小構造。
 * JSON import で復元するプランや、`addImportedPlans` の引数に使う。
 */
export interface ImportedPlan {
  /** プラン名(タブ名)。既存タブと競合する場合は追加時に調整される。 */
  name: string;
  /** 入力一式(現行 `PERSIST_VERSION` の形状にマイグレーション済み)。 */
  input: SimulationInput;
}

/**
 * 永続化スキーマのバージョン。`tabs` や入力形状(`SimulationInput`)の構造を
 * 破壊的に変更したら増やし、`persist` の `migrate` で旧データを変換する。
 */
export const PERSIST_VERSION = 8;

/** localStorage のキー(SPEC.md 4.1: ローカルのみに保存)。 */
export const PERSIST_KEY = 'money-plan/simulation';

/** 入力一式の独立コピーを作る(タブ間・保存/ドラフト間で参照を共有しないように)。 */
const cloneInput = (input: SimulationInput): SimulationInput =>
  typeof structuredClone === 'function'
    ? structuredClone(input)
    : (JSON.parse(JSON.stringify(input)) as SimulationInput);

/**
 * v2 → v3 の入力マイグレーション(#46)。
 * 旧 `basic.investments`(初期投資資産額の一括入力)を廃止し、先頭の投資枠の
 * `initialHolding`(現在投資額)へ組み入れる。initialHolding が無い旧枠は 0 で補完する。
 * 投資枠が 1 つも無い場合は移行先が無いため初期投資資産は破棄する(旧 engine と同挙動)。
 */
const migrateInvestmentsToHolding = (input: SimulationInput): SimulationInput => {
  const old = input as SimulationInput & { basic: BasicInput & { investments?: number } };
  const investments = typeof old.basic.investments === 'number' ? old.basic.investments : 0;
  // basic から廃止した investments キーを取り除く(他フィールドは保持)。
  const basic: BasicInput & { investments?: number } = { ...old.basic };
  delete basic.investments;
  const accounts = old.investment.accounts.map((a, i) => ({
    ...a,
    initialHolding:
      (typeof a.initialHolding === 'number' ? a.initialHolding : 0) + (i === 0 ? investments : 0),
  }));
  return { ...old, basic, investment: { ...old.investment, accounts } };
};

/**
 * v2 → v3 マイグレーション(#50)。名前が「家賃」の ExpenseItem を家賃専用型(rent)へ変換する。
 * - 既に rent があれば変換しない。
 * - 「家賃」項目が無ければ rent は未設定のまま(賃貸でない扱い)。
 * - 更新料は旧データに存在しないため付与しない。
 */
const migrateExpenseRent = (input: SimulationInput): SimulationInput => {
  const { expense } = input;
  if (expense.rent) return input;
  const idx = expense.items.findIndex((it) => it.name === '家賃');
  if (idx === -1) return input;
  const rentItem = expense.items[idx]!;
  const rent: RentInput = {
    inflationRate: rentItem.inflationRate,
    periods: rentItem.periods.map((p) => ({
      startAge: p.startAge,
      endAge: p.endAge,
      monthlyAmount: p.monthlyAmount,
    })),
  };
  return {
    ...input,
    expense: { rent, items: expense.items.filter((_, i) => i !== idx) },
  };
};

/** v2 → v3 の入力マイグレーションを両方(#46 / #50)適用する。両者は別フィールドを扱うため共存できる。 */
const migrateInputV2toV3 = (input: SimulationInput): SimulationInput =>
  migrateExpenseRent(migrateInvestmentsToHolding(input));

/**
 * v3 → v4 マイグレーション(#49)。旧 `spouse.income`(固定年収 number)を本人と同等の
 * `IncomeInput` 構造へ変換する。年収 > 0 なら「現在年齢〜退職年齢(65)の会社員期間1つ」に、
 * 年収 0(または未満)なら働き方期間なし(無収入)に変換する。昇給率は旧挙動(固定額)に
 * 合わせ 0% とする。既に `IncomeInput` 形式(オブジェクト)なら変換しない。
 */
const migrateSpouseIncome = (input: SimulationInput): SimulationInput => {
  const spouse = input.family.spouse as (Spouse & { income: number | IncomeInput }) | undefined;
  if (!spouse || typeof spouse.income !== 'number') return input;

  const annual = spouse.income;
  const startAge = spouse.age;
  const endAge = Math.max(startAge, 65);
  const income: IncomeInput = {
    workPeriods:
      annual > 0 ? [{ startAge, endAge, workStyle: 'employee', income: annual, raiseRate: 0 }] : [],
    retirementBonus: 0,
    pension: 0,
    other: 0,
  };
  return { ...input, family: { ...input.family, spouse: { age: spouse.age, income } } };
};

/**
 * v3 → v4 の入力マイグレーション(#52)。投資枠に名義(owner)を追加する。
 * 既存枠はすべて本人名義(`'self'`)とする。既に owner を持つ枠はそのまま維持する。
 */
const migrateAddOwner = (input: SimulationInput): SimulationInput => ({
  ...input,
  investment: {
    ...input.investment,
    accounts: input.investment.accounts.map((a) => {
      const owner = (a as { owner?: AccountOwner }).owner;
      return { ...a, owner: owner === 'spouse' ? 'spouse' : 'self' };
    }),
  },
});

/** v3 → v4 の入力マイグレーションを両方(#49 / #52)適用する。両者は別フィールドを扱うため共存できる。 */
const migrateInputV3toV4 = (input: SimulationInput): SimulationInput =>
  migrateAddOwner(migrateSpouseIncome(input));

/** v5 以前の取り崩し設定(単一・年額指定)。#69 で廃止した旧形式。 */
interface LegacyWithdrawal {
  /** 取り崩し開始年齢(歳)。 */
  startAge: number;
  /** 年間取崩額(万円)。#69 で年額指定タイプを廃止したため移行先が無く、破棄される。 */
  annualAmount: number;
}

/**
 * v5 → v6 の入力マイグレーション(#69)。投資枠の取り崩しを、単一の年額指定 `withdrawal` から
 * 複数設定のリスト `withdrawals`(判別可能union)へ移行する。
 *
 * 旧 `withdrawal: { startAge, annualAmount }` は
 * `withdrawals: [{ type: 'spread', startAge, endAge: input.basic.endAge }]` に変換する
 * (取り崩し開始年齢を引き継ぎ、シミュレーション終了年齢まで分割して取り崩し切る設定にする)。
 *
 * **注意: 年額指定タイプの廃止に伴う仕様変更のため、移行後は挙動が変わる。**
 * 旧形式の `annualAmount`(年間取崩額)は分割取崩に対応する概念が無いため**破棄する**
 * (分割取崩は金額を入力せず、残高 ÷ 残り年数 で毎年の取崩額が決まる)。移行後のプランでは
 * 取崩額が旧設定と一致しない。ユーザーは必要に応じて UI で設定し直す。
 *
 * 旧 `withdrawal` が `undefined`(取り崩しなし)の場合は `withdrawals: []` にする。
 */
const migrateWithdrawals = (input: SimulationInput): SimulationInput => ({
  ...input,
  investment: {
    ...input.investment,
    accounts: input.investment.accounts.map((account) => {
      const legacy = account as InvestmentAccount & { withdrawal?: LegacyWithdrawal };
      // 旧キー `withdrawal` は残さず取り除く(新形式 `withdrawals` に一本化する)。
      const { withdrawal, ...rest } = legacy;
      const withdrawals: WithdrawalSetting[] = withdrawal
        ? // annualAmount は移行先が無いため破棄し、開始年齢〜シミュレーション終了年齢の分割取崩にする。
          [{ type: 'spread', startAge: withdrawal.startAge, endAge: input.basic.endAge }]
        : // 既に新形式(#69 以降)なら維持し、取り崩しなしなら空配列にする。
          (rest.withdrawals ?? []);
      return { ...rest, withdrawals };
    }),
  },
});

/** v6 以前の投資枠の積立フィールド(単一の月額 + 積立開始/終了年齢)。年齢別積立・一括投資の導入前の旧形式。 */
interface LegacyContribution {
  /** 毎月の積立額(万円)。 */
  monthlyAmount?: number;
  /** 積立開始年齢(歳。この年齢「以降」に積立を開始する = startAge <= age < endAge)。 */
  startAge?: number;
  /** 積立終了年齢(歳。旧仕様は終了年齢「未満」まで積み立てる = age < endAge)。 */
  endAge?: number;
}

/**
 * v6 → v7 の入力マイグレーション。投資枠の積立を、単一の月額(`monthlyAmount` /
 * `startAge` / `endAge`)から複数の積立設定リスト `contributions`(判別可能union)へ移行する。
 *
 * 旧 `{ monthlyAmount, startAge, endAge }` は
 * `contributions: [{ type: 'monthly', startAge, endAge: endAge - 1, monthlyAmount }]` に変換する。
 * 旧仕様の積立期間は「終了年齢未満まで(startAge <= age < endAge)」だったため、両端を含む
 * 新仕様(startAge <= age <= endAge)に合わせて **endAge を 1 引いて挙動を保つ**
 * (例: 旧 endAge 65 = 64 歳まで積立 → 新 endAge 64)。移行後の計算結果は従来と一致する。
 *
 * 既に `contributions` を持つ枠(v7 以降)はそのまま維持する。
 */
const migrateContributions = (input: SimulationInput): SimulationInput => ({
  ...input,
  investment: {
    ...input.investment,
    accounts: input.investment.accounts.map((account) => {
      const legacy = account as InvestmentAccount & LegacyContribution;
      // 旧キー(monthlyAmount / startAge / endAge)は残さず取り除き、新形式 contributions に一本化する。
      const { monthlyAmount, startAge, endAge, ...rest } = legacy;
      if (Array.isArray(rest.contributions)) return rest; // 既に新形式なら維持
      const s = typeof startAge === 'number' ? startAge : 30;
      const e = typeof endAge === 'number' ? endAge : 65;
      const contributions: ContributionSetting[] = [
        { type: 'monthly', startAge: s, endAge: e - 1, monthlyAmount: monthlyAmount ?? 0 },
      ];
      return { ...rest, contributions };
    }),
  },
});

/**
 * v7 → v8 の入力マイグレーション(#18 / #21)。収入情報(本人・配偶者)に
 * 年金の受給開始年齢(`pensionStartAge`)と自動推定フラグ(`pensionAutoEstimate`)を追加する。
 *
 * - `pensionStartAge`: 未設定なら 65 歳(#18。SPEC.md 2.2 のデフォルト)。旧データは退職翌年から
 *   受給していたが、移行後は 65 歳受給開始が既定になる(退職〜受給開始の空白期間を表現できる)。
 * - `pensionAutoEstimate`: 既存プランは **false(手動)** とし、これまで入力していた `pension`
 *   (年金受給額)の値をそのまま維持する(自動推定への切替はユーザーの明示操作に委ねる)。
 *
 * 既に値を持つ収入はそのまま維持する(冪等)。
 */
const migratePensionFields = (input: SimulationInput): SimulationInput => {
  const withDefaults = (inc: IncomeInput): IncomeInput => ({
    ...inc,
    pensionStartAge: typeof inc.pensionStartAge === 'number' ? inc.pensionStartAge : 65,
    // 既存プランは手動入力値を保持する(自動推定は OFF)。
    pensionAutoEstimate:
      typeof inc.pensionAutoEstimate === 'boolean' ? inc.pensionAutoEstimate : false,
  });
  return {
    ...input,
    income: withDefaults(input.income),
    family: input.family.spouse
      ? {
          ...input.family,
          spouse: { ...input.family.spouse, income: withDefaults(input.family.spouse.income) },
        }
      : input.family,
  };
};

/**
 * プラン単位の入力マイグレーション(#71 JSON import 用)。
 * export ファイルに書かれた `version` を起点に、現在の `PERSIST_VERSION` まで、
 * 上記の入力マイグレーションを順に適用してプラン 1 件の `input` を現行形状へ揃える。
 * persist の `migrate` はストア全体(tabs/activeTabId 含む)を変換するのに対し、
 * こちらは import した個々のプランの `input` だけを対象にした薄いラッパ。
 * - v2 → v3(#46 / #50)、v3 → v4(#49 / #52)、v5 → v6(#69)は入力形状を変換する。
 * - v4 → v5(#51)は `basic.startYear` / `startMonth` を任意フィールドとして追加しただけで、
 *   未設定でも従来挙動(月割なし)にフォールバックするため入力レベルの変換は不要。
 */
export const migratePlanInput = (input: SimulationInput, fromVersion: number): SimulationInput => {
  let result = input;
  if (fromVersion < 3) result = migrateInputV2toV3(result);
  if (fromVersion < 4) result = migrateInputV3toV4(result);
  if (fromVersion < 6) result = migrateWithdrawals(result);
  if (fromVersion < 7) result = migrateContributions(result);
  if (fromVersion < 8) result = migratePensionFields(result);
  return result;
};

/** タブの一意 ID を採番する。 */
const createPlanId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** タブが未保存(ドラフトが保存内容と値として異なる)かどうか。 */
export const isTabDirty = (tab: PlanTab): boolean =>
  JSON.stringify(tab.draftInput) !== JSON.stringify(tab.savedInput);

/** 新規タブを作る。保存/ドラフトともに `input` の独立コピー(= 生成直後は未保存でない)。 */
const makeTab = (name: string, input: SimulationInput = DEFAULT_INPUT): PlanTab => ({
  id: createPlanId(),
  name,
  savedInput: cloneInput(input),
  draftInput: cloneInput(input),
});

/** 既存タブ名と重複しない「プラン N」を返す(新規タブの初期名。連番)。 */
const nextTabName = (tabs: PlanTab[]): string => {
  const names = new Set(tabs.map((t) => t.name));
  let n = tabs.length + 1;
  while (names.has(`プラン ${n}`)) n += 1;
  return `プラン ${n}`;
};

/**
 * プラン名を他タブと重複しないよう調整する(名前は全タブでユニーク)。
 * 既に使われていれば「name (2)」「name (3)」… を付す。`selfId` 自身は比較対象外。
 */
const uniquePlanName = (name: string, tabs: PlanTab[], selfId: string): string => {
  const taken = new Set(tabs.filter((t) => t.id !== selfId).map((t) => t.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
};

/** 初期タブ(永続化データが無い初回起動時に使う)。 */
const INITIAL_TAB = makeTab('プラン 1');

export interface SimulationState {
  /** 入力一式(唯一の真実。結果はここから派生する)。アクティブタブのドラフトと同期する。 */
  input: SimulationInput;
  /** 選択中の年(西暦)。未選択は null。グラフ/CF表がクリックで設定し、双方が購読する。 */
  selectedYear: number | null;
  /** プランタブ一覧(F-09)。localStorage に永続化される。 */
  tabs: PlanTab[];
  /** アクティブなタブの ID。 */
  activeTabId: string;

  /** F-01 基本情報の部分更新。 */
  setBasic: (patch: Partial<BasicInput>) => void;
  /** F-01 家族構成の部分更新。 */
  setFamily: (patch: Partial<FamilyInput>) => void;
  /** F-02 収入情報の部分更新。 */
  setIncome: (patch: Partial<IncomeInput>) => void;
  /** F-03 支出情報の部分更新。 */
  setExpense: (patch: Partial<ExpenseInput>) => void;
  /** F-05 投資設定の部分更新。 */
  setInvestment: (patch: Partial<InvestmentInput>) => void;
  /** F-04 ライフイベント一覧の置き換え。 */
  setEvents: (events: LifeEvent[]) => void;

  /** 選択年を設定する(グラフのクリックや CF表の西暦ヘッダークリックから)。 */
  setSelectedYear: (year: number | null) => void;

  /** 新しいプランタブを追加してアクティブにする。 */
  addTab: () => void;
  /** 既存タブを複製し、そのコピーをアクティブにする(入力一式はディープコピー)。 */
  duplicateTab: (id: string) => void;
  /** タブを切り替える(そのタブのドラフトを入力に読込む)。 */
  selectTab: (id: string) => void;
  /** タブを閉じる(プラン削除)。最後の 1 枚を閉じたら新しい既定タブを作る。 */
  closeTab: (id: string) => void;
  /** タブ名(プラン名)を変更する。名前は全タブでユニークになる。 */
  renameTab: (id: string, name: string) => void;
  /** アクティブタブを現在入力で上書き保存する(変更を保存 / Cmd|Ctrl+S)。 */
  saveActiveTab: () => void;
  /** アクティブタブの編集内容を破棄し、最後に保存した入力へ戻す(変更を破棄)。 */
  discardActiveTabChanges: () => void;
  /**
   * import(#71)したプランを新規タブとして末尾に追加し、最後のタブをアクティブにする。
   * 各タブは `savedInput` = `draftInput` = import した input で作られ、追加直後は未保存でない。
   * プラン名が既存タブと競合する場合は import 日時のサフィックスを付け、それでも競合すれば連番を付す。
   */
  addImportedPlans: (plans: ImportedPlan[]) => void;
}

/**
 * import 時のプラン名衝突回避に使う日時サフィックス(#71)。
 * 例: `2026-07-14 10:30`。既存タブと同名のとき「`<元の名前> (<この文字列>)`」の形で付与する。
 */
const formatImportSuffix = (date: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
};

/**
 * アクティブタブのドラフトと `input` を同時に更新するヘルパ。
 * 既存の各 setter はこれを通すことで、`input`(= アクティブタブのドラフト)の
 * 参照を必ず更新し、派生セレクタのメモ化を無効化しつつ未保存判定も正しく保つ。
 */
const withDraft = (
  state: SimulationState,
  next: SimulationInput,
): Pick<SimulationState, 'input' | 'tabs'> => ({
  input: next,
  tabs: state.tabs.map((t) => (t.id === state.activeTabId ? { ...t, draftInput: next } : t)),
});

export const useSimulationStore = create<SimulationState>()(
  persist(
    (set) => ({
      input: INITIAL_TAB.draftInput,
      selectedYear: null,
      tabs: [INITIAL_TAB],
      activeTabId: INITIAL_TAB.id,

      setBasic: (patch) =>
        set((s) => withDraft(s, { ...s.input, basic: { ...s.input.basic, ...patch } })),
      setFamily: (patch) =>
        set((s) => withDraft(s, { ...s.input, family: { ...s.input.family, ...patch } })),
      setIncome: (patch) =>
        set((s) => withDraft(s, { ...s.input, income: { ...s.input.income, ...patch } })),
      setExpense: (patch) =>
        set((s) => withDraft(s, { ...s.input, expense: { ...s.input.expense, ...patch } })),
      setInvestment: (patch) =>
        set((s) => withDraft(s, { ...s.input, investment: { ...s.input.investment, ...patch } })),
      setEvents: (events) => set((s) => withDraft(s, { ...s.input, events })),

      setSelectedYear: (year) => set({ selectedYear: year }),

      addTab: () =>
        set((s) => {
          const tab = makeTab(nextTabName(s.tabs));
          return {
            tabs: [...s.tabs, tab],
            activeTabId: tab.id,
            input: tab.draftInput,
            selectedYear: null,
          };
        }),
      duplicateTab: (id) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return {};
          const source = s.tabs[idx]!;
          // 現在表示中の入力(ドラフト)をディープコピーし、元プランと参照を共有しない。
          const copy = cloneInput(source.draftInput);
          const tab: PlanTab = {
            id: createPlanId(),
            // 名前は全タブでユニーク(#12)。既存の元プラン名が使われているため「元名 (2)」…になる。
            name: uniquePlanName(source.name, s.tabs, ''),
            // 生成直後は未保存でない(保存/ドラフトともに独立コピー)。
            savedInput: cloneInput(copy),
            draftInput: copy,
          };
          // 元タブの直後に挿入し、複製したタブをアクティブにする。
          const tabs = [...s.tabs.slice(0, idx + 1), tab, ...s.tabs.slice(idx + 1)];
          return { tabs, activeTabId: tab.id, input: tab.draftInput, selectedYear: null };
        }),
      selectTab: (id) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === id);
          if (!tab || id === s.activeTabId) return {};
          // 各タブのドラフトは常に最新に保たれているので、そのまま入力へ読込む。
          return { activeTabId: id, input: tab.draftInput, selectedYear: null };
        }),
      closeTab: (id) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return {};
          const remaining = s.tabs.filter((t) => t.id !== id);
          if (remaining.length === 0) {
            // 最後の 1 枚を閉じたら空にはせず、新しい既定タブを開く。
            const tab = makeTab('プラン 1');
            return { tabs: [tab], activeTabId: tab.id, input: tab.draftInput, selectedYear: null };
          }
          if (id !== s.activeTabId) return { tabs: remaining };
          // アクティブタブを閉じた場合は隣(右優先、無ければ左)をアクティブにする。
          // ここでは remaining.length >= 1 が保証される。
          const nextActive = remaining[Math.min(idx, remaining.length - 1)]!;
          return {
            tabs: remaining,
            activeTabId: nextActive.id,
            input: nextActive.draftInput,
            selectedYear: null,
          };
        }),
      renameTab: (id, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return {}; // 空名は無視(元の名前を維持)。
          const unique = uniquePlanName(trimmed, s.tabs, id);
          return { tabs: s.tabs.map((t) => (t.id === id ? { ...t, name: unique } : t)) };
        }),
      saveActiveTab: () =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === s.activeTabId ? { ...t, savedInput: cloneInput(s.input) } : t,
          ),
        })),
      discardActiveTabChanges: () =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === s.activeTabId);
          if (!tab) return {};
          // 保存済みスナップショットの独立コピーでドラフト・入力を置換する。
          const restored = cloneInput(tab.savedInput);
          return { ...withDraft(s, restored), selectedYear: null };
        }),
      addImportedPlans: (plans) =>
        set((s) => {
          if (plans.length === 0) return {};
          // この import 内で同一の日時サフィックスを使う(競合回避の一次手段)。
          const suffix = formatImportSuffix(new Date());
          const tabs = [...s.tabs];
          let lastId = s.activeTabId;
          for (const plan of plans) {
            const baseName = plan.name.trim() || 'インポートしたプラン';
            // まず元の名前を試し、既存タブと競合するなら import 日時サフィックスを付ける。
            const taken = new Set(tabs.map((t) => t.name));
            const withSuffix = taken.has(baseName) ? `${baseName} (${suffix})` : baseName;
            // それでも競合する場合は uniquePlanName で連番を付す(名前は全タブでユニーク)。
            const name = uniquePlanName(withSuffix, tabs, '');
            // savedInput = draftInput = import した input(追加直後は未保存でない)。
            const tab = makeTab(name, plan.input);
            tabs.push(tab);
            lastId = tab.id;
          }
          // 最後に import したタブをアクティブにする。
          const active = tabs.find((t) => t.id === lastId)!;
          return { tabs, activeTabId: lastId, input: active.draftInput, selectedYear: null };
        }),
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      // selectedYear は一時的な UI 状態なので永続化しない。
      partialize: (state) => ({
        input: state.input,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
      // 破壊的なスキーマ変更時はここで旧バージョンのデータを変換する。
      migrate: (persisted, version) => {
        let data: { input: SimulationInput; tabs: PlanTab[]; activeTabId: string };

        if (version < 2) {
          // v1: { input, plans: SavedPlan[] } → v2: タブモデルへ変換。
          const old = persisted as {
            input: SimulationInput;
            plans?: Array<{ id: string; name: string; input: SimulationInput }>;
          };
          // 旧「現在入力」を先頭のアクティブタブとして残す。
          const active: PlanTab = {
            id: createPlanId(),
            name: 'プラン 1',
            savedInput: cloneInput(old.input),
            draftInput: old.input,
          };
          // 旧プランを続けて追加。名前は全タブでユニークになるよう調整する。
          const tabs: PlanTab[] = [active];
          for (const p of old.plans ?? []) {
            tabs.push({
              id: p.id,
              name: uniquePlanName(p.name, tabs, p.id),
              savedInput: p.input,
              draftInput: cloneInput(p.input),
            });
          }
          data = { input: old.input, tabs, activeTabId: active.id };
        } else {
          data = persisted as { input: SimulationInput; tabs: PlanTab[]; activeTabId: string };
        }

        if (version < 3) {
          // v2 → v3: 投資枠の initialHolding 移行(#46)と家賃 ExpenseItem → rent 変換(#50)を
          // まとめて適用する。両者は別フィールドを扱うため共存できる。
          data = {
            ...data,
            input: migrateInputV2toV3(data.input),
            tabs: data.tabs.map((t) => ({
              ...t,
              savedInput: migrateInputV2toV3(t.savedInput),
              draftInput: migrateInputV2toV3(t.draftInput),
            })),
          };
        }

        if (version < 4) {
          // v3 → v4: 配偶者の固定年収 → IncomeInput 変換(#49)と投資枠への名義 owner 付与(#52)を
          // まとめて適用する。両者は別フィールドを扱うため共存できる。
          data = {
            ...data,
            input: migrateInputV3toV4(data.input),
            tabs: data.tabs.map((t) => ({
              ...t,
              savedInput: migrateInputV3toV4(t.savedInput),
              draftInput: migrateInputV3toV4(t.draftInput),
            })),
          };
        }

        // v4 → v5: 計算開始年月(basic.startYear / startMonth)を追加(#51)。
        // 保存済みプランは開始年月を「未設定」のまま残す。engine 側で未設定 = 月割なし
        // (1 月開始相当=初年もフル 12 ヶ月)にフォールバックするため、従来挙動を維持できる。
        // 新規プランのみ DEFAULT_INPUT により当月起点(初年月割)となる。
        // 明示的なデータ変換は不要のため、ここではバージョンを上げるのみ(意図的な no-op)。

        if (version < 6) {
          // v5 → v6: 投資枠の取り崩しを単一の年額指定 `withdrawal` から複数設定 `withdrawals` へ移行(#69)。
          data = {
            ...data,
            input: migrateWithdrawals(data.input),
            tabs: data.tabs.map((t) => ({
              ...t,
              savedInput: migrateWithdrawals(t.savedInput),
              draftInput: migrateWithdrawals(t.draftInput),
            })),
          };
        }

        if (version < 7) {
          // v6 → v7: 投資枠の積立を単一の月額 + 積立開始/終了年齢から複数の積立設定 `contributions`
          // (月額積立 + 一括投資)へ移行する。年齢別の積立額・一括投資を同一枠で表せるようにする。
          data = {
            ...data,
            input: migrateContributions(data.input),
            tabs: data.tabs.map((t) => ({
              ...t,
              savedInput: migrateContributions(t.savedInput),
              draftInput: migrateContributions(t.draftInput),
            })),
          };
        }

        if (version < 8) {
          // v7 → v8: 収入情報に年金の受給開始年齢(#18)と自動推定フラグ(#21)を追加する。
          // 既存プランは受給開始年齢を 65 歳・自動推定 OFF(手動値を維持)にする。
          data = {
            ...data,
            input: migratePensionFields(data.input),
            tabs: data.tabs.map((t) => ({
              ...t,
              savedInput: migratePensionFields(t.savedInput),
              draftInput: migratePensionFields(t.draftInput),
            })),
          };
        }

        return data;
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// 派生セレクタ(結果は入力からメモ化算出)
// ---------------------------------------------------------------------------

/**
 * `runSimulation` のメモ化ラッパ。入力の参照が前回と同じなら再計算せず前回結果を返す。
 * setter が `input` の参照を必ず更新するため、入力変更時のみ再計算される。
 */
let cachedInput: SimulationInput | null = null;
let cachedResult: SimulationResult = [];

const selectResult = (state: SimulationState): SimulationResult => {
  if (state.input !== cachedInput) {
    cachedInput = state.input;
    cachedResult = runSimulation(state.input);
  }
  return cachedResult;
};

/**
 * シミュレーション結果を購読するフック。
 * 入力が変わったときのみ `runSimulation` が走り、結果の参照も安定する(メモ化)。
 * 後続チケット(#10 グラフ / #11 年次内訳)は本フックを唯一の結果入口として使う。
 */
export const useSimulationResult = (): SimulationResult => useSimulationStore(selectResult);
