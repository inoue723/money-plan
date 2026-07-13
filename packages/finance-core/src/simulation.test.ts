import { describe, expect, it } from 'vitest';

import { runSimulation } from './simulation';
import type { EducationPlan, ExpenseItem, LifeEvent, SimulationInput, WorkPeriod } from './types';

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

/** 支出項目を1つ生成する(既定は全期間 30〜90 歳の1期間)。 */
const expenseItem = (
  name: string,
  monthlyAmount: number,
  inflationRate = 0,
  startAge = 30,
  endAge = 90,
): ExpenseItem => ({
  name,
  inflationRate,
  periods: [{ startAge, endAge, monthlyAmount }],
});

/** 最小構成の入力を生成し、必要な部分だけ上書きする。 */
const baseInput = (overrides: Partial<SimulationInput> = {}): SimulationInput => ({
  basic: { currentAge: 30, endAge: 90, savings: 500 },
  family: { children: [] },
  income: {
    workPeriods: [workPeriod()],
    retirementBonus: 0,
    pension: 0,
    other: 0,
  },
  expense: {
    items: [
      expenseItem('家賃', 8, 1.0),
      expenseItem('生活費', 15, 1.0),
      expenseItem('保険料', 1),
      expenseItem('その他固定費', 2),
    ],
  },
  events: [],
  investment: {
    accounts: [
      {
        name: 'NISA',
        accountType: 'nisa',
        owner: 'self',
        initialHolding: 0,
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
      baseInput({ basic: { currentAge: 30, endAge: 90, savings: 500 } }),
    );
    expect(result).toHaveLength(90 - 30 + 1);
    expect(result[0]!.age).toBe(30);
    expect(result[result.length - 1]!.age).toBe(90);
    // 年は1年ずつ増える。
    expect(result[1]!.year - result[0]!.year).toBe(1);
  });

  it('endAge < currentAge のとき空配列を返す', () => {
    const result = runSimulation(baseInput({ basic: { currentAge: 70, endAge: 60, savings: 0 } }));
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
        basic: { currentAge: 30, endAge: 50, savings: 100 },
        income: {
          workPeriods: [workPeriod({ income: 300, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
        expense: {
          items: [
            expenseItem('家賃', 20, 1.0),
            expenseItem('生活費', 30, 1.0),
            expenseItem('保険料', 2),
            expenseItem('その他固定費', 3),
          ],
        },
      }),
    );
    expect(result.some((y) => y.totalAssets < 0)).toBe(true);
  });

  it('住宅購入でローン返済(loan)が計上され、頭金が一時支出に計上される(家賃項目は別管理)', () => {
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

    // 購入前はローン返済なし。購入年に頭金が一時支出に載る。
    expect(before.expense.loan).toBe(0);
    expect(buyYear.expense.events).toBeGreaterThanOrEqual(800);
    expect(buyYear.events).toContain('住宅購入');

    // 購入後はローン返済(loan)が計上される(#31: 家賃相当は支出項目側で別管理する方針)。
    expect(after.expense.loan).toBeGreaterThan(0);
    // ローン完済後(age 65: 35+30)はローン返済 0。
    const paidOff = result.find((y) => y.age === 65)!;
    expect(paidOff.expense.loan).toBeCloseTo(0, 6);
  });

  it('支出項目は年齢期間ごとに月額を切り替えられる(#31)', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          items: [
            {
              name: '生活費',
              inflationRate: 0,
              periods: [
                { startAge: 30, endAge: 44, monthlyAmount: 10 },
                { startAge: 45, endAge: 60, monthlyAmount: 15 },
              ],
            },
          ],
        },
      }),
    );
    // 物価上昇 0 なので月額 × 12 がそのまま年額になる。
    expect(result.find((y) => y.age === 40)!.expense.items[0]!.amount).toBeCloseTo(10 * 12, 6);
    expect(result.find((y) => y.age === 50)!.expense.items[0]!.amount).toBeCloseTo(15 * 12, 6);
    // 期間外(61歳〜)はどの期間にも該当せず 0。
    expect(result.find((y) => y.age === 70)!.expense.items[0]!.amount).toBe(0);
  });

  it('物価上昇率は項目ごとに(起点からの経過年数で)複利適用される(#31)', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          items: [
            expenseItem('据置き', 10, 0), // 上昇なし
            expenseItem('上昇', 10, 2.0), // 年 2%
          ],
        },
      }),
    );
    const y0 = result[0]!;
    // 起点(i=0)ではどちらも月額 × 12。
    expect(y0.expense.items[0]!.amount).toBeCloseTo(120, 6);
    expect(y0.expense.items[1]!.amount).toBeCloseTo(120, 6);
    // 10 年後: 据置きは不変、上昇は 2% 複利。
    const y10 = result.find((y) => y.age === 40)!;
    expect(y10.expense.items[0]!.amount).toBeCloseTo(120, 6);
    expect(y10.expense.items[1]!.amount).toBeCloseTo(120 * Math.pow(1.02, 10), 6);
  });

  it('複数の支出項目が合算され、内訳 items に入力と同順で並ぶ(#31)', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          items: [expenseItem('家賃', 8, 0), expenseItem('生活費', 15, 0)],
        },
      }),
    );
    const y = result[0]!;
    expect(y.expense.items.map((it) => it.name)).toEqual(['家賃', '生活費']);
    expect(y.expense.items[0]!.amount).toBeCloseTo(96, 6);
    expect(y.expense.items[1]!.amount).toBeCloseTo(180, 6);
    // 教育費・住宅ローン・イベントは支出項目とは別枠(子・イベント無しなので 0)。
    expect(y.expense.education).toBe(0);
    expect(y.expense.loan).toBe(0);
    expect(y.expense.events).toBe(0);
  });

  it('退職後は給与が0になり、年金へ切り替わる', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 60, endAge: 75, savings: 1000 },
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
              owner: 'self',
              initialHolding: 0,
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
    // 年間積立額(全枠合計)が結果に記録される(月5万 × 12 = 60万)。
    expect(result[0]!.investmentContribution).toBe(60);
    // 積立終了年齢(65)以降は積立額 0。
    expect(result.find((y) => y.age === 65)!.investmentContribution).toBe(0);
    // 投資資産は増加していく。
    expect(result[10]!.investmentValue).toBeGreaterThan(result[0]!.investmentValue);
  });

  it('投資枠の現在投資額(初期保有額)が初年度から評価額に乗る', () => {
    const result = runSimulation(
      baseInput({
        investment: {
          accounts: [
            {
              name: '特定口座',
              accountType: 'taxable',
              owner: 'self',
              initialHolding: 500,
              monthlyAmount: 0,
              annualReturn: 5.0,
              startAge: 30,
              endAge: 65,
            },
          ],
        },
      }),
    );
    // 初年度は初期保有 500 に利回り 5% が乗る(= 525)。
    expect(result[0]!.investmentValue).toBeCloseTo(525, 6);
    expect(result[0]!.income.investmentGain).toBeCloseTo(25, 6);
  });

  it('NISA上限を超える積立は投資されず預金に残り、上限到達年に注記される', () => {
    // 月40万(480万/年)を高収入で積立 → 年間上限360万を毎年超過し、いずれ生涯枠1800万に到達。
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 30, endAge: 90, savings: 0 },
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 64, income: 3000, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
        expense: { items: [] },
        investment: {
          accounts: [
            {
              name: 'NISA',
              accountType: 'nisa',
              owner: 'self',
              initialHolding: 0,
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

  // -------------------------------------------------------------------------
  // 家賃(#50): 専用型・更新料・住宅購入連動
  // -------------------------------------------------------------------------

  it('家賃(rent)が未設定なら expense.rent は undefined(内訳・CF表で非表示)', () => {
    const y = runSimulation(baseInput())[0]!;
    expect(y.expense.rent).toBeUndefined();
  });

  it('家賃の年額は月額 × 12 × 物価上昇係数で計上される', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          rent: { inflationRate: 2.0, periods: [{ startAge: 30, endAge: 90, monthlyAmount: 10 }] },
          items: [],
        },
      }),
    );
    // 起点(i=0)は月額 × 12。
    expect(result[0]!.expense.rent).toBeCloseTo(120, 6);
    // 10 年後は 2% 複利。
    expect(result.find((y) => y.age === 40)!.expense.rent).toBeCloseTo(120 * Math.pow(1.02, 10), 6);
  });

  it('家賃の期間外(どの期間にも該当しない年齢)は 0 計上', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          rent: { inflationRate: 0, periods: [{ startAge: 30, endAge: 40, monthlyAmount: 8 }] },
          items: [],
        },
      }),
    );
    expect(result.find((y) => y.age === 35)!.expense.rent).toBeCloseTo(96, 6);
    expect(result.find((y) => y.age === 50)!.expense.rent).toBe(0);
  });

  it('更新料は開始年齢を起点に周期年ごと(開始年は含めない)に月額×月数を加算する', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          rent: {
            inflationRate: 0, // 物価上昇なしで検証を単純化
            periods: [
              {
                startAge: 30,
                endAge: 90,
                monthlyAmount: 10,
                renewal: { cycleYears: 2, months: 1 },
              },
            ],
          },
          items: [],
        },
      }),
    );
    const rentAt = (age: number) => result.find((y) => y.age === age)!.expense.rent!;
    // 開始年(30)は更新料なし。
    expect(rentAt(30)).toBeCloseTo(120, 6);
    // 開始+1(31)は更新年でない。
    expect(rentAt(31)).toBeCloseTo(120, 6);
    // 開始+2(32)は更新年 → 年額 + 月額 × 1ヶ月。
    expect(rentAt(32)).toBeCloseTo(120 + 10, 6);
    // 開始+4(34)も更新年。
    expect(rentAt(34)).toBeCloseTo(120 + 10, 6);
  });

  it('更新料は「当年の月額(物価上昇適用後)× 月数」で計上される', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          rent: {
            inflationRate: 3.0,
            periods: [
              {
                startAge: 30,
                endAge: 90,
                monthlyAmount: 10,
                renewal: { cycleYears: 2, months: 1 },
              },
            ],
          },
          items: [],
        },
      }),
    );
    // 32歳(i=2)の月額 = 10 × 1.03^2。年額 + 更新料(= 当年月額 × 1ヶ月)。
    const monthly = 10 * Math.pow(1.03, 2);
    expect(result.find((y) => y.age === 32)!.expense.rent).toBeCloseTo(monthly * 12 + monthly, 6);
  });

  it('期間が変わると更新料の起点は各期間の開始年齢にリセットされる', () => {
    const result = runSimulation(
      baseInput({
        expense: {
          rent: {
            inflationRate: 0,
            periods: [
              {
                startAge: 30,
                endAge: 34,
                monthlyAmount: 10,
                renewal: { cycleYears: 2, months: 1 },
              },
              {
                startAge: 35,
                endAge: 90,
                monthlyAmount: 20,
                renewal: { cycleYears: 2, months: 1 },
              },
            ],
          },
          items: [],
        },
      }),
    );
    const rentAt = (age: number) => result.find((y) => y.age === age)!.expense.rent!;
    // 第2期間の開始年(35)は更新料なし。
    expect(rentAt(35)).toBeCloseTo(240, 6);
    // 第2期間の開始+2(37)が更新年(35を起点にリセット)。
    expect(rentAt(37)).toBeCloseTo(240 + 20, 6);
    // 第2期間の開始+1(36)は更新年でない。
    expect(rentAt(36)).toBeCloseTo(240, 6);
  });

  it('住宅購入年以降は家賃が自動で 0 になる', () => {
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
    const result = runSimulation(
      baseInput({
        events,
        expense: {
          rent: { inflationRate: 0, periods: [{ startAge: 30, endAge: 90, monthlyAmount: 10 }] },
          items: [],
        },
      }),
    );
    // 購入前は家賃あり。
    expect(result.find((y) => y.age === 34)!.expense.rent).toBeCloseTo(120, 6);
    // 購入年以降は 0(ローン返済側で計上され二重計上を回避)。
    expect(result.find((y) => y.age === 35)!.expense.rent).toBe(0);
    expect(result.find((y) => y.age === 40)!.expense.rent).toBe(0);
    expect(result.find((y) => y.age === 40)!.expense.loan).toBeGreaterThan(0);
  });

  it('家賃と更新料は支出合計(balance)に反映される', () => {
    const withRenewal = runSimulation(
      baseInput({
        expense: {
          rent: {
            inflationRate: 0,
            periods: [
              {
                startAge: 30,
                endAge: 90,
                monthlyAmount: 10,
                renewal: { cycleYears: 2, months: 1 },
              },
            ],
          },
          items: [],
        },
      }),
    );
    const noRenewal = runSimulation(
      baseInput({
        expense: {
          rent: { inflationRate: 0, periods: [{ startAge: 30, endAge: 90, monthlyAmount: 10 }] },
          items: [],
        },
      }),
    );
    // 更新年(32歳)は更新料分だけ収支が悪化する。
    const a = withRenewal.find((y) => y.age === 32)!;
    const b = noRenewal.find((y) => y.age === 32)!;
    expect(b.balance - a.balance).toBeCloseTo(10, 6);
  });

  it('通常入力(約72年分)を高速に計算できる', () => {
    const input = baseInput({
      basic: { currentAge: 18, endAge: 90, savings: 300 },
    });
    const t0 = Date.now();
    const result = runSimulation(input);
    const elapsed = Date.now() - t0;
    expect(result).toHaveLength(90 - 18 + 1);
    expect(elapsed).toBeLessThan(50); // 十分高速(参考値)
  });
});
