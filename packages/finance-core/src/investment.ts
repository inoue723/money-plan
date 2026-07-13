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
 * ## NISA 投資上限(生涯 1800 万・年間 360 万)
 * NISA 枠(accountType === 'nisa')の投資元本(簿価)の累計を全 NISA 枠合算で追跡し、
 * 以下を超える積立は行わない(超過分は投資せず預金に残す = 積立額を減らすだけで、
 * 課税口座への自動振替はしない):
 *   - 生涯投資枠: NISA_LIFETIME_LIMIT(1800 万、簿価ベース、増加のみ・取崩で復活しない)
 *   - 年間投資枠: NISA_ANNUAL_LIMIT(360 万、全 NISA 枠合算・その年の投資額)
 * 取り崩し(売却)による生涯枠の復活は本 issue の対象外のため、生涯簿価累計は減少させない。
 *
 * ## 初期保有額(InvestmentAccount.initialHolding)の扱い
 * 各投資枠は起点時点の初期保有額(現在投資額)を持ち、その枠の初期評価額・簿価に組み入れる
 * (その枠の利回り・取り崩し設定で運用される)。含み益が不明なため全額を簿価として扱う。
 * NISA 枠の初期保有額は簿価とみなし、NISA 生涯投資枠(1800 万)の消費対象に**含める**
 * (#46 での変更点。従来は上限判定の対象外だった)。年間投資枠(360 万)は「その年の新規
 * 積立額」に対する制約のため、起点で保有済みの初期保有額は年間枠を消費しない。
 * ※ 初期保有額の生涯枠消費は口座種別のみで分岐する素直な構造とし、後続 #52(配偶者 NISA 枠を
 *   名義別に管理)で名義ごとの生涯枠へ拡張できるようにしておく。
 */

import { CAPITAL_GAINS_TAX_RATE, NISA_ANNUAL_LIMIT, NISA_LIFETIME_LIMIT } from './constants';
import type { InvestmentAccount, InvestmentInput } from './types';

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
   * 全 NISA 枠合算の簿価投入累計(万円)。NISA 生涯投資枠(1800 万)の判定に使う。
   * 取り崩しによる枠復活は本 issue の対象外のため、この値は増加のみで減少しない。
   */
  nisaLifetimeCostBasis: number;
}

/** 1ステップ計算の当年パラメータ。 */
export interface InvestmentStepParams {
  /** 当年の本人年齢(歳)。積立終了・取崩開始の判定に用いる。 */
  age: number;
  /** 投資設定(投資枠のリスト)。 */
  investment: InvestmentInput;
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
  /** 取り崩しに伴う運用益課税(全枠合計・万円)。NISA 枠は常に 0。 */
  tax: number;
  /** 当年末の投資資産評価額(全枠合計・万円)。 */
  investmentValue: number;
}

/** 1 つの枠の 1 ステップ計算パラメータ(内部用)。 */
interface AccountStepParams {
  account: InvestmentAccount;
  age: number;
  /** この枠が積み立て可能な上限(万円)。NISA 枠のみ有限、課税枠は Infinity。 */
  contributionCap: number;
}

/** 1 つの枠の 1 ステップ計算結果(内部用)。 */
interface AccountStepResult {
  state: AccountState;
  gain: number;
  contribution: number;
  uninvested: number;
  withdrawal: number;
  tax: number;
}

/** 空の枠state。 */
const emptyAccountState = (): AccountState => ({ value: 0, costBasis: 0 });

/**
 * 起点時点で NISA 生涯枠が初期保有額により既に消費されている額(全 NISA 枠合算・簿価ベース)。
 * NISA 枠の初期保有額は簿価とみなし、生涯枠(1800 万)の消費対象に含める(#46)。
 * 口座種別のみで分岐する素直な構造とし、後続 #52 で名義別の生涯枠へ拡張しやすくしておく。
 */
export const nisaInitialLifetimeUsage = (accounts: InvestmentAccount[]): number =>
  accounts.reduce(
    (sum, a) => (a.accountType === 'nisa' ? sum + Math.max(0, a.initialHolding) : sum),
    0,
  );

/**
 * 初期投資stateを生成する。
 * 各投資枠の初期保有額(InvestmentAccount.initialHolding)を、含み益が不明なため全額を簿価
 * として扱い、その枠の初期評価額・簿価に組み入れる(モジュール冒頭の方針を参照)。
 * NISA 枠の初期保有額は簿価として生涯枠を消費するため、生涯簿価累計の初期値に加算する。
 */
export const initInvestmentState = (accounts: InvestmentAccount[]): InvestmentState => {
  const accountStates: AccountState[] = accounts.map((a) => {
    const holding = Math.max(0, a.initialHolding);
    return { value: holding, costBasis: holding };
  });
  return {
    accounts: accountStates,
    nisaLifetimeCostBasis: nisaInitialLifetimeUsage(accounts),
  };
};

/**
 * 1 つの投資枠を 1 年分更新する純粋関数(内部用)。
 *
 * 計算順序(SPEC.md 2.3.1):
 * 1. 積立(積立終了年齢に達していなければ monthlyAmount × 12。ただし contributionCap でクランプ)
 * 2. 運用(積立後の元本に利回りを乗じて成長させ、評価益を確定)
 * 3. 取り崩し(開始年齢に達していれば年間取崩額を引き、課税口座なら評価益按分で課税)
 */
const stepAccount = (prev: AccountState, params: AccountStepParams): AccountStepResult => {
  const { account, age, contributionCap } = params;
  const { accountType, monthlyAmount, annualReturn, startAge, endAge, withdrawal } = account;

  // --- 1. 積立(上限でクランプ) -------------------------------------------
  // 積立開始年齢「以降」かつ終了年齢「未満」の間のみ積立(= startAge <= age < endAge)。
  const desired = age >= startAge && age < endAge ? monthlyAmount * 12 : 0;
  const contribution = Math.max(0, Math.min(desired, contributionCap));
  const uninvested = desired - contribution;
  const principal = prev.value + contribution;
  const costBasisAfterContribution = prev.costBasis + contribution;

  // --- 2. 運用 -------------------------------------------------------------
  const gain = principal * (annualReturn / 100);
  const grownValue = principal + gain;

  // --- 3. 取り崩し ---------------------------------------------------------
  let withdrawalAmount = 0;
  let tax = 0;
  let newValue = grownValue;
  let newCostBasis = costBasisAfterContribution;

  const shouldWithdraw = withdrawal !== undefined && age >= withdrawal.startAge && grownValue > 0;

  if (shouldWithdraw) {
    // 評価額を超えて取り崩すことはできない。
    withdrawalAmount = Math.min(withdrawal.annualAmount, grownValue);

    // 取崩後の評価額と簿価(簿価は取崩額のうち元本相当分だけ減らす)。
    const remainingRatio = 1 - withdrawalAmount / grownValue;
    newValue = grownValue - withdrawalAmount;
    newCostBasis = costBasisAfterContribution * remainingRatio;

    // 課税口座のみ、取崩額に含まれる評価益へ課税する(NISA は非課税)。
    if (accountType === 'taxable') {
      const unrealizedGain = grownValue - costBasisAfterContribution;
      const gainRatio = unrealizedGain > 0 ? unrealizedGain / grownValue : 0;
      const taxableGain = withdrawalAmount * gainRatio;
      tax = taxableGain * CAPITAL_GAINS_TAX_RATE;
    }
  }

  return {
    state: { value: newValue, costBasis: newCostBasis },
    gain,
    contribution,
    uninvested,
    withdrawal: withdrawalAmount,
    tax,
  };
};

/**
 * 全投資枠を 1 年分更新する純粋関数。
 *
 * 各枠を独立に運用しつつ、NISA 枠には全 NISA 枠合算の投資上限(生涯 1800 万・年間 360 万)を
 * 適用する。NISA 枠はリストの順に上限の残余を消費し、上限に達した枠の超過分は積み立てず預金に残す。
 */
export const stepInvestment = (
  prev: InvestmentState,
  params: InvestmentStepParams,
): InvestmentStepResult => {
  const { age, investment } = params;
  const accounts = investment.accounts;

  // NISA 上限の残余(全 NISA 枠合算)。年間枠は毎年リセット、生涯枠は簿価累計から算出。
  let annualNisaRemaining = NISA_ANNUAL_LIMIT;
  let lifetimeNisaRemaining = Math.max(0, NISA_LIFETIME_LIMIT - prev.nisaLifetimeCostBasis);

  const newAccountStates: AccountState[] = [];
  let totalGain = 0;
  let totalContribution = 0;
  let totalUninvested = 0;
  let totalWithdrawal = 0;
  let totalTax = 0;
  let totalValue = 0;
  let nisaContributedThisYear = 0;

  accounts.forEach((account, idx) => {
    const prevAccount = prev.accounts[idx] ?? emptyAccountState();
    const isNisa = account.accountType === 'nisa';

    // NISA 枠は年間・生涯の残余のうち小さい方まで、課税枠は無制限。
    const contributionCap = isNisa
      ? Math.max(0, Math.min(annualNisaRemaining, lifetimeNisaRemaining))
      : Number.POSITIVE_INFINITY;

    const step = stepAccount(prevAccount, { account, age, contributionCap });

    if (isNisa) {
      annualNisaRemaining -= step.contribution;
      lifetimeNisaRemaining -= step.contribution;
      nisaContributedThisYear += step.contribution;
    }

    newAccountStates.push(step.state);
    totalGain += step.gain;
    totalContribution += step.contribution;
    totalUninvested += step.uninvested;
    totalWithdrawal += step.withdrawal;
    totalTax += step.tax;
    totalValue += step.state.value;
  });

  return {
    state: {
      accounts: newAccountStates,
      nisaLifetimeCostBasis: prev.nisaLifetimeCostBasis + nisaContributedThisYear,
    },
    gain: totalGain,
    contribution: totalContribution,
    uninvested: totalUninvested,
    withdrawal: totalWithdrawal,
    tax: totalTax,
    investmentValue: totalValue,
  };
};
