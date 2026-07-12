/**
 * 投資運用・取り崩し・運用益課税の計算(SPEC.md 2.3.1 / 2.3.2-7 / F-05)。
 *
 * 本モジュールは「前年の投資state + 当年パラメータ → 当年の投資state」を求める
 * 1ステップの純粋関数を提供する。T5(simulation.ts)の年次ループから毎年呼び出す想定。
 *
 * 金額の単位は system 基本単位の「万円」。率(利回り)は %(例: 3.0 = 3%)。
 *
 * ## 基本式(SPEC.md 2.3.1)
 * ```
 * 投資資産 = (前年の投資資産 + 積立額) × (1 + 利回り) − 取崩額
 * ```
 * 当年の運用益(評価益)は「成長分」= (前年資産 + 積立額) × 利回り とする。
 *
 * ## 取崩時課税の実装方針(簿価按分法)
 * SPEC.md 2.3.2-7: 課税口座は運用益に 20.315%(取崩時に課税)、NISA は非課税。
 * 取り崩し時点で評価額に含まれる評価益の割合を「簿価(取得原価の累計)」から求め、
 * 取崩額のうち評価益に相当する部分にのみ課税する(簿価按分法)。簿価は state に保持し、
 * 積立で増加・取崩で按分減少させることで、複数年にわたる取崩でも二重課税・課税漏れを防ぐ。
 *   評価益割合 = (評価額 − 簿価) / 評価額
 *   課税対象益 = 取崩額 × 評価益割合
 *   運用益課税 = 課税対象益 × 20.315%
 * 含み損(評価額 < 簿価)の場合は課税対象益を 0 とする(簡易モデルのため損益通算・繰越は扱わない)。
 *
 * ## NISA の扱い
 * InvestmentInput は口座種別を単一の `useNisa` フラグで表す(NISA 枠上限額の項目は持たない)。
 * そのため useNisa=true のとき口座全体を非課税、false のとき全体を課税口座として扱う。
 * NISA 枠上限を超えた分だけ課税する部分課税モデルは SPEC/型の範囲外(将来対応)。
 */

import { CAPITAL_GAINS_TAX_RATE } from './constants';
import type { InvestmentInput } from './types';

/** 投資運用の状態(年をまたいで持ち越す最小限の情報)。 */
export interface InvestmentState {
  /** 投資資産の評価額(万円)。 */
  value: number;
  /**
   * 簿価 = 取得原価の累計(万円)。
   * 課税口座の取崩時課税で「評価額に占める評価益の割合」を按分するために保持する。
   */
  costBasis: number;
}

/** 1ステップ計算の当年パラメータ。 */
export interface InvestmentStepParams {
  /** 当年の本人年齢(歳)。積立終了・取崩開始の判定に用いる。 */
  age: number;
  /** 投資設定(積立額・利回り・積立終了年齢・NISA有無・取崩設定)。 */
  investment: InvestmentInput;
}

/** 1ステップ計算の結果。 */
export interface InvestmentStepResult {
  /** 更新後の投資state(翌年の入力になる)。 */
  state: InvestmentState;
  /** 当年の運用益(評価益、万円)。SPEC.md 2.3.4 investmentGain に対応。 */
  gain: number;
  /** 当年の積立額(万円)。積立終了後は 0。 */
  contribution: number;
  /** 当年の取崩額(万円、投資資産の評価額から差し引いた額)。 */
  withdrawal: number;
  /**
   * 取り崩しに伴う運用益課税(万円)。NISA 口座は常に 0。
   * SPEC の預金残高式には現れないため、T5 側で手取り(取崩額 − 課税)として扱う。
   */
  tax: number;
}

/**
 * 初期投資stateを生成する。
 * 起点時点の投資資産額(BasicInput.investments)は、含み益が不明なため全額を簿価として扱う
 * (= 起点以降に発生した評価益にのみ課税される、保守的かつ簡易な前提)。
 */
export const initInvestmentState = (investments: number): InvestmentState => ({
  value: investments,
  costBasis: investments,
});

/**
 * 1年分の投資資産を更新する純粋関数。
 *
 * 計算順序(SPEC.md 2.3.1):
 * 1. 積立(積立終了年齢に達していなければ monthlyAmount × 12 を加算)
 * 2. 運用(積立後の元本に利回りを乗じて成長させ、評価益を確定)
 * 3. 取り崩し(開始年齢に達していれば年間取崩額を引き、課税口座なら評価益按分で課税)
 */
export const stepInvestment = (
  prev: InvestmentState,
  params: InvestmentStepParams,
): InvestmentStepResult => {
  const { age, investment } = params;
  const { monthlyAmount, annualReturn, endAge, useNisa, withdrawal } = investment;

  // --- 1. 積立 -------------------------------------------------------------
  // 積立終了年齢「以降」は積立しない(= age < endAge のときのみ積立)。
  const contribution = age < endAge ? monthlyAmount * 12 : 0;
  const principal = prev.value + contribution;
  const costBasisAfterContribution = prev.costBasis + contribution;

  // --- 2. 運用 -------------------------------------------------------------
  const returnRate = annualReturn / 100;
  const gain = principal * returnRate;
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
    if (!useNisa) {
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
    withdrawal: withdrawalAmount,
    tax,
  };
};
