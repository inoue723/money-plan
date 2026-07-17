/**
 * 投資運用・取り崩し・運用益課税の計算(SPEC.md 2.3.1 / 2.3.2-7 / F-05)。
 *
 * 投資設定は複数の投資枠(InvestmentAccount[])で表す。各枠を独立に運用(積立・利回り・
 * 取り崩し)し、評価額の合計を年次の投資資産評価額とする。本モジュールは「前年の投資state +
 * 当年パラメータ → 当年の投資state」を求める 1 ステップの純粋関数を提供する。T5(simulation.ts)の
 * 年次ループから毎年呼び出す想定。
 *
 * 金額の単位は system 基本単位の「万円」。率(利回り)は %(例: 3.0 = 3%)。
 *
 * ## 基本式(SPEC.md 2.3.1、枠ごと)
 * ```
 * 投資資産 = (前年の投資資産 + 積立額) × (1 + 利回り) − 取崩額
 * ```
 * 当年の運用益(評価益)は「成長分」= (前年資産 + 積立額) × 利回り とする。
 *
 * ## 取り崩し(#69)
 * 各投資枠は取り崩し設定を**複数**持てる(`InvestmentAccount.withdrawals`。空配列 = 取り崩しなし)。
 * 設定は判別可能union(`WithdrawalSetting`)で 2 種類ある:
 *
 *   - **分割取崩(spread)**: `startAge`〜`endAge` の期間で残高を均等に取り崩し切る。金額入力はなく、
 *     当年の取崩額は「取崩直前の評価額 ÷ 残り年数(endAge − 当年年齢 + 1)」。`endAge` の年は
 *     残り年数が 1 になるため残額をすべて取り崩し、**期間末に枠残高が 0** になる。
 *   - **一括取崩(lumpSum)**: `age` の年に `amount`(万円)を取り崩す。残高が指定額に満たない
 *     場合は残高全額まで(`min(amount, 残高)`)。
 *
 * 当年に該当する設定は次の順で**順次**適用する(各設定は直前の取崩後の残高に対して評価される):
 *   1. spread(定義順)
 *   2. lumpSum(定義順)
 * spread を先に適用するのは、分割取崩の当年額を「一括取崩で減る前の残高」から算出し、
 * 期間で均等に取り崩し切るという意図を保つため。期間・年齢が重複する複数設定が同一年に該当しても
 * 計算はクラッシュせず順次適用で処理する(残高 0 になったら以降の取崩額は 0。重複は UI 側で警告する)。
 *
 * ## 取崩時課税の実装方針(簿価按分法)
 * SPEC.md 2.3.2-7: 課税口座(taxable)は運用益に 20.315%(取崩時に課税)、NISA は非課税。
 * 取り崩し時点で評価額に含まれる評価益の割合を「簿価(取得原価の累計)」から求め、
 * 取崩額のうち評価益に相当する部分にのみ課税する(簿価按分法)。簿価は state に保持し、
 * 積立で増加・取崩で按分減少させることで、複数年にわたる取崩でも二重課税・課税漏れを防ぐ。
 *   評価益割合 = (評価額 − 簿価) / 評価額
 *   課税対象益 = 取崩額 × 評価益割合
 *   運用益課税 = 課税対象益 × 20.315%
 * 含み損(評価額 < 簿価)の場合は課税対象益を 0 とする(簡易モデルのため損益通算・繰越は扱わない)。
 *
 * ## NISA 投資上限(生涯 1800 万・年間 360 万、名義ごとに独立適用。#52)
 * NISA 枠(accountType === 'nisa')の投資元本(簿価)の累計を追跡し、以下を超える積立は
 * 行わない(超過分は投資せず預金に残す = 積立額を減らすだけで、課税口座への自動振替はしない):
 *   - 生涯投資枠: NISA_LIFETIME_LIMIT(1800 万、簿価ベース、増加のみ・取崩で復活しない)
 *   - 年間投資枠: NISA_ANNUAL_LIMIT(360 万、その年の投資額)
 * NISA は 1 人 1 口座の制度のため、上限は**名義(owner)ごとに独立**して適用する
 * (本人の枠と配偶者の枠はそれぞれ別々に 1800 万・360 万を持つ)。同じ名義の複数 NISA 枠は
 * その名義の枠内で合算し、リストの順に残余を消費する。
 * 取り崩し(売却)による生涯枠の復活は本 issue の対象外のため、生涯簿価累計は減少させない。
 *
 * ## 初期保有額(InvestmentAccount.initialHolding)と取得価額(acquisitionCost)の扱い
 * 各投資枠は起点時点の初期保有額(現在投資額 = 時価)を持ち、その枠の初期評価額に組み入れる
 * (その枠の利回り・取り崩し設定で運用される)。簿価(取得原価)は取得価額 `acquisitionCost`
 * とし、未指定なら時価(initialHolding)と同値とみなす(含み益 0 の簡易化。#46/#52 と後方互換)。
 * 取得価額 < 時価 のとき初期保有に含み益があり、以下のように反映する(#59):
 *   - NISA 枠の初期保有は**簿価(取得価額)ぶんだけ** NISA 生涯投資枠(1800 万)を消費する
 *     (含み益は枠を消費しない)。年間投資枠(360 万)は「その年の新規積立額」への制約のため、
 *     起点保有分は年間枠を消費しない。
 *   - 課税枠は簿価を初期簿価に据えることで、取崩時の譲渡益課税が初期保有の含み益に正しく及ぶ。
 * 生涯枠の消費は名義(owner)ごとに独立して判定する(#52)。
 */

import { CAPITAL_GAINS_TAX_RATE, NISA_ANNUAL_LIMIT, NISA_LIFETIME_LIMIT } from './constants';
import type {
  AccountOwner,
  AccountType,
  InvestmentAccount,
  InvestmentInput,
  LumpSumWithdrawal,
  SpreadWithdrawal,
  WithdrawalSetting,
} from './types';

/** 名義の全リスト(名義ごとの集計・反復に使う内部定数)。 */
const ACCOUNT_OWNERS: readonly AccountOwner[] = ['self', 'spouse'];

/**
 * iDeCo・小規模企業共済の口座か(#73)。
 * これらは拠出が小規模企業共済等掛金控除の対象・運用益非課税・受取簡易課税として同一に扱う。
 */
const isMutualAidAccount = (accountType: AccountType): boolean =>
  accountType === 'ideco' || accountType === 'mutualAid';

/** 名義ごとの数値マップ(NISA 生涯枠の名義別追跡に使う)。 */
export type OwnerAmounts = Record<AccountOwner, number>;

/** すべての名義を 0 で初期化した名義別マップを作る。 */
const emptyOwnerAmounts = (): OwnerAmounts => ({ self: 0, spouse: 0 });

/**
 * 枠の名義を安全に取り出す。owner 未設定(旧データ等)は 'self' とみなす(デフォルト 'self')。
 */
const ownerOf = (account: InvestmentAccount): AccountOwner =>
  account.owner === 'spouse' ? 'spouse' : 'self';

/** 枠の初期保有額の時価(評価額の初期値)。負値は 0 に丸める。 */
const initialValueOf = (account: InvestmentAccount): number => Math.max(0, account.initialHolding);

/**
 * 枠の初期保有額の簿価(取得原価)。取得価額 `acquisitionCost` が指定されていればそれを、
 * 未指定なら時価(initialHolding)を簿価とみなす(#59。含み益 0 の簡易化=後方互換)。負値は 0 に丸める。
 */
const initialCostBasisOf = (account: InvestmentAccount): number =>
  Math.max(0, account.acquisitionCost ?? account.initialHolding);

/** 1 つの投資枠の運用state(年をまたいで持ち越す最小限の情報)。 */
export interface AccountState {
  /** 投資資産の評価額(万円)。 */
  value: number;
  /**
   * 簿価 = 取得原価の累計(万円)。
   * 課税口座の取崩時課税で「評価額に占める評価益の割合」を按分するために保持する。
   */
  costBasis: number;
}

/** 投資運用の状態(全枠分 + NISA 生涯枠の消費状況)。 */
export interface InvestmentState {
  /** 各投資枠の運用state(input.accounts と同じ順序・同じ長さ)。 */
  accounts: AccountState[];
  /**
   * 名義ごとの NISA 簿価投入累計(万円)。NISA 生涯投資枠(1800 万)の判定に使う(#52)。
   * NISA は 1 人 1 口座のため名義別に独立して追跡する。取り崩しによる枠復活は本 issue の
   * 対象外のため、各値は増加のみで減少しない。
   */
  nisaLifetimeCostBasis: OwnerAmounts;
}

/** 1ステップ計算の当年パラメータ。 */
export interface InvestmentStepParams {
  /** 当年の本人年齢(歳)。積立終了・取崩開始の判定に用いる。 */
  age: number;
  /** 投資設定(投資枠のリスト)。 */
  investment: InvestmentInput;
  /**
   * 当年の月割係数(0〜1、#51)。初年(計算開始月が年途中)のみ 1 未満で、積立額と運用益を
   * この係数で按分する(例: 7 月開始なら 0.5)。未指定・2 年目以降は 1(フル 12 ヶ月)。
   * NISA の年間投資枠(360 万)は暦年単位のため按分せず、按分後の積立額に対して判定する。
   */
  monthFactor?: number;
}

/**
 * iDeCo・小規模企業共済の当年の一括取崩(一時金受取)1 件(#73)。
 * 一時金は退職所得として分離課税するため、金額と勤続年数(=拠出年数)を呼び出し側に渡す。
 */
export interface MutualAidLumpSum {
  /** 名義(本人 / 配偶者)。 */
  owner: AccountOwner;
  /** 一括取崩額(万円)。 */
  amount: number;
  /** 退職所得控除の算定に用いる勤続年数(年)= 受取年齢 − 積立開始年齢(#73)。 */
  yearsOfService: number;
}

/** 1ステップ計算の結果(全枠合計)。 */
export interface InvestmentStepResult {
  /** 更新後の投資state(翌年の入力になる)。 */
  state: InvestmentState;
  /** 当年の運用益(評価益、全枠合計・万円)。SPEC.md 2.3.4 investmentGain に対応。 */
  gain: number;
  /** 当年に実際に積み立てた額(全枠合計・万円)。預金から差し引く額。積立終了後・上限超過分は含まない。 */
  contribution: number;
  /**
   * NISA 上限(生涯 1800 万・年間 360 万)により積み立てられず預金に残った額(全枠合計・万円)。
   * この額は預金から差し引かれず savings に残る。>0 なら当年 NISA 上限で積立が一部停止したことを示す。
   */
  uninvested: number;
  /** 当年の取崩額(全枠合計・万円、投資資産の評価額から差し引いた額)。 */
  withdrawal: number;
  /** 取り崩しに伴う運用益課税(全枠合計・万円)。NISA・iDeCo・小規模企業共済の枠は常に 0。 */
  tax: number;
  /**
   * iDeCo・小規模企業共済の当年の拠出額を名義ごとに合算した額(万円、#73)。
   * 呼び出し側で小規模企業共済等掛金控除として、その名義の所得税・住民税から全額控除する。
   */
  mutualAidContributionByOwner: OwnerAmounts;
  /**
   * iDeCo・小規模企業共済の当年の分割取崩(年金受取)額を名義ごとに合算した額(万円、#73)。
   * 呼び出し側でその年の公的年金収入に合算し、公的年金等控除つきで課税する。
   */
  mutualAidSpreadByOwner: OwnerAmounts;
  /**
   * iDeCo・小規模企業共済の当年の一括取崩(一時金受取)の一覧(#73)。
   * 呼び出し側で各件を退職所得として分離課税する。
   */
  mutualAidLumpSums: MutualAidLumpSum[];
  /** 当年末の投資資産評価額(全枠合計・万円)。 */
  investmentValue: number;
  /**
   * 各投資枠の当年の運用成長後・取崩処理適用前の評価額(万円、#72)。
   * `investment.accounts` と同順・同数。当年の取り崩しを差し引く前の枠ごとの評価額で、
   * 一括取崩の対象年齢に対する「その時点の枠評価額」表示(tooltip)などに用いる。
   */
  accountValuesBeforeWithdrawal: number[];
}

/** 1 つの枠の 1 ステップ計算パラメータ(内部用)。 */
interface AccountStepParams {
  account: InvestmentAccount;
  age: number;
  /** この枠が積み立て可能な上限(万円)。NISA 枠のみ有限、課税枠は Infinity。 */
  contributionCap: number;
  /** 当年の月割係数(0〜1、#51)。積立額・運用益に乗じる。初年以外は 1。 */
  monthFactor: number;
}

/** 1 つの枠の 1 ステップ計算結果(内部用)。 */
interface AccountStepResult {
  state: AccountState;
  gain: number;
  contribution: number;
  uninvested: number;
  withdrawal: number;
  tax: number;
  /** 当年の分割取崩(spread)の取崩額合計(万円、#73)。iDeCo・小規模企業共済の年金合算課税に使う。 */
  spreadWithdrawal: number;
  /** 当年の一括取崩(lumpSum)の取崩額の一覧(万円、#73)。iDeCo・小規模企業共済の一時金課税に使う。 */
  lumpSumWithdrawals: number[];
  /**
   * 当年の運用成長後・取崩処理適用前の評価額(万円、#72)。
   * = (前年評価額 + 当年積立額) × (1 + 利回り)。当年の取り崩し(spread / lumpSum)を差し引く前の値。
   */
  valueBeforeWithdrawal: number;
}

/** 空の枠state。 */
const emptyAccountState = (): AccountState => ({ value: 0, costBasis: 0 });

/**
 * 起点時点で NISA 生涯枠が初期保有額により既に消費されている額を**名義ごと**に求める(#52)。
 * NISA 枠の初期保有額は**簿価(取得価額)**ぶんだけ生涯枠(1800 万)を消費する(#59。取得価額が
 * 未指定なら時価を簿価とみなす=#46 と後方互換)。NISA は 1 人 1 口座のため、名義(owner)ごとに
 * 独立して集計する。
 */
export const nisaInitialLifetimeUsage = (accounts: InvestmentAccount[]): OwnerAmounts => {
  const usage = emptyOwnerAmounts();
  for (const a of accounts) {
    if (a.accountType === 'nisa') {
      usage[ownerOf(a)] += initialCostBasisOf(a);
    }
  }
  return usage;
};

/**
 * 初期投資stateを生成する。
 * 各投資枠の初期保有額を、評価額(value)は時価(initialHolding)、簿価(costBasis)は取得価額
 * (acquisitionCost、未指定なら時価)としてその枠の初期stateに組み入れる(モジュール冒頭の方針を参照)。
 * NISA 枠は初期保有の簿価ぶんだけ生涯枠を消費するため、名義ごとに生涯簿価累計の初期値へ加算する。
 */
export const initInvestmentState = (accounts: InvestmentAccount[]): InvestmentState => {
  const accountStates: AccountState[] = accounts.map((a) => ({
    value: initialValueOf(a),
    costBasis: initialCostBasisOf(a),
  }));
  return {
    accounts: accountStates,
    nisaLifetimeCostBasis: nisaInitialLifetimeUsage(accounts),
  };
};

/**
 * 当年に該当する取り崩し設定を、**適用順**に並べて返す(内部用。#69)。
 *
 * 適用順は spread(定義順)→ lumpSum(定義順)。spread を先に適用することで、分割取崩の
 * 当年額を「一括取崩で減る前の残高」から算出する(期間で均等に取り崩し切る意図を保つ)。
 * 期間・年齢が重複する設定が複数該当しても、そのまま定義順に並べて順次適用させる。
 */
const withdrawalsForAge = (withdrawals: WithdrawalSetting[], age: number): WithdrawalSetting[] => [
  ...withdrawals.filter(
    (w): w is SpreadWithdrawal => w.type === 'spread' && age >= w.startAge && age <= w.endAge,
  ),
  ...withdrawals.filter((w): w is LumpSumWithdrawal => w.type === 'lumpSum' && age === w.age),
];

/**
 * 取り崩し設定 1 件の当年の取崩希望額(万円)を求める(内部用。#69)。
 * 実際の取崩額は呼び出し側で残高 `value` にクランプする(`min(希望額, value)`)。
 *
 * - spread: 評価額 ÷ 残り年数(endAge − age + 1)。残り年数が 1 以下(= endAge の年)なら残額全部。
 * - lumpSum: 指定額(`amount`)そのもの。
 *
 * @param value 取崩直前の評価額(同一年に先行する設定の取崩を反映済みの残高)。
 */
const desiredWithdrawal = (setting: WithdrawalSetting, age: number, value: number): number => {
  if (setting.type === 'lumpSum') return setting.amount;
  const remainingYears = setting.endAge - age + 1;
  // endAge の年(= 残り 1 年)、および不正な入力で残り年数が 0 以下になる場合は残額をすべて取り崩す。
  return remainingYears <= 1 ? value : value / remainingYears;
};

/**
 * 1 つの投資枠を 1 年分更新する純粋関数(内部用)。
 *
 * 計算順序(SPEC.md 2.3.1):
 * 1. 積立(積立終了年齢に達していなければ monthlyAmount × 12。ただし contributionCap でクランプ)
 * 2. 運用(積立後の元本に利回りを乗じて成長させ、評価益を確定)
 * 3. 取り崩し(当年に該当する設定を spread → lumpSum の順に順次適用し、課税口座なら評価益按分で課税)
 */
const stepAccount = (prev: AccountState, params: AccountStepParams): AccountStepResult => {
  const { account, age, contributionCap, monthFactor } = params;
  const { accountType, monthlyAmount, annualReturn, startAge, endAge } = account;
  // 旧データ(#69 以前の `withdrawal`)が migration を経ずに渡ってもクラッシュしないよう空配列に倒す。
  const withdrawals = account.withdrawals ?? [];

  // --- 1. 積立(上限でクランプ) -------------------------------------------
  // 積立開始年齢「以降」かつ終了年齢「未満」の間のみ積立(= startAge <= age < endAge)。
  // 初年(#51)は月割係数で按分する(例: 7 月開始なら年額の 6/12)。
  const desired = age >= startAge && age < endAge ? monthlyAmount * 12 * monthFactor : 0;
  const contribution = Math.max(0, Math.min(desired, contributionCap));
  const uninvested = desired - contribution;
  const principal = prev.value + contribution;
  const costBasisAfterContribution = prev.costBasis + contribution;

  // --- 2. 運用 -------------------------------------------------------------
  // 初年(#51)は運用益も月割係数で按分する(年途中開始 = 運用期間が短いため)。
  const gain = principal * (annualReturn / 100) * monthFactor;
  const grownValue = principal + gain;

  // --- 3. 取り崩し ---------------------------------------------------------
  // 当年に該当する設定を spread → lumpSum の順に**順次**適用する(#69)。各設定は直前の取崩を
  // 反映した残高に対して評価するため、残高が尽きたら以降の取崩額は 0 になる。
  let withdrawalAmount = 0;
  let spreadWithdrawal = 0;
  const lumpSumWithdrawals: number[] = [];
  let tax = 0;
  let newValue = grownValue;
  let newCostBasis = costBasisAfterContribution;

  for (const setting of withdrawalsForAge(withdrawals, age)) {
    // 残高が尽きたら以降の設定は取り崩せない(取崩額 0)。
    if (newValue <= 0) break;

    // 評価額を超えて取り崩すことはできない。
    const amount = Math.min(Math.max(0, desiredWithdrawal(setting, age, newValue)), newValue);
    if (amount <= 0) continue;

    // 課税口座のみ、取崩額に含まれる評価益へ課税する(NISA・iDeCo・小規模企業共済は運用益非課税)。
    // 簿価按分は残存比率で行うため評価益割合は取崩の前後で不変で、同一年に複数回取り崩しても
    // 二重課税・課税漏れは起きない。iDeCo・小規模企業共済の受取課税は取崩の種別(spread / lumpSum)に
    // 応じて呼び出し側(simulation.ts)で行う(spread=年金合算・lumpSum=退職所得)。
    if (accountType === 'taxable') {
      const unrealizedGain = newValue - newCostBasis;
      const gainRatio = unrealizedGain > 0 ? unrealizedGain / newValue : 0;
      tax += amount * gainRatio * CAPITAL_GAINS_TAX_RATE;
    }

    // 種別ごとに取崩額を集計する(#73。iDeCo・小規模企業共済の受取課税の按分に使う)。
    if (setting.type === 'spread') {
      spreadWithdrawal += amount;
    } else {
      lumpSumWithdrawals.push(amount);
    }

    // 取崩後の評価額と簿価(簿価は取崩額のうち元本相当分だけ減らす)。
    const remainingRatio = 1 - amount / newValue;
    newValue -= amount;
    newCostBasis *= remainingRatio;
    withdrawalAmount += amount;
  }

  return {
    state: { value: newValue, costBasis: newCostBasis },
    gain,
    contribution,
    uninvested,
    withdrawal: withdrawalAmount,
    tax,
    spreadWithdrawal,
    lumpSumWithdrawals,
    valueBeforeWithdrawal: grownValue,
  };
};

/**
 * 全投資枠を 1 年分更新する純粋関数。
 *
 * 各枠を独立に運用しつつ、NISA 枠には投資上限(生涯 1800 万・年間 360 万)を**名義ごとに**
 * 独立適用する(#52)。同じ名義の NISA 枠はリストの順にその名義の残余を消費し、上限に達した枠の
 * 超過分は積み立てず預金に残す。本人の枠と配偶者の枠はそれぞれ別々の上限を持つ。
 */
export const stepInvestment = (
  prev: InvestmentState,
  params: InvestmentStepParams,
): InvestmentStepResult => {
  const { age, investment, monthFactor = 1 } = params;
  const accounts = investment.accounts;

  // NISA 上限の残余を名義ごとに保持する。年間枠は毎年リセット、生涯枠は名義別の簿価累計から算出。
  const annualNisaRemaining: OwnerAmounts = emptyOwnerAmounts();
  const lifetimeNisaRemaining: OwnerAmounts = emptyOwnerAmounts();
  for (const owner of ACCOUNT_OWNERS) {
    annualNisaRemaining[owner] = NISA_ANNUAL_LIMIT;
    lifetimeNisaRemaining[owner] = Math.max(
      0,
      NISA_LIFETIME_LIMIT - prev.nisaLifetimeCostBasis[owner],
    );
  }

  const newAccountStates: AccountState[] = [];
  const accountValuesBeforeWithdrawal: number[] = [];
  let totalGain = 0;
  let totalContribution = 0;
  let totalUninvested = 0;
  let totalWithdrawal = 0;
  let totalTax = 0;
  let totalValue = 0;
  const nisaContributedThisYear: OwnerAmounts = emptyOwnerAmounts();
  // iDeCo・小規模企業共済の受取・拠出の集計(#73)。呼び出し側で控除・課税に用いる。
  const mutualAidContributionByOwner: OwnerAmounts = emptyOwnerAmounts();
  const mutualAidSpreadByOwner: OwnerAmounts = emptyOwnerAmounts();
  const mutualAidLumpSums: MutualAidLumpSum[] = [];

  accounts.forEach((account, idx) => {
    const prevAccount = prev.accounts[idx] ?? emptyAccountState();
    const isNisa = account.accountType === 'nisa';
    const owner = ownerOf(account);

    // NISA 枠は当該名義の年間・生涯の残余のうち小さい方まで、課税枠は無制限。
    // iDeCo・小規模企業共済は NISA 上限の対象外のため無制限(生涯・年間枠を消費しない。#73)。
    const contributionCap = isNisa
      ? Math.max(0, Math.min(annualNisaRemaining[owner], lifetimeNisaRemaining[owner]))
      : Number.POSITIVE_INFINITY;

    const step = stepAccount(prevAccount, { account, age, contributionCap, monthFactor });

    if (isNisa) {
      annualNisaRemaining[owner] -= step.contribution;
      lifetimeNisaRemaining[owner] -= step.contribution;
      nisaContributedThisYear[owner] += step.contribution;
    }

    // iDeCo・小規模企業共済(#73): 拠出額(全額所得控除)と受取額(spread=年金 / lumpSum=一時金)を名義ごとに集計。
    if (isMutualAidAccount(account.accountType)) {
      mutualAidContributionByOwner[owner] += step.contribution;
      mutualAidSpreadByOwner[owner] += step.spreadWithdrawal;
      for (const amount of step.lumpSumWithdrawals) {
        // 勤続年数 = 受取年齢 − 積立開始年齢(#73。0 以上に丸め、控除計算側で最低 1 年に補正)。
        mutualAidLumpSums.push({ owner, amount, yearsOfService: Math.max(0, age - account.startAge) });
      }
    }

    newAccountStates.push(step.state);
    accountValuesBeforeWithdrawal.push(step.valueBeforeWithdrawal);
    totalGain += step.gain;
    totalContribution += step.contribution;
    totalUninvested += step.uninvested;
    totalWithdrawal += step.withdrawal;
    totalTax += step.tax;
    totalValue += step.state.value;
  });

  const nextLifetimeCostBasis = emptyOwnerAmounts();
  for (const owner of ACCOUNT_OWNERS) {
    nextLifetimeCostBasis[owner] =
      prev.nisaLifetimeCostBasis[owner] + nisaContributedThisYear[owner];
  }

  return {
    state: {
      accounts: newAccountStates,
      nisaLifetimeCostBasis: nextLifetimeCostBasis,
    },
    gain: totalGain,
    contribution: totalContribution,
    uninvested: totalUninvested,
    withdrawal: totalWithdrawal,
    tax: totalTax,
    mutualAidContributionByOwner,
    mutualAidSpreadByOwner,
    mutualAidLumpSums,
    investmentValue: totalValue,
    accountValuesBeforeWithdrawal,
  };
};

/** 投資枠の年次評価額(1 年分。#72)。 */
export interface AccountValuesAtAge {
  /** 当年の本人年齢(歳)。 */
  age: number;
  /**
   * その年の各投資枠の運用成長後・取崩処理適用前の評価額(万円)。
   * `investment.accounts` と同順・同数。
   */
  values: number[];
}

/**
 * 各投資枠の「運用成長後・取崩処理適用前」の年次評価額を、現在年齢から `endAge` まで求める(#72)。
 *
 * `runSimulation` と同じ年次ステップ(`stepInvestment`)・同じ月割ロジック(#51)を再利用するため、
 * ここで得られる評価額はシミュレーション本体の投資計算と整合する。各枠は独立に運用され、同一名義の
 * NISA 枠には投資上限が適用される点も本体と同じ(現在の入力全体を反映した値になる)。
 *
 * 「取崩処理適用前」は当年の spread / lumpSum いずれも差し引く前の値を意味する。前年までの取り崩し
 * (同一枠の他の取り崩し設定を含む)は state を通じて反映される。一括取崩の対象年齢に対する
 * 「その年齢時点の枠評価額」表示に用いる。
 *
 * @returns 年ごとに 1 要素の配列(`endAge < currentAge` の場合は空配列)。各要素の `values` は
 *   `investment.accounts` と同順・同数。
 */
export const investmentAccountValuesBeforeWithdrawal = (params: {
  investment: InvestmentInput;
  /** シミュレーション起点の本人年齢(歳)。 */
  currentAge: number;
  /** シミュレーション終了年齢(歳)。 */
  endAge: number;
  /**
   * 計算開始月(1〜12、#51)。初年はこの月から 12 月までを月割で計上する(積立・運用益に按分)。
   * 未指定なら月割なし(初年もフル 12 ヶ月。`runSimulation` と同じ既定挙動)。
   */
  startMonth?: number;
}): AccountValuesAtAge[] => {
  const { investment, currentAge, endAge, startMonth } = params;
  // 初年の月数(#51)。simulation.ts と同じ式で求める(startMonth を 1〜12 にクランプ)。
  const firstYearMonths =
    startMonth != null ? 13 - Math.min(12, Math.max(1, Math.round(startMonth))) : 12;

  const series: AccountValuesAtAge[] = [];
  let state = initInvestmentState(investment.accounts);
  for (let i = 0; currentAge + i <= endAge; i++) {
    const age = currentAge + i;
    const monthFactor = i === 0 ? firstYearMonths / 12 : 1;
    const step = stepInvestment(state, { age, investment, monthFactor });
    series.push({ age, values: step.accountValuesBeforeWithdrawal });
    state = step.state;
  }
  return series;
};
