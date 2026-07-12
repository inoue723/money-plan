import { describe, expect, it } from 'vitest';

import { CAPITAL_GAINS_TAX_RATE } from './constants';
import { initInvestmentState, stepInvestment } from './investment';
import type { InvestmentInput } from './types';

/** テスト用の投資設定を作る(必要な項目だけ上書き)。 */
const makeInvestment = (overrides: Partial<InvestmentInput> = {}): InvestmentInput => ({
  monthlyAmount: 0,
  annualReturn: 0,
  endAge: 65,
  useNisa: false,
  ...overrides,
});

describe('initInvestmentState', () => {
  it('起点の投資資産額を評価額・簿価の両方に設定する', () => {
    expect(initInvestmentState(300)).toEqual({ value: 300, costBasis: 300 });
  });
});

describe('stepInvestment - 積立のみ', () => {
  it('積立 + 運用益を評価額に反映し、簿価は積立分だけ増える', () => {
    const prev = initInvestmentState(0);
    const investment = makeInvestment({ monthlyAmount: 3, annualReturn: 3.0, useNisa: true });

    const result = stepInvestment(prev, { age: 30, investment });

    // 年間積立 = 3 × 12 = 36、運用益 = 36 × 3% = 1.08、評価額 = 37.08
    expect(result.contribution).toBe(36);
    expect(result.gain).toBeCloseTo(1.08, 10);
    expect(result.state.value).toBeCloseTo(37.08, 10);
    expect(result.state.costBasis).toBeCloseTo(36, 10);
    expect(result.withdrawal).toBe(0);
    expect(result.tax).toBe(0);
  });

  it('前年評価額にも利回りが乗る', () => {
    const prev = { value: 1000, costBasis: 800 };
    const investment = makeInvestment({ monthlyAmount: 0, annualReturn: 5.0 });

    const result = stepInvestment(prev, { age: 40, investment });

    // 運用益 = 1000 × 5% = 50
    expect(result.gain).toBeCloseTo(50, 10);
    expect(result.state.value).toBeCloseTo(1050, 10);
  });
});

describe('stepInvestment - 積立終了', () => {
  it('積立終了年齢に達したら積立を止める(age >= endAge)', () => {
    const prev = { value: 1000, costBasis: 800 };
    const investment = makeInvestment({ monthlyAmount: 5, annualReturn: 3.0, endAge: 65 });

    const atEnd = stepInvestment(prev, { age: 65, investment });
    expect(atEnd.contribution).toBe(0);
    // 運用益 = 1000 × 3% = 30、積立なしなので評価額 = 1030
    expect(atEnd.state.value).toBeCloseTo(1030, 10);
    expect(atEnd.state.costBasis).toBeCloseTo(800, 10);
  });

  it('積立終了年齢の前年までは積立する(age < endAge)', () => {
    const prev = { value: 1000, costBasis: 800 };
    const investment = makeInvestment({ monthlyAmount: 5, annualReturn: 0, endAge: 65 });

    const beforeEnd = stepInvestment(prev, { age: 64, investment });
    expect(beforeEnd.contribution).toBe(60); // 5 × 12
    expect(beforeEnd.state.costBasis).toBeCloseTo(860, 10);
  });
});

describe('stepInvestment - 取り崩し(課税口座)', () => {
  it('評価益按分で 20.315% を課税し、評価額・簿価を減らす', () => {
    const prev = { value: 1000, costBasis: 600 };
    const investment = makeInvestment({
      annualReturn: 0,
      useNisa: false,
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    // 評価益割合 = (1000 − 600) / 1000 = 0.4、課税対象益 = 100 × 0.4 = 40
    expect(result.tax).toBeCloseTo(40 * CAPITAL_GAINS_TAX_RATE, 10); // 8.126
    // 取崩後: 評価額 900、簿価 600 × (1 − 100/1000) = 540
    expect(result.state.value).toBeCloseTo(900, 10);
    expect(result.state.costBasis).toBeCloseTo(540, 10);
  });

  it('開始年齢に達していなければ取り崩さない', () => {
    const prev = { value: 1000, costBasis: 600 };
    const investment = makeInvestment({
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 60, investment });

    expect(result.withdrawal).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.state.value).toBeCloseTo(1000, 10);
  });

  it('含み損のときは課税しない', () => {
    const prev = { value: 500, costBasis: 800 };
    const investment = makeInvestment({
      useNisa: false,
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.tax).toBe(0);
    expect(result.state.value).toBeCloseTo(400, 10);
    // 簿価 = 800 × (1 − 100/500) = 640
    expect(result.state.costBasis).toBeCloseTo(640, 10);
  });

  it('評価額を超える取り崩しは評価額までに制限される', () => {
    const prev = { value: 50, costBasis: 20 };
    const investment = makeInvestment({
      useNisa: false,
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(50);
    expect(result.state.value).toBeCloseTo(0, 10);
  });
});

describe('stepInvestment - 取り崩し(NISA)', () => {
  it('NISA 口座は取り崩しても非課税', () => {
    const prev = { value: 1000, costBasis: 600 };
    const investment = makeInvestment({
      useNisa: true,
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    expect(result.tax).toBe(0);
    expect(result.state.value).toBeCloseTo(900, 10);
  });
});

describe('stepInvestment - T5 年次ループでの連鎖', () => {
  it('前年stateを次年の入力として複数年チェーンできる', () => {
    const investment = makeInvestment({ monthlyAmount: 10, annualReturn: 3.0, useNisa: true });

    let state = initInvestmentState(0);
    for (let age = 30; age < 33; age++) {
      state = stepInvestment(state, { age, investment }).state;
    }

    // 3年間、毎年 120 万円を積み立てて 3% 運用した複利の手計算値。
    // y1: 120 × 1.03 = 123.6
    // y2: (123.6 + 120) × 1.03 = 250.908
    // y3: (250.908 + 120) × 1.03 = 382.03524
    expect(state.value).toBeCloseTo(382.03524, 5);
    expect(state.costBasis).toBeCloseTo(360, 10);
  });
});
