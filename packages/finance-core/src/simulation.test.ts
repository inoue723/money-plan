import { describe, expect, it } from 'vitest';

import { runSimulation } from './simulation';
import type { EducationPlan, LifeEvent, SimulationInput } from './types';

const publicPlan: EducationPlan = {
  preschool: 'public',
  elementary: 'public',
  juniorHigh: 'public',
  highSchool: 'public',
  university: 'national',
};

/** 最小構成の入力を生成し、必要な部分だけ上書きする。 */
const baseInput = (overrides: Partial<SimulationInput> = {}): SimulationInput => ({
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
  investment: { monthlyAmount: 0, annualReturn: 3.0, endAge: 65, useNisa: true },
  ...overrides,
});

describe('runSimulation', () => {
  it('現在年齢から終了年齢まで1年刻みで結果を返す', () => {
    const result = runSimulation(
      baseInput({ basic: { currentAge: 30, endAge: 90, savings: 500, investments: 0 } }),
    );
    expect(result).toHaveLength(90 - 30 + 1);
    expect(result[0]!.age).toBe(30);
    expect(result[result.length - 1]!.age).toBe(90);
    // 年は1年ずつ増える。
    expect(result[1]!.year - result[0]!.year).toBe(1);
  });

  it('endAge < currentAge のとき空配列を返す', () => {
    const result = runSimulation(
      baseInput({ basic: { currentAge: 70, endAge: 60, savings: 0, investments: 0 } }),
    );
    expect(result).toHaveLength(0);
  });

  it('最小入力で通し計算でき、総資産 = 預金 + 投資資産 が成り立つ', () => {
    const result = runSimulation(baseInput());
    for (const y of result) {
      expect(y.totalAssets).toBeCloseTo(y.savings + y.investmentValue, 6);
    }
    // 収入 > 支出の設定なので初年度は黒字。
    expect(result[0]!.balance).toBeGreaterThan(0);
  });

  it('手取り(net)は額面給与より小さい(税・社会保険料が引かれる)', () => {
    const result = runSimulation(baseInput());
    expect(result[0]!.income.grossSalary).toBeCloseTo(500, 6);
    expect(result[0]!.income.net).toBeGreaterThan(0);
    expect(result[0]!.income.net).toBeLessThan(result[0]!.income.grossSalary);
  });

  it('資産がマイナスになる年を検出できる(高支出シナリオ)', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 30, endAge: 50, savings: 100, investments: 0 },
        income: {
          salary: 300,
          raiseRate: 0,
          retirementAge: 65,
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
        expense: { rent: 20, living: 30, insurance: 2, fixed: 3, inflationRate: 1.0 },
      }),
    );
    expect(result.some((y) => y.totalAssets < 0)).toBe(true);
  });

  it('住宅購入で家賃が0になり、頭金が一時支出に計上される', () => {
    const events: LifeEvent[] = [
      {
        type: 'homePurchase',
        age: 35,
        price: 4000,
        downPayment: 800,
        loanInterestRate: 1.0,
        loanTermYears: 30,
      },
    ];
    const result = runSimulation(baseInput({ events }));
    const before = result.find((y) => y.age === 34)!;
    const buyYear = result.find((y) => y.age === 35)!;
    const after = result.find((y) => y.age === 36)!;

    // 購入前は賃貸(家賃 > 0)。購入年に頭金が一時支出に載る。
    expect(before.expense.housing).toBeGreaterThan(0);
    expect(buyYear.expense.events).toBeGreaterThanOrEqual(800);
    expect(buyYear.events).toContain('住宅購入');

    // 購入後は家賃ではなくローン返済(頭金は一時支出のみ、以降 housing はローン)。
    expect(after.expense.housing).toBeGreaterThan(0);
    // ローン完済後(age 65: 35+30)は住居費 0。
    const paidOff = result.find((y) => y.age === 65)!;
    expect(paidOff.expense.housing).toBeCloseTo(0, 6);
  });

  it('退職後は給与が0になり、年金へ切り替わる', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 60, endAge: 75, savings: 1000, investments: 0 },
        income: {
          salary: 600,
          raiseRate: 1.0,
          retirementAge: 65,
          retirementBonus: 2000,
          pension: 200,
          other: 0,
        },
      }),
    );
    const working = result.find((y) => y.age === 64)!;
    const retireYear = result.find((y) => y.age === 65)!;
    const retired = result.find((y) => y.age === 70)!;

    expect(working.income.grossSalary).toBeGreaterThan(0);
    expect(working.income.pension).toBe(0);

    // 退職年に退職金がその他収入へ計上される。
    expect(retireYear.income.other).toBeGreaterThanOrEqual(2000);
    expect(retireYear.events).toContain('退職金');

    // 退職後は給与0・年金あり。
    expect(retired.income.grossSalary).toBe(0);
    expect(retired.income.pension).toBeGreaterThan(0);
  });

  it('出産イベントで子が生まれ、児童手当と教育費が発生する', () => {
    const events: LifeEvent[] = [{ type: 'birth', age: 31, education: publicPlan }];
    const result = runSimulation(baseInput({ events }));

    const beforeBirth = result.find((y) => y.age === 30)!;
    const birthYear = result.find((y) => y.age === 31)!;
    const laterYear = result.find((y) => y.age === 38)!; // 子7歳: 小学校

    expect(beforeBirth.income.childAllowance).toBe(0);
    expect(birthYear.events).toContain('出産');
    expect(birthYear.income.childAllowance).toBeGreaterThan(0); // 0歳: 児童手当
    expect(laterYear.expense.education).toBeGreaterThan(0); // 就学後: 教育費
  });

  it('積立投資で投資資産が増え、運用益が計上される', () => {
    const result = runSimulation(
      baseInput({
        investment: { monthlyAmount: 5, annualReturn: 5.0, endAge: 65, useNisa: true },
      }),
    );
    // 初年度: 積立 60万 + 運用益。
    expect(result[0]!.income.investmentGain).toBeGreaterThan(0);
    expect(result[0]!.investmentValue).toBeGreaterThan(0);
    // 投資資産は増加していく。
    expect(result[10]!.investmentValue).toBeGreaterThan(result[0]!.investmentValue);
  });

  it('結婚で生活費係数が以降の生活費に反映される', () => {
    const events: LifeEvent[] = [{ type: 'marriage', age: 32, cost: 300, livingCostFactor: 1.5 }];
    const withMarriage = runSimulation(baseInput({ events }));
    const without = runSimulation(baseInput());

    const idx = withMarriage.findIndex((y) => y.age === 33);
    // 結婚後の生活費は係数分だけ増える。
    expect(withMarriage[idx]!.expense.living).toBeCloseTo(without[idx]!.expense.living * 1.5, 4);
    // 結婚年に一時費用。
    const marryYear = withMarriage.find((y) => y.age === 32)!;
    expect(marryYear.expense.events).toBeGreaterThanOrEqual(300);
    expect(marryYear.events).toContain('結婚');
  });

  it('通常入力(約72年分)を高速に計算できる', () => {
    const input = baseInput({
      basic: { currentAge: 18, endAge: 90, savings: 300, investments: 100 },
    });
    const t0 = Date.now();
    const result = runSimulation(input);
    const elapsed = Date.now() - t0;
    expect(result).toHaveLength(90 - 18 + 1);
    expect(elapsed).toBeLessThan(50); // 十分高速(参考値)
  });
});
