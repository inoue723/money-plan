import { describe, expect, it } from 'vitest';

import { ping, CAPITAL_GAINS_TAX_RATE, EDUCATION_COST } from './index';
import type { SimulationInput, SimulationResult } from './index';

describe('finance-core 疎通', () => {
  it('ping が pong を返す(workspace 疎通)', () => {
    expect(ping()).toBe('pong');
  });

  it('定数テーブルが公開されている', () => {
    expect(CAPITAL_GAINS_TAX_RATE).toBeCloseTo(0.20315);
    expect(EDUCATION_COST.elementary.public).toBe(35);
  });

  it('型が利用できる(型付き値を組み立てられる)', () => {
    const input: SimulationInput = {
      basic: { currentAge: 30, endAge: 90, savings: 500, investments: 0 },
      family: { children: [] },
      income: {
        salary: 500,
        raiseRate: 1.0,
        retirementAge: 65,
        retirementBonus: 0,
        pension: 0,
        other: 0,
      },
      expense: { rent: 8, living: 15, insurance: 1, fixed: 2, inflationRate: 1.0 },
      events: [],
      investment: { monthlyAmount: 3, annualReturn: 3.0, endAge: 65, useNisa: true },
    };
    const result: SimulationResult = [];

    expect(input.basic.currentAge).toBe(30);
    expect(result).toHaveLength(0);
  });
});
