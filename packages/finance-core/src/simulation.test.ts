import { describe, expect, it } from 'vitest';

import { CAPITAL_GAINS_TAX_RATE } from './constants';
import { renderFormula, type CalcNode } from './explain';
import { runSimulation } from './simulation';
import { calcRetirementTax } from './tax';
import type {
  EducationPlan,
  ExpenseItem,
  InvestmentAccount,
  LifeEvent,
  SimulationInput,
  WorkPeriod,
  YearlyResult,
} from './types';

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

/** 計算根拠ノードの式(formula)からノード参照の項だけを取り出す(テスト用)。 */
const detailTermNodes = (node: CalcNode): CalcNode[] =>
  (node.formula ?? [])
    .filter((p): p is { op?: string; node: CalcNode } => typeof p !== 'string')
    .map((p) => p.node);

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
        annualReturn: 3.0,
        contributions: [{ type: 'monthly', startAge: 30, endAge: 64, monthlyAmount: 0 }],
        withdrawals: [],
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

    // 退職年に退職金(手取り)がその他収入へ計上される。勤続5年・退職金2000万は
    // 退職所得控除200万を大きく超えるため分離課税され、手取りは額面2000万を下回る(#19)。
    expect(retireYear.income.other).toBeGreaterThan(1500);
    expect(retireYear.income.other).toBeLessThan(2000);
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
    // 会社員期間30〜39(勤続10年)・退職金1000万は退職所得控除400万を超えるため課税され、
    // 手取りは額面1000万を下回る(#19)。会社員期間が無い個人事業主期間は勤続に数えない。
    expect(bonusYear.income.other).toBeGreaterThan(900);
    expect(bonusYear.income.other).toBeLessThan(1000);
    expect(bonusYear.events).toContain('退職金');
    expect(result.filter((y) => y.events.includes('退職金'))).toHaveLength(1);
  });

  it('退職金の年はその他収入の計算根拠(details.otherIncome)が付き、他の年には付かない', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 39 })],
          retirementBonus: 1000,
          pension: 0,
          other: 0,
        },
      }),
    );
    const bonusYear = result.find((y) => y.events.includes('退職金'))!;
    const detail = bonusYear.details?.otherIncome;
    expect(detail).toBeDefined();
    // 根の値はCF表の「その他収入」セルの値と一致する。
    expect(detail!.value).toBeCloseTo(bonusYear.income.other, 6);
    const termLabels = detailTermNodes(detail!).map((n) => n.label);
    expect(termLabels).toEqual(['退職金(本人・手取り)', '退職金以外のその他収入']);
    // その他収入が退職金のみの年は、残余の項を hidden にしてノイズを避ける。
    expect(detailTermNodes(detail!)[1]!.hidden).toBe(true);
    // 根拠が無い年には details プロパティ自体を付けない。
    const otherYear = result.find((y) => !y.events.includes('退職金'))!;
    expect(otherYear.details).toBeUndefined();
  });

  it('本人・配偶者が同年に退職すると、その他収入の根拠に両者の退職金の項が並ぶ', () => {
    const result = runSimulation(
      baseInput({
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 60 })],
          retirementBonus: 1000,
          pension: 0,
          other: 0,
        },
        family: {
          children: [],
          spouse: {
            age: 30,
            income: {
              workPeriods: [workPeriod({ startAge: 30, endAge: 60, income: 400, raiseRate: 0 })],
              retirementBonus: 500,
              pension: 0,
              other: 0,
            },
          },
        },
      }),
    );
    // 両者とも60歳まで勤務 → 61歳(同年)に退職金を計上する。
    const bonusYear = result.find((y) => y.age === 61)!;
    expect(bonusYear.events).toContain('退職金');
    expect(bonusYear.events).toContain('配偶者退職金');
    const detail = bonusYear.details?.otherIncome;
    expect(detail).toBeDefined();
    expect(detail!.value).toBeCloseTo(bonusYear.income.other, 6);
    const termLabels = detailTermNodes(detail!).map((n) => n.label);
    expect(termLabels).toEqual([
      '退職金(本人・手取り)',
      '退職金(配偶者・手取り)',
      '退職金以外のその他収入',
    ]);
    // 各退職金の項は手取り退職金を根とする根拠ツリー(額面 − 所得税 − 住民税)を持つ。
    const selfTerm = detailTermNodes(detail!)[0]!;
    expect(renderFormula(selfTerm)).toContain('退職金 額面');
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

  it('年金は受給開始年齢の既定(65歳)から受給する(個人事業主のみでも同様。#18)', () => {
    const result = runSimulation(
      baseInput({
        income: {
          // pensionStartAge 未設定 → 既定 65 歳。
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

  it('退職後〜受給開始の空白期間は年金・給与ともに0になる(#18)', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 55, endAge: 90, savings: 2000 },
        income: {
          // 60歳で退職、年金は70歳から受給(繰下げ相当の空白期間)。
          workPeriods: [workPeriod({ startAge: 55, endAge: 60, income: 600, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 200,
          pensionStartAge: 70,
          other: 0,
        },
      }),
    );
    // 就労中(60歳)は給与あり・年金なし。
    const working = result.find((y) => y.age === 60)!;
    expect(working.income.grossSalary).toBeGreaterThan(0);
    expect(working.income.pension).toBe(0);
    // 空白期間(61〜69歳)は給与も年金も0。
    for (let age = 61; age <= 69; age++) {
      const y = result.find((r) => r.age === age)!;
      expect(y.income.grossSalary).toBe(0);
      expect(y.income.pension).toBe(0);
    }
    // 受給開始年齢(70歳)から年金を受給する。
    expect(result.find((y) => y.age === 70)!.income.pension).toBeCloseTo(200, 6);
  });

  it('年金額を自動計算(pensionAutoEstimate)すると手動値を無視し就労履歴から推定する(#21)', () => {
    const manual = 1; // 手動値はごく小さくしておく
    const withAuto = runSimulation(
      baseInput({
        basic: { currentAge: 30, endAge: 90, savings: 500 },
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 64, income: 500, raiseRate: 1.0 })],
          retirementBonus: 0,
          pension: manual,
          pensionAutoEstimate: true,
          other: 0,
        },
      }),
    );
    const at70 = withAuto.find((y) => y.age === 70)!;
    // 手動値(1万円)ではなく、就労履歴からの推定額(基礎+厚生で数百万規模)が計上される。
    expect(at70.income.pension).toBeGreaterThan(manual);
    expect(at70.income.pension).toBeGreaterThan(100);
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
              annualReturn: 5.0,
              contributions: [{ type: 'monthly', startAge: 30, endAge: 64, monthlyAmount: 5 }],
              withdrawals: [],
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
              annualReturn: 5.0,
              contributions: [{ type: 'monthly', startAge: 30, endAge: 64, monthlyAmount: 0 }],
              withdrawals: [],
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
              annualReturn: 0,
              contributions: [{ type: 'monthly', startAge: 30, endAge: 89, monthlyAmount: 40 }],
              withdrawals: [],
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

describe('runSimulation - 配偶者の収入(#49)', () => {
  it('配偶者の会社員収入が spouseSalary に反映され、手取り(net)が本人+配偶者で増える', () => {
    const withoutSpouse = runSimulation(baseInput())[0]!;
    const withSpouse = runSimulation(
      baseInput({
        family: {
          children: [],
          spouse: {
            age: 30,
            income: {
              workPeriods: [workPeriod({ startAge: 30, endAge: 64, income: 400, raiseRate: 0 })],
              retirementBonus: 0,
              pension: 0,
              other: 0,
            },
          },
        },
      }),
    )[0]!;

    expect(withoutSpouse.income.spouseSalary).toBe(0);
    expect(withSpouse.income.spouseSalary).toBeCloseTo(400, 6);
    // 配偶者の手取りが加算され、net が増える。
    expect(withSpouse.income.net).toBeGreaterThan(withoutSpouse.income.net);
    // 配偶者の額面(400)より手取り増分は小さい(税・社会保険料が引かれる)。
    expect(withSpouse.income.net - withoutSpouse.income.net).toBeLessThan(400);
  });

  it('配偶者の昇給率が配偶者年齢基準で複利適用される', () => {
    const result = runSimulation(
      baseInput({
        income: { workPeriods: [], retirementBonus: 0, pension: 0, other: 0 }, // 本人は無収入にして配偶者だけ見る
        family: {
          children: [],
          spouse: {
            age: 40,
            income: {
              workPeriods: [workPeriod({ startAge: 40, endAge: 60, income: 300, raiseRate: 5 })],
              retirementBonus: 0,
              pension: 0,
              other: 0,
            },
          },
        },
      }),
    );
    // 本人30歳・配偶者40歳スタート。本人34歳(=配偶者44歳)時点で 300 * 1.05^4。
    const y = result.find((r) => r.age === 34)!;
    expect(y.income.spouseSalary).toBeCloseTo(300 * Math.pow(1.05, 4), 6);
  });

  it('配偶者の退職金が最後の会社員期間の終了翌年に「配偶者退職金」として計上される', () => {
    const result = runSimulation(
      baseInput({
        income: { workPeriods: [], retirementBonus: 0, pension: 0, other: 0 },
        family: {
          children: [],
          spouse: {
            age: 30,
            income: {
              workPeriods: [workPeriod({ startAge: 30, endAge: 60, income: 400, raiseRate: 0 })],
              retirementBonus: 1000,
              pension: 0,
              other: 0,
            },
          },
        },
      }),
    );
    // 配偶者60歳(=本人60歳)まで勤務→翌年61歳で退職金計上。
    const bonusYear = result.find((r) => r.age === 61)!;
    expect(bonusYear.events).toContain('配偶者退職金');
    expect(bonusYear.income.other).toBeGreaterThanOrEqual(1000);
  });

  it('配偶者控除は配偶者の当年額面収入が103万円超のとき付かず、世帯の税が増える', () => {
    // 配偶者の額面だけを 103万(控除あり)/ 104万(控除なし)で切り替え、他は同一にする。
    const inputWithSpouseIncome = (spouseIncome: number): SimulationInput =>
      baseInput({
        income: {
          workPeriods: [workPeriod({ startAge: 30, endAge: 64, income: 600, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
        family: {
          children: [],
          spouse: {
            age: 30,
            income: {
              workPeriods: [
                workPeriod({ startAge: 30, endAge: 64, income: spouseIncome, raiseRate: 0 }),
              ],
              retirementBonus: 0,
              pension: 0,
              other: 0,
            },
          },
        },
      });

    const withDeduction = runSimulation(inputWithSpouseIncome(103))[0]!; // <=103: 配偶者控除あり
    const withoutDeduction = runSimulation(inputWithSpouseIncome(104))[0]!; // >103: 配偶者控除なし

    const totalTax = (r: typeof withDeduction) => r.tax.incomeTax + r.tax.residentTax;
    // 配偶者控除が外れる分だけ本人の課税所得が増え、世帯の所得税+住民税合計が大きくなる。
    expect(totalTax(withoutDeduction)).toBeGreaterThan(totalTax(withDeduction));
  });

  it('配偶者の年金が配偶者の受給開始年齢(pensionStartAge)から受給される(#18)', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 30, endAge: 90, savings: 500 },
        income: { workPeriods: [], retirementBonus: 0, pension: 0, other: 0 },
        family: {
          children: [],
          spouse: {
            age: 30,
            income: {
              workPeriods: [workPeriod({ startAge: 30, endAge: 60, income: 400, raiseRate: 0 })],
              retirementBonus: 0,
              pension: 200,
              pensionStartAge: 63, // 退職(60歳)とは独立に 63 歳から受給
              other: 0,
            },
          },
        },
      }),
    );
    // 配偶者は60歳まで就労→退職〜受給開始(63歳)の空白期間は年金0、63歳で受給開始。
    expect(result.find((r) => r.age === 60)!.income.pension).toBe(0);
    expect(result.find((r) => r.age === 62)!.income.pension).toBe(0); // 空白期間
    expect(result.find((r) => r.age === 63)!.income.pension).toBeGreaterThan(0);
  });
});

describe('runSimulation - 年金の額面計上と収支恒等式(#79)', () => {
  // 収入合計(額面)。apps/web の yearColumns.ts の totalIncome と同義。
  const totalIncome = (r: YearlyResult): number =>
    r.income.grossSalary +
    r.income.spouseSalary +
    r.income.pension +
    r.income.childAllowance +
    r.income.other;

  // 支出合計(税・社会保険込み)。yearColumns.ts の totalExpenseWithTax と同義。
  const totalExpenseWithTax = (r: YearlyResult): number => {
    const e = r.expense;
    const items = e.items.reduce((s, it) => s + it.amount, 0);
    const base = (e.rent ?? 0) + items + e.education + e.loan + e.events;
    return base + r.tax.incomeTax + r.tax.residentTax + r.tax.socialInsurance;
  };

  // #79 リグレッション: 年金分の税の二重計上が無ければ、全年で
  // 収入合計 − (支出合計 + 所得税 + 住民税 + 社会保険料) − 年間積立額 = 年間収支 が成立する。
  const expectIdentity = (result: YearlyResult[]): void => {
    for (const y of result) {
      expect(totalIncome(y) - totalExpenseWithTax(y) - y.investmentContribution).toBeCloseTo(
        y.balance,
        6,
      );
    }
  };

  it('年金が課税水準(500万)でも全年で 収入合計 − 支出合計 − 年間積立額 = 年間収支 が成立する', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 60, endAge: 90, savings: 1000 },
        income: {
          workPeriods: [workPeriod({ startAge: 60, endAge: 64, income: 700, raiseRate: 0 })],
          retirementBonus: 2000,
          pension: 500,
          other: 0,
        },
        investment: {
          accounts: [
            {
              name: 'NISA',
              accountType: 'nisa',
              owner: 'self',
              initialHolding: 0,
              annualReturn: 3.0,
              contributions: [{ type: 'monthly', startAge: 60, endAge: 63, monthlyAmount: 3 }],
              withdrawals: [],
            },
          ],
        },
      }),
    );

    // 受給年は年金が額面(500万)で計上され、年金分の税が発生する水準であること
    // (この二重計上バグを踏む前提の確認)。
    const pensionYear = result.find((y) => y.age === 70)!;
    expect(pensionYear.income.pension).toBeCloseTo(500, 6);
    expect(pensionYear.tax.incomeTax + pensionYear.tax.residentTax).toBeGreaterThan(0);

    expectIdentity(result);
  });

  it('年金が非課税水準(150万)のデフォルト相当入力でも恒等式が成立する', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 60, endAge: 90, savings: 1000 },
        income: {
          workPeriods: [workPeriod({ startAge: 60, endAge: 64, income: 600, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 150,
          other: 0,
        },
      }),
    );

    // 非課税水準では年金分の所得税・住民税は 0。
    const pensionYear = result.find((y) => y.age === 70)!;
    expect(pensionYear.income.pension).toBeCloseTo(150, 6);

    expectIdentity(result);
  });

  it('本人・配偶者ともに課税水準の年金でも恒等式が成立する', () => {
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 60, endAge: 90, savings: 1500 },
        income: {
          workPeriods: [workPeriod({ startAge: 60, endAge: 64, income: 700, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 500,
          other: 0,
        },
        family: {
          children: [],
          spouse: {
            age: 60,
            income: {
              workPeriods: [workPeriod({ startAge: 60, endAge: 64, income: 500, raiseRate: 0 })],
              retirementBonus: 0,
              pension: 450,
              other: 0,
            },
          },
        },
      }),
    );

    // 本人・配偶者の年金が同一年に額面で計上される(合算 = 950)。
    const pensionYear = result.find((y) => y.age === 70)!;
    expect(pensionYear.income.pension).toBeCloseTo(950, 6);
    expect(pensionYear.tax.incomeTax + pensionYear.tax.residentTax).toBeGreaterThan(0);

    expectIdentity(result);
  });
});

describe('runSimulation - 計算開始年月と初年の月割(#51)', () => {
  /** 月割検証用の最小入力。物価上昇・昇給なしで金額を安定させ、初年/2年目を比較する。 */
  const monthlyBase = (overrides: Partial<SimulationInput> = {}): SimulationInput =>
    baseInput({
      basic: { currentAge: 30, endAge: 31, savings: 0 },
      income: {
        workPeriods: [workPeriod({ startAge: 30, endAge: 65, income: 600, raiseRate: 0 })],
        retirementBonus: 0,
        pension: 0,
        other: 120,
      },
      expense: { items: [expenseItem('生活費', 10, 0)] },
      investment: { accounts: [] },
      ...overrides,
    });

  it('計算開始年(startYear)が CF 表の先頭年になる', () => {
    const result = runSimulation(
      monthlyBase({
        basic: { currentAge: 30, endAge: 31, savings: 0, startYear: 2030, startMonth: 4 },
      }),
    );
    expect(result[0]!.year).toBe(2030);
    expect(result[1]!.year).toBe(2031);
    // 年齢の起点は currentAge のまま(開始年を変えても変わらない)。
    expect(result[0]!.age).toBe(30);
  });

  it('7月開始なら初年の経常収支を 6/12 で按分し、2年目はフル12ヶ月', () => {
    const result = runSimulation(
      monthlyBase({ basic: { currentAge: 30, endAge: 31, savings: 0, startMonth: 7 } }),
    );
    const y0 = result[0]!;
    const y1 = result[1]!;
    // 額面(600)・固定その他(120)・生活費(月10=年120)を初年は半分に。
    expect(y0.income.grossSalary).toBeCloseTo(300);
    expect(y0.income.other).toBeCloseTo(60);
    expect(y0.expense.items[0]!.amount).toBeCloseTo(60);
    // 手取り・税も按分される(税>0 かつ初年は2年目の半分)。
    expect(y0.income.net).toBeCloseTo(y1.income.net / 2);
    expect(y0.tax.socialInsurance).toBeCloseTo(y1.tax.socialInsurance / 2);
    // 2年目はフル。
    expect(y1.income.grossSalary).toBeCloseTo(600);
    expect(y1.income.other).toBeCloseTo(120);
    expect(y1.expense.items[0]!.amount).toBeCloseTo(120);
  });

  it('開始月未設定なら従来どおり初年もフル12ヶ月(月割なし)', () => {
    const result = runSimulation(monthlyBase());
    const y0 = result[0]!;
    expect(y0.income.grossSalary).toBeCloseTo(600);
    expect(y0.income.other).toBeCloseTo(120);
    expect(y0.expense.items[0]!.amount).toBeCloseTo(120);
  });

  it('1月開始(startMonth=1)は月割なしと同じ(フル12ヶ月)', () => {
    const withJan = runSimulation(
      monthlyBase({ basic: { currentAge: 30, endAge: 31, savings: 0, startMonth: 1 } }),
    );
    const without = runSimulation(monthlyBase());
    expect(withJan[0]!.income.grossSalary).toBeCloseTo(without[0]!.income.grossSalary);
    expect(withJan[0]!.expense.items[0]!.amount).toBeCloseTo(without[0]!.expense.items[0]!.amount);
  });

  it('一時収入(ライフイベント)は初年でも按分せず全額計上する', () => {
    const result = runSimulation(
      monthlyBase({
        basic: { currentAge: 30, endAge: 31, savings: 0, startMonth: 7 },
        events: [{ type: 'oneTimeIncome', age: 30, name: '贈与', amount: 100 }],
      }),
    );
    const y0 = result[0]!;
    // 固定その他(120)は按分で60、一時収入100は全額 → other = 160。
    expect(y0.income.other).toBeCloseTo(160);
  });

  it('住宅購入の頭金は一時支出として按分せず、ローン返済は経常支出として按分する', () => {
    const result = runSimulation(
      monthlyBase({
        basic: { currentAge: 30, endAge: 31, savings: 0, startMonth: 7 },
        events: [
          {
            type: 'homePurchase',
            age: 30,
            price: 3000,
            downPayment: 500,
            loanInterestRate: 0,
            loanTermYears: 10,
          },
        ],
      }),
    );
    const y0 = result[0]!;
    const y1 = result[1]!;
    // 頭金は全額(按分しない)。
    expect(y0.expense.events).toBeCloseTo(500);
    // ローン返済は初年のみ半分(金利0なので年 (3000-500)/10 = 250 → 初年 125)。
    expect(y0.expense.loan).toBeCloseTo(125);
    expect(y1.expense.loan).toBeCloseTo(250);
  });

  it('積立額と運用益も初年は月割で按分する', () => {
    const result = runSimulation(
      monthlyBase({
        basic: { currentAge: 30, endAge: 31, savings: 0, startMonth: 7 },
        investment: {
          accounts: [
            {
              name: 'NISA',
              accountType: 'nisa',
              owner: 'self',
              initialHolding: 0,
              annualReturn: 10,
              // 年 60(月 5 万)。両端含む: 30〜64 歳。
              contributions: [{ type: 'monthly', startAge: 30, endAge: 64, monthlyAmount: 5 }],
              withdrawals: [],
            },
          ],
        },
      }),
    );
    const y0 = result[0]!;
    const y1 = result[1]!;
    // 初年: 積立 60×0.5=30、運用益 (0+30)×0.10×0.5=1.5。
    expect(y0.investmentContribution).toBeCloseTo(30);
    expect(y0.investmentGain).toBeCloseTo(1.5);
    // 2年目: 積立 60、運用益 (31.5+60)×0.10=9.15。
    expect(y1.investmentContribution).toBeCloseTo(60);
    expect(y1.investmentGain).toBeCloseTo(9.15);
  });

  it('児童手当も初年は月割で按分する', () => {
    const result = runSimulation(
      monthlyBase({
        basic: { currentAge: 30, endAge: 31, savings: 0, startMonth: 7 },
        family: { children: [{ bornAtParentAge: 30, education: publicPlan }] },
      }),
    );
    const y0 = result[0]!;
    const y1 = result[1]!;
    expect(y0.income.childAllowance).toBeGreaterThan(0);
    expect(y0.income.childAllowance).toBeCloseTo(y1.income.childAllowance / 2);
  });
});

describe('runSimulation - iDeCo・小規模企業共済(#73)', () => {
  /**
   * 投資枠を1つ作る(必要な項目だけ上書き)。旧来の記述を簡潔に保つため、`monthlyAmount` /
   * `startAge` / `endAge` を渡すと「両端を含む月額積立 1 件」に変換する(旧仕様の終了年齢「未満」を
   * 保つため endAge を 1 引く)。`contributions` を明示した場合はそれを優先する。
   */
  const account = (
    overrides: Partial<InvestmentAccount> & {
      monthlyAmount?: number;
      startAge?: number;
      endAge?: number;
    } = {},
  ): InvestmentAccount => {
    const { monthlyAmount = 0, startAge = 30, endAge = 65, contributions, ...rest } = overrides;
    return {
      name: 'x',
      accountType: 'ideco',
      owner: 'self',
      initialHolding: 0,
      annualReturn: 0,
      contributions: contributions ?? [
        { type: 'monthly', startAge, endAge: endAge - 1, monthlyAmount },
      ],
      withdrawals: [],
      ...rest,
    };
  };

  it('拠出すると本人の所得税・住民税が下がる(小規模企業共済等掛金控除)', () => {
    // 同じ拠出額(月2万=年24万)を NISA と iDeCo で比較する。iDeCo は拠出が全額所得控除になる。
    const nisa = runSimulation(
      baseInput({
        investment: { accounts: [account({ accountType: 'nisa', monthlyAmount: 2 })] },
      }),
    )[0]!;
    const ideco = runSimulation(
      baseInput({
        investment: { accounts: [account({ accountType: 'ideco', monthlyAmount: 2 })] },
      }),
    )[0]!;

    // 完了条件: iDeCo 拠出で所得税・住民税が下がる。
    expect(ideco.tax.incomeTax).toBeLessThan(nisa.tax.incomeTax);
    expect(ideco.tax.residentTax).toBeLessThan(nisa.tax.residentTax);
    // 住民税は控除額 24 万 × 所得割 10% = 2.4 万だけ下がる(課税所得が控除後も正)。
    expect(nisa.tax.residentTax - ideco.tax.residentTax).toBeCloseTo(2.4, 6);
    // 拠出額は同じで税が軽い分、手取りが増え預金も多い。
    expect(ideco.savings).toBeGreaterThan(nisa.savings);
  });

  it('小規模企業共済も拠出が所得控除になる(iDeCo と同じ税制)', () => {
    const nisa = runSimulation(
      baseInput({
        investment: { accounts: [account({ accountType: 'nisa', monthlyAmount: 3 })] },
      }),
    )[0]!;
    const mutualAid = runSimulation(
      baseInput({
        investment: { accounts: [account({ accountType: 'mutualAid', monthlyAmount: 3 })] },
      }),
    )[0]!;
    expect(mutualAid.tax.incomeTax).toBeLessThan(nisa.tax.incomeTax);
    expect(mutualAid.tax.residentTax).toBeLessThan(nisa.tax.residentTax);
  });

  it('一括取崩は退職所得課税され、税引後額が預金に入る', () => {
    // 無収入・無支出で、iDeCo の初期保有 3000 万を 65 歳に一括受取する。
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 30, endAge: 66, savings: 0 },
        income: { workPeriods: [], retirementBonus: 0, pension: 0, other: 0 },
        expense: { items: [] },
        investment: {
          accounts: [
            account({
              accountType: 'ideco',
              initialHolding: 3000,
              acquisitionCost: 3000,
              startAge: 60,
              endAge: 65,
              withdrawals: [{ type: 'lumpSum', age: 65, amount: 3000 }],
            }),
          ],
        },
      }),
    );
    const before = result.find((r) => r.age === 64)!;
    const at = result.find((r) => r.age === 65)!;

    // 受取前は無収入・無支出のため預金 0、投資資産 3000。
    expect(before.savings).toBeCloseTo(0, 6);
    expect(before.investmentValue).toBeCloseTo(3000, 6);

    // 勤続年数 = 受取65 − 積立開始60 = 5年 → 退職所得控除で簡易課税された税引後額が預金に入る。
    const expected = calcRetirementTax({ retirementBonus: 3000, yearsOfService: 5 });
    expect(at.savings).toBeCloseTo(expected.netRetirementBonus, 4);
    expect(at.investmentValue).toBeCloseTo(0, 6);
    // 課税されている(税引後 < 額面)。
    expect(at.savings).toBeLessThan(3000);
  });

  it('分割取崩は年金収入と合算して課税される(NISA の分割取崩より手取りが少ない)', () => {
    const common: Partial<SimulationInput> = {
      basic: { currentAge: 60, endAge: 90, savings: 0 },
      income: {
        workPeriods: [workPeriod({ startAge: 60, endAge: 64 })],
        retirementBonus: 0,
        pension: 300, // 年金 300 万(合算で課税水準になる)
        other: 0,
      },
      expense: { items: [] },
    };
    const withdrawals: InvestmentAccount['withdrawals'] = [
      { type: 'spread', startAge: 66, endAge: 85 },
    ];
    const accountFields = {
      initialHolding: 2000,
      acquisitionCost: 2000,
      startAge: 60,
      endAge: 65,
      withdrawals,
    };

    const ideco = runSimulation(
      baseInput({
        ...common,
        investment: { accounts: [account({ accountType: 'ideco', ...accountFields })] },
      }),
    );
    const nisa = runSimulation(
      baseInput({
        ...common,
        investment: { accounts: [account({ accountType: 'nisa', ...accountFields })] },
      }),
    );

    const idecoAt = ideco.find((r) => r.age === 70)!;
    const nisaAt = nisa.find((r) => r.age === 70)!;

    // 取崩の運用は同一(利回り0・拠出0・初期額同じ)なので投資評価額は一致する。
    expect(idecoAt.investmentValue).toBeCloseTo(nisaAt.investmentValue, 6);
    // iDeCo の分割取崩は年金合算課税されるぶん、NISA(非課税)より預金が少ない。
    expect(idecoAt.savings).toBeLessThan(nisaAt.savings);
  });

  it('iDeCo は NISA の生涯・年間投資枠を消費しない(NISA 枠は満額使える)', () => {
    // iDeCo で年 480 万(NISA 年間枠超)を拠出しても、別の NISA 枠は満額積み立てられる。
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 30, endAge: 31, savings: 10000 },
        income: {
          workPeriods: [workPeriod({ income: 2000, raiseRate: 0 })],
          retirementBonus: 0,
          pension: 0,
          other: 0,
        },
        investment: {
          accounts: [
            account({ accountType: 'ideco', monthlyAmount: 40 }), // 年 480 万
            account({ name: 'NISA', accountType: 'nisa', monthlyAmount: 30 }), // 年 360 万(年間枠上限)
          ],
        },
      }),
    );
    const y0 = result[0]!;
    // iDeCo 480 + NISA 360 = 840 万を満額積み立てる(NISA 上限に iDeCo は影響しない)。
    expect(y0.investmentContribution).toBeCloseTo(840, 6);
    // NISA 上限到達の注記も出ない。
    expect(y0.events).not.toContain('NISA上限到達');
  });
});

describe('runSimulation - 投資取崩額の年次計上', () => {
  /** 無収入・無支出で投資枠だけを持つ入力(取崩額と預金の関係だけを見る)。 */
  const withdrawalOnlyInput = (accounts: InvestmentAccount[]): SimulationInput =>
    baseInput({
      basic: { currentAge: 60, endAge: 70, savings: 0 },
      income: { workPeriods: [], retirementBonus: 0, pension: 0, other: 0 },
      expense: { items: [] },
      investment: { accounts },
    });

  /**
   * 取崩の検証用に、利回り・拠出なしの枠を作る(必要な項目だけ上書き)。
   * 積立額 0 の月額積立を 60 歳に置き、実際の拠出は 0 にしつつ積立開始年齢 60 歳を持たせる
   * (iDeCo・小規模企業共済の一時金の勤続年数 = 受取年齢 − 積立開始年齢 の算定に使う)。
   */
  const account = (overrides: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
    name: 'x',
    accountType: 'nisa',
    owner: 'self',
    initialHolding: 1000,
    annualReturn: 0,
    contributions: [{ type: 'monthly', startAge: 60, endAge: 60, monthlyAmount: 0 }],
    withdrawals: [],
    ...overrides,
  });

  it('取り崩し設定が無ければ全年 0(取崩額・取崩時課税とも)', () => {
    const result = runSimulation(withdrawalOnlyInput([account()]));
    expect(result.every((r) => r.investmentWithdrawal === 0)).toBe(true);
    expect(result.every((r) => r.investmentWithdrawalTax === 0)).toBe(true);
  });

  it('NISA の一括取崩は税引前額がそのまま計上され、取崩時課税は 0', () => {
    const result = runSimulation(
      withdrawalOnlyInput([
        account({ accountType: 'nisa', withdrawals: [{ type: 'lumpSum', age: 65, amount: 300 }] }),
      ]),
    );
    const at = result.find((r) => r.age === 65)!;
    expect(at.investmentWithdrawal).toBeCloseTo(300, 6);
    // NISA は運用益非課税のため取崩時課税は発生しない。
    expect(at.investmentWithdrawalTax).toBeCloseTo(0, 6);
    // 非課税なので取崩額が全額そのまま預金に入る。
    expect(at.savings).toBeCloseTo(300, 6);
    // 取崩年以外は 0。
    expect(result.find((r) => r.age === 64)!.investmentWithdrawal).toBe(0);
  });

  it('課税口座の一括取崩は含み益ぶんに課税され、取崩時課税に計上される', () => {
    // 時価 1000・取得価額 400 → 含み益 600(評価益割合 60%)。300 を取り崩す。
    const result = runSimulation(
      withdrawalOnlyInput([
        account({
          accountType: 'taxable',
          initialHolding: 1000,
          acquisitionCost: 400,
          withdrawals: [{ type: 'lumpSum', age: 65, amount: 300 }],
        }),
      ]),
    );
    const at = result.find((r) => r.age === 65)!;
    expect(at.investmentWithdrawal).toBeCloseTo(300, 6);
    // 課税対象益 = 300 × 60% = 180、税 = 180 × 20.315%。
    expect(at.investmentWithdrawalTax).toBeCloseTo(300 * 0.6 * CAPITAL_GAINS_TAX_RATE, 6);
    // 預金に入るのは税引後(取崩額 − 取崩時課税)。
    expect(at.savings).toBeCloseTo(300 - at.investmentWithdrawalTax, 6);
  });

  it('iDeCo の一括取崩は退職所得課税額が取崩時課税に計上される', () => {
    const result = runSimulation(
      withdrawalOnlyInput([
        account({
          accountType: 'ideco',
          initialHolding: 3000,
          acquisitionCost: 3000,
          withdrawals: [{ type: 'lumpSum', age: 65, amount: 3000 }],
        }),
      ]),
    );
    const at = result.find((r) => r.age === 65)!;
    // 勤続年数 = 受取65 − 積立開始60 = 5年。
    const expected = calcRetirementTax({ retirementBonus: 3000, yearsOfService: 5 });
    expect(at.investmentWithdrawal).toBeCloseTo(3000, 6);
    expect(at.investmentWithdrawalTax).toBeCloseTo(expected.incomeTax + expected.residentTax, 4);
  });

  it('全年で 預金残高の増加 = 年間収支 + 取崩額 − 取崩時課税 が成立する', () => {
    // 収入・支出・課税口座の分割取崩を混在させ、CF表の恒等式が崩れないことを確認する。
    const result = runSimulation(
      baseInput({
        basic: { currentAge: 60, endAge: 90, savings: 200 },
        income: {
          workPeriods: [workPeriod({ startAge: 60, endAge: 64 })],
          retirementBonus: 500,
          pension: 300,
          other: 0,
        },
        investment: {
          accounts: [
            account({
              accountType: 'taxable',
              initialHolding: 2000,
              acquisitionCost: 800,
              annualReturn: 3.0,
              withdrawals: [{ type: 'spread', startAge: 66, endAge: 85 }],
            }),
          ],
        },
      }),
    );

    result.forEach((r, i) => {
      const previousSavings = i === 0 ? 200 : result[i - 1]!.savings;
      expect(r.savings - previousSavings).toBeCloseTo(
        r.balance + r.investmentWithdrawal - r.investmentWithdrawalTax,
        6,
      );
    });
    // 取崩が実際に発生している(恒等式が自明に成立しているだけではない)。
    expect(result.some((r) => r.investmentWithdrawal > 0)).toBe(true);
    expect(result.some((r) => r.investmentWithdrawalTax > 0)).toBe(true);
  });
});
