import { describe, expect, it } from 'vitest';

import { runSimulation } from './simulation';
import type { EducationPlan, LifeEvent, SimulationInput, WorkPeriod } from './types';

const publicPlan: EducationPlan = {
  preschool: 'public',
  elementary: 'public',
  juniorHigh: 'public',
  highSchool: 'public',
  university: 'national',
};

/** 働き方期間を1つ生成し、必要な部分だけ上書きする。 */
const workPeriod = (overrides: Partial<WorkPeriod> = {}): WorkPeriod => ({
  startAge: 30,
  endAge: 64,
  workStyle: 'employee',
  income: 500,
  raiseRate: 1.0,
  ...overrides,
});

/** 最小構成の入力を生成し、必要な部分だけ上書きする。 */
const baseInput = (overrides: Partial<SimulationInput> = {}): SimulationInput => ({
  basic: { currentAge: 30, endAge: 90, savings: 500, investments: 0 },
  family: { children: [] },
  income: {
    workPeriods: [workPeriod()],
    retirementBonus: 0,
    pension: 0,
    other: 0,
  },
  expense: { rent: 8, living: 15, insurance: 1, fixed: 2, inflationRate: 1.0 },
  events: [],
  investment: {
    accounts: [
      {
        name: 'NISA',
        accountType: 'nisa',
        monthlyAmount: 0,
        annualReturn: 3.0,
        startAge: 30,
        endAge: 65,
      },
    ],
  },
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
          workPeriods: [workPeriod({ income: 300, raiseRate: 0 })],
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
          workPeriods: [workPeriod({ startAge: 60, endAge: 64, income: 600 })],
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

  it('将来生まれる子どもを追加すると、誕生年以降に児童手当と教育費が発生する', () => {
    const result = runSimulation(
      baseInput({
        family: { children: [{ bornAtParentAge: 31, education: publicPlan }] },
      }),
    );

    const beforeBirth = result.find((y) => y.age === 30)!;
    const birthYear = result.find((y) => y.age === 31)!;
    const laterYear = result.find((y) => y.age === 38)!; // 子7歳: 小学校

    expect(beforeBirth.income.childAllowance).toBe(0);
    expect(beforeBirth.expense.education).toBe(0);
    expect(birthYear.events).toContain('子ども誕生');
    expect(birthYear.income.childAllowance).toBeGreaterThan(0); // 0歳: 児童手当
    expect(laterYear.expense.education).toBeGreaterThan(0); // 就学後: 教育費
  });

  it('既に生まれている子ども(bornAtParentAge ≤ 現在年齢)は起点から教育費・児童手当が計上される', () => {
    // 本人30歳・子5歳(bornAtParentAge = 25)。
    const result = runSimulation(
      baseInput({
        family: { children: [{ bornAtParentAge: 25, education: publicPlan }] },
      }),
    );

    const first = result.find((y) => y.age === 30)!;
    expect(first.income.childAllowance).toBeGreaterThan(0); // 5歳: 児童手当
    expect(first.expense.education).toBeGreaterThan(0); // 未就学: 教育費
    expect(first.events).not.toContain('子ども誕生'); // 既存の子は誕生イベント扱いしない

    // 子が19歳(本人44歳)以降は児童手当の対象外。
    const grown = result.find((y) => y.age === 44)!;
    expect(grown.income.childAllowance).toBe(0);
  });

  it('既存の子と将来の子は誕生年基準で同じモデルが適用される(年齢オフセットで一致)', () => {
    // 本人30歳・子0歳(既存)と、本人32歳で生まれる将来の子は、
    // 誕生年を起点にすると同じ教育費・児童手当の系列になる。
    const existing = runSimulation(
      baseInput({
        family: { children: [{ bornAtParentAge: 30, education: publicPlan }] },
      }),
    );
    const future = runSimulation(
      baseInput({
        family: { children: [{ bornAtParentAge: 32, education: publicPlan }] },
      }),
    );

    for (let childAge = 0; childAge <= 22; childAge++) {
      const a = existing.find((y) => y.age === 30 + childAge)!;
      const b = future.find((y) => y.age === 32 + childAge)!;
      expect(b.expense.education).toBeCloseTo(a.expense.education, 6);
      expect(b.income.childAllowance).toBeCloseTo(a.income.childAllowance, 6);
    }
  });

  it('昇給は期間の開始年齢を基準に期間内で複利適用される', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 64, income: 500, raiseRate: 2.0 })],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
      }),
    );
    expect(result.find((y) => y.age === 30)!.income.grossSalary).toBeCloseTo(500, 6);
    expect(result.find((y) => y.age === 40)!.income.grossSalary).toBeCloseTo(
      500 * Math.pow(1.02, 10),
      6,
    );
  });

  it('働き方期間の隙間は無収入期間になる(税・社会保険料も 0)', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [
            workPeriod({ startAge: 30, endAge: 34 }),
            workPeriod({ startAge: 40, endAge: 64 }),
          ],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
      }),
    );
    const gapYear = result.find((y) => y.age === 37)!;
    expect(gapYear.income.grossSalary).toBe(0);
    expect(gapYear.income.net).toBe(0);
    expect(gapYear.tax.socialInsurance).toBe(0);

    // 期間再開後は再び収入がある。
    expect(result.find((y) => y.age === 40)!.income.grossSalary).toBeCloseTo(500, 6);
  });

  it('個人事業主期間は国保・国民年金で社会保険料が計算される(雇用保険は 0)', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [workPeriod({ workStyle: 'selfEmployed' })],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
      }),
    );
    const y = result[0]!;
    expect(y.income.grossSalary).toBeCloseTo(500, 6);
    expect(y.tax.pensionInsurance).toBeCloseTo(21.504, 6); // 国民年金 17,920 円 × 12
    expect(y.tax.healthInsurance).toBeGreaterThan(0); // 国民健康保険
    expect(y.tax.employmentInsurance).toBe(0); // 雇用保険なし
    expect(y.income.net).toBeGreaterThan(0);
    expect(y.income.net).toBeLessThan(y.income.grossSalary);
  });

  it('会社員→個人事業主の切替で社会保険の内訳が変わる', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [
            workPeriod({ startAge: 30, endAge: 39, workStyle: 'employee' }),
            workPeriod({ startAge: 40, endAge: 64, workStyle: 'selfEmployed' }),
          ],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
      }),
    );
    const employeeYear = result.find((y) => y.age === 39)!;
    const selfYear = result.find((y) => y.age === 40)!;

    // 会社員期間: 雇用保険あり・厚生年金(給与比例)。
    expect(employeeYear.tax.employmentInsurance).toBeGreaterThan(0);
    // 個人事業主期間: 雇用保険なし・国民年金(定額)。
    expect(selfYear.tax.employmentInsurance).toBe(0);
    expect(selfYear.tax.pensionInsurance).toBeCloseTo(21.504, 6);
  });

  it('退職金は最後の会社員期間の終了翌年に計上される', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [
            workPeriod({ startAge: 30, endAge: 39, workStyle: 'employee' }),
            workPeriod({ startAge: 40, endAge: 64, workStyle: 'selfEmployed' }),
          ],
          retirementBonus: 1000,
          pension: 0,
          other: 0,
        },
      }),
    );
    const bonusYear = result.find((y) => y.age === 40)!;
    expect(bonusYear.income.other).toBeGreaterThanOrEqual(1000);
    expect(bonusYear.events).toContain('退職金');
    expect(result.filter((y) => y.events.includes('退職金'))).toHaveLength(1);
  });

  it('会社員期間が無い場合は退職金を計上しない', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [workPeriod({ workStyle: 'selfEmployed' })],
          retirementBonus: 1000,
          pension: 0,
          other: 0,
        },
      }),
    );
    expect(result.some((y) => y.events.includes('退職金'))).toBe(false);
  });

  it('年金は全就労期間の終了翌年から受給する(個人事業主のみでも同様)', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 64, workStyle: 'selfEmployed' })],
          retirementBonus: 0,
          pension: 150,
          other: 0,
        },
      }),
    );
    expect(result.find((y) => y.age === 64)!.income.pension).toBe(0);
    expect(result.find((y) => y.age === 65)!.income.pension).toBeGreaterThan(0);
  });

  it('積立投資で投資資産が増え、運用益が計上される', () => {
    const result = runSimulation(
      baseInput({
        investment: {
          accounts: [
            {
              name: 'NISA',
              accountType: 'nisa',
              monthlyAmount: 5,
              annualReturn: 5.0,
              startAge: 30,
              endAge: 65,
            },
          ],
        },
      }),
    );
    // 初年度: 積立 60万 + 運用益。
    expect(result[0]!.income.investmentGain).toBeGreaterThan(0);
    expect(result[0]!.investmentValue).toBeGreaterThan(0);
    // 投資資産は増加していく。
    expect(result[10]!.investmentValue).toBeGreaterThan(result[0]!.investmentValue);
  });

  it('NISA上限を超える積立は投資されず預金に残り、上限到達年に注記される', () => {
    // 月40万(480万/年)を高収入で積立 → 年間上限360万を毎年超過し、いずれ生涯枠1800万に到達。
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 30, endAge: 90, savings: 0, investments: 0 },
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 64, income: 3000, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
        expense: { rent: 0, living: 0, insurance: 0, fixed: 0, inflationRate: 0 },
        investment: {
          accounts: [
            {
              name: 'NISA',
              accountType: 'nisa',
              monthlyAmount: 40,
              annualReturn: 0,
              startAge: 30,
              endAge: 90,
            },
          ],
        },
      }),
    );

    // 生涯枠1800万 ÷ 年間360万 = 5年で上限到達。以降は投資資産が増えない。
    const capReachedYear = result.find((y) => y.events.includes('NISA上限到達'));
    expect(capReachedYear).toBeDefined();

    // 上限到達後、投資評価額は1800万で頭打ち(利回り0のため)。
    const last = result[result.length - 1]!;
    expect(last.investmentValue).toBeCloseTo(1800, 6);

    // 積み立てられなかった分は預金に残るため、預金は投資評価額を大きく上回って積み上がる。
    expect(last.savings).toBeGreaterThan(last.investmentValue);
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
