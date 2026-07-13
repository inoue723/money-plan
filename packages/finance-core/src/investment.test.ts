import { describe, expect, it } from 'vitest';

import { CAPITAL_GAINS_TAX_RATE, NISA_ANNUAL_LIMIT, NISA_LIFETIME_LIMIT } from './constants';
import { initInvestmentState, stepInvestment, type InvestmentState } from './investment';
import type { InvestmentAccount, InvestmentInput } from './types';

/** テスト用の投資枠を作る(必要な項目だけ上書き)。 */
const makeAccount = (overrides: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
  name: 'test',
  accountType: 'nisa',
  owner: 'self',
  initialHolding: 0,
  monthlyAmount: 0,
  annualReturn: 0,
  startAge: 30,
  endAge: 65,
  ...overrides,
});

/** 1 枠だけの投資設定。 */
const oneAccount = (overrides: Partial<InvestmentAccount> = {}): InvestmentInput => ({
  accounts: [makeAccount(overrides)],
});

describe('initInvestmentState', () => {
  it('各枠の初期保有額を評価額・簿価に組み入れる', () => {
    const state = initInvestmentState([
      makeAccount({ accountType: 'taxable', initialHolding: 300 }),
      makeAccount({ accountType: 'taxable', initialHolding: 50 }),
    ]);
    expect(state.accounts[0]).toEqual({ value: 300, costBasis: 300 });
    expect(state.accounts[1]).toEqual({ value: 50, costBasis: 50 });
    // 課税枠の初期保有額はどの名義の NISA 生涯枠も消費しない。
    expect(state.nisaLifetimeCostBasis).toEqual({ self: 0, spouse: 0 });
  });

  it('NISA 枠の初期保有額は生涯枠(簿価累計)を消費する', () => {
    const state = initInvestmentState([
      makeAccount({ accountType: 'nisa', initialHolding: 400 }),
      makeAccount({ accountType: 'nisa', initialHolding: 200 }),
      makeAccount({ accountType: 'taxable', initialHolding: 500 }),
    ]);
    expect(state.accounts[0]).toEqual({ value: 400, costBasis: 400 });
    expect(state.accounts[1]).toEqual({ value: 200, costBasis: 200 });
    expect(state.accounts[2]).toEqual({ value: 500, costBasis: 500 });
    // 本人名義 NISA 枠の初期保有額合計(400 + 200 = 600)だけ本人の生涯枠を消費する(課税枠は対象外)。
    expect(state.nisaLifetimeCostBasis).toEqual({ self: 600, spouse: 0 });
  });

  it('名義ごとに初期保有額の生涯枠消費を独立集計する', () => {
    const state = initInvestmentState([
      makeAccount({ accountType: 'nisa', owner: 'self', initialHolding: 400 }),
      makeAccount({ accountType: 'nisa', owner: 'spouse', initialHolding: 700 }),
      makeAccount({ accountType: 'taxable', owner: 'spouse', initialHolding: 500 }),
    ]);
    // 本人 400・配偶者 700 をそれぞれの生涯枠に計上(課税枠は対象外)。
    expect(state.nisaLifetimeCostBasis).toEqual({ self: 400, spouse: 700 });
  });

  it('枠が無い場合は空stateを返す', () => {
    expect(initInvestmentState([])).toEqual({
      accounts: [],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    });
  });
});

describe('stepInvestment - 積立のみ', () => {
  it('積立 + 運用益を評価額に反映し、簿価は積立分だけ増える', () => {
    const prev = initInvestmentState([makeAccount()]);
    const investment = oneAccount({ monthlyAmount: 3, annualReturn: 3.0, accountType: 'nisa' });

    const result = stepInvestment(prev, { age: 30, investment });

    // 年間積立 = 3 × 12 = 36、運用益 = 36 × 3% = 1.08、評価額 = 37.08
    expect(result.contribution).toBe(36);
    expect(result.gain).toBeCloseTo(1.08, 10);
    expect(result.investmentValue).toBeCloseTo(37.08, 10);
    expect(result.state.accounts[0]!.value).toBeCloseTo(37.08, 10);
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(36, 10);
    expect(result.withdrawal).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.uninvested).toBe(0);
    // NISA 枠の積立は生涯簿価累計に加算される。
    expect(result.state.nisaLifetimeCostBasis.self).toBeCloseTo(36, 10);
  });

  it('前年評価額にも利回りが乗る', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 800 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({ monthlyAmount: 0, annualReturn: 5.0 });

    const result = stepInvestment(prev, { age: 40, investment });

    // 運用益 = 1000 × 5% = 50
    expect(result.gain).toBeCloseTo(50, 10);
    expect(result.investmentValue).toBeCloseTo(1050, 10);
  });
});

describe('stepInvestment - 積立終了', () => {
  it('積立終了年齢に達したら積立を止める(age >= endAge)', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 800 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({ monthlyAmount: 5, annualReturn: 3.0, endAge: 65 });

    const atEnd = stepInvestment(prev, { age: 65, investment });
    expect(atEnd.contribution).toBe(0);
    // 運用益 = 1000 × 3% = 30、積立なしなので評価額 = 1030
    expect(atEnd.investmentValue).toBeCloseTo(1030, 10);
    expect(atEnd.state.accounts[0]!.costBasis).toBeCloseTo(800, 10);
  });

  it('積立終了年齢の前年までは積立する(age < endAge)', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 800 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({ monthlyAmount: 5, annualReturn: 0, endAge: 65 });

    const beforeEnd = stepInvestment(prev, { age: 64, investment });
    expect(beforeEnd.contribution).toBe(60); // 5 × 12
    expect(beforeEnd.state.accounts[0]!.costBasis).toBeCloseTo(860, 10);
  });

  it('積立開始年齢より前は積立しない(age < startAge)', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 0, costBasis: 0 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({ monthlyAmount: 5, annualReturn: 0, startAge: 40, endAge: 65 });

    // 開始年齢(40)より前(39)は積立ゼロ。
    const before = stepInvestment(prev, { age: 39, investment });
    expect(before.contribution).toBe(0);
    expect(before.state.accounts[0]!.costBasis).toBe(0);

    // 開始年齢ちょうど(40)から積立が始まる。
    const atStart = stepInvestment(prev, { age: 40, investment });
    expect(atStart.contribution).toBe(60); // 5 × 12
    expect(atStart.state.accounts[0]!.costBasis).toBeCloseTo(60, 10);
  });
});

describe('stepInvestment - 取り崩し(課税口座)', () => {
  it('評価益按分で 20.315% を課税し、評価額・簿価を減らす', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 600 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({
      annualReturn: 0,
      accountType: 'taxable',
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    // 評価益割合 = (1000 − 600) / 1000 = 0.4、課税対象益 = 100 × 0.4 = 40
    expect(result.tax).toBeCloseTo(40 * CAPITAL_GAINS_TAX_RATE, 10); // 8.126
    // 取崩後: 評価額 900、簿価 600 × (1 − 100/1000) = 540
    expect(result.investmentValue).toBeCloseTo(900, 10);
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(540, 10);
  });

  it('開始年齢に達していなければ取り崩さない', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 600 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({ withdrawal: { startAge: 65, annualAmount: 100 } });

    const result = stepInvestment(prev, { age: 60, investment });

    expect(result.withdrawal).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.investmentValue).toBeCloseTo(1000, 10);
  });

  it('含み損のときは課税しない', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 500, costBasis: 800 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({
      accountType: 'taxable',
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.tax).toBe(0);
    expect(result.investmentValue).toBeCloseTo(400, 10);
    // 簿価 = 800 × (1 − 100/500) = 640
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(640, 10);
  });

  it('評価額を超える取り崩しは評価額までに制限される', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 50, costBasis: 20 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({
      accountType: 'taxable',
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(50);
    expect(result.investmentValue).toBeCloseTo(0, 10);
  });
});

describe('stepInvestment - 取り崩し(NISA)', () => {
  it('NISA 口座は取り崩しても非課税', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 600 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({
      accountType: 'nisa',
      withdrawal: { startAge: 65, annualAmount: 100 },
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    expect(result.tax).toBe(0);
    expect(result.investmentValue).toBeCloseTo(900, 10);
  });
});

describe('stepInvestment - 複数枠の独立運用', () => {
  it('NISA枠と課税枠を独立に運用し、評価額を合計する', () => {
    const prev: InvestmentState = {
      accounts: [
        { value: 0, costBasis: 0 },
        { value: 0, costBasis: 0 },
      ],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment: InvestmentInput = {
      accounts: [
        makeAccount({ name: 'NISA', accountType: 'nisa', monthlyAmount: 3, annualReturn: 3.0 }),
        makeAccount({ name: '特定', accountType: 'taxable', monthlyAmount: 2, annualReturn: 5.0 }),
      ],
    };

    const result = stepInvestment(prev, { age: 30, investment });

    // NISA: 36 × 1.03 = 37.08、課税: 24 × 1.05 = 25.2、合計 = 62.28
    expect(result.contribution).toBe(60); // 36 + 24
    expect(result.investmentValue).toBeCloseTo(62.28, 10);
    expect(result.state.accounts[0]!.value).toBeCloseTo(37.08, 10);
    expect(result.state.accounts[1]!.value).toBeCloseTo(25.2, 10);
    // 生涯簿価累計には NISA 枠の積立のみ計上(課税枠は対象外)。
    expect(result.state.nisaLifetimeCostBasis.self).toBeCloseTo(36, 10);
  });
});

describe('stepInvestment - NISA年間上限(360万)', () => {
  it('全NISA枠合算の年間投資額を360万に制限し、超過分は投資せず預金に残す', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 0, costBasis: 0 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    // 月40万 × 12 = 480万/年 を希望。年間上限360万を超える。
    const investment = oneAccount({ accountType: 'nisa', monthlyAmount: 40, annualReturn: 0 });

    const result = stepInvestment(prev, { age: 30, investment });

    expect(result.contribution).toBe(NISA_ANNUAL_LIMIT); // 360
    expect(result.uninvested).toBe(480 - NISA_ANNUAL_LIMIT); // 120 は預金に残る
    expect(result.investmentValue).toBeCloseTo(NISA_ANNUAL_LIMIT, 10);
  });

  it('複数NISA枠は合算で360万に制限され、後の枠から先に打ち切られる', () => {
    const prev: InvestmentState = {
      accounts: [
        { value: 0, costBasis: 0 },
        { value: 0, costBasis: 0 },
      ],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment: InvestmentInput = {
      accounts: [
        // 枠1: 300万/年、枠2: 200万/年 → 合算500万だが上限360万。
        makeAccount({ accountType: 'nisa', monthlyAmount: 25, annualReturn: 0 }),
        makeAccount({ accountType: 'nisa', monthlyAmount: 200 / 12, annualReturn: 0 }),
      ],
    };

    const result = stepInvestment(prev, { age: 30, investment });

    // 枠1が先に300万を消費、枠2は残り60万まで。
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(300, 6);
    expect(result.state.accounts[1]!.costBasis).toBeCloseTo(60, 6);
    expect(result.contribution).toBeCloseTo(360, 6);
    expect(result.uninvested).toBeCloseTo(140, 6); // 500 − 360
  });

  it('課税枠は年間上限の対象外(360万を超えて積み立てられる)', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 0, costBasis: 0 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({ accountType: 'taxable', monthlyAmount: 50, annualReturn: 0 });

    const result = stepInvestment(prev, { age: 30, investment });

    expect(result.contribution).toBe(600); // 制限なし
    expect(result.uninvested).toBe(0);
  });
});

describe('stepInvestment - NISA生涯上限(1800万)', () => {
  it('生涯簿価累計が1800万に達すると以降は積み立てない', () => {
    // すでに1790万投入済み。年間上限内でも残り10万しか積めない。
    const prev: InvestmentState = {
      accounts: [{ value: 1790, costBasis: 1790 }],
      nisaLifetimeCostBasis: { self: 1790, spouse: 0 },
    };
    const investment = oneAccount({ accountType: 'nisa', monthlyAmount: 10, annualReturn: 0 });

    const result = stepInvestment(prev, { age: 40, investment });

    // 希望120万だが生涯枠の残り10万まで。
    expect(result.contribution).toBe(10);
    expect(result.uninvested).toBe(110);
    expect(result.state.nisaLifetimeCostBasis.self).toBe(NISA_LIFETIME_LIMIT); // 1800

    // 翌年は生涯枠が尽きているため一切積み立てない。
    const next = stepInvestment(result.state, { age: 41, investment });
    expect(next.contribution).toBe(0);
    expect(next.uninvested).toBe(120);
    expect(next.state.nisaLifetimeCostBasis.self).toBe(NISA_LIFETIME_LIMIT);
  });

  it('NISA 枠の初期保有額が生涯枠を先に消費し、残りだけ積み立てられる', () => {
    // 初期保有 1790 万の NISA 枠。生涯枠の残りは 10 万しかない。
    const investment = oneAccount({
      accountType: 'nisa',
      initialHolding: 1790,
      monthlyAmount: 10, // 希望 120 万/年
      annualReturn: 0,
    });
    const prev = initInvestmentState(investment.accounts);
    expect(prev.nisaLifetimeCostBasis.self).toBe(1790);

    const result = stepInvestment(prev, { age: 40, investment });

    // 生涯枠の残り 10 万しか積み立てられない。
    expect(result.contribution).toBe(10);
    expect(result.uninvested).toBe(110);
    expect(result.state.nisaLifetimeCostBasis.self).toBe(NISA_LIFETIME_LIMIT); // 1800
  });

  it('取り崩しても生涯枠は復活しない(簿価累計は減らない)', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1800, costBasis: 1800 }],
      nisaLifetimeCostBasis: { self: NISA_LIFETIME_LIMIT, spouse: 0 },
    };
    const investment = oneAccount({
      accountType: 'nisa',
      monthlyAmount: 10,
      annualReturn: 0,
      endAge: 90,
      withdrawal: { startAge: 60, annualAmount: 500 },
    });

    const result = stepInvestment(prev, { age: 65, investment });

    // 取り崩しても翌年に枠は戻らない(本issue対象外)。
    expect(result.state.nisaLifetimeCostBasis.self).toBe(NISA_LIFETIME_LIMIT);
    expect(result.contribution).toBe(0);
    expect(result.uninvested).toBe(120);
  });
});

describe('stepInvestment - T5 年次ループでの連鎖', () => {
  it('前年stateを次年の入力として複数年チェーンできる', () => {
    const investment = oneAccount({ monthlyAmount: 10, annualReturn: 3.0, accountType: 'nisa' });

    let state = initInvestmentState(investment.accounts);
    for (let age = 30; age < 33; age++) {
      state = stepInvestment(state, { age, investment }).state;
    }

    // 3年間、毎年 120 万円を積み立てて 3% 運用した複利の手計算値。
    // y1: 120 × 1.03 = 123.6
    // y2: (123.6 + 120) × 1.03 = 250.908
    // y3: (250.908 + 120) × 1.03 = 382.03524
    expect(state.accounts[0]!.value).toBeCloseTo(382.03524, 5);
    expect(state.accounts[0]!.costBasis).toBeCloseTo(360, 10);
    expect(state.nisaLifetimeCostBasis.self).toBeCloseTo(360, 10);
  });
});

describe('stepInvestment - 名義ごとの NISA 上限(#52)', () => {
  it('年間枠(360万)は名義ごとに独立適用される(本人・配偶者それぞれ360万)', () => {
    const prev: InvestmentState = {
      accounts: [
        { value: 0, costBasis: 0 },
        { value: 0, costBasis: 0 },
      ],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    // 本人・配偶者ともに 月40万 × 12 = 480万/年 を希望。各名義とも年間上限360万。
    const investment: InvestmentInput = {
      accounts: [
        makeAccount({ accountType: 'nisa', owner: 'self', monthlyAmount: 40, annualReturn: 0 }),
        makeAccount({ accountType: 'nisa', owner: 'spouse', monthlyAmount: 40, annualReturn: 0 }),
      ],
    };

    const result = stepInvestment(prev, { age: 30, investment });

    // 名義ごとに 360 万まで積み立てられ、合算は 720 万。
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(NISA_ANNUAL_LIMIT, 6); // 本人 360
    expect(result.state.accounts[1]!.costBasis).toBeCloseTo(NISA_ANNUAL_LIMIT, 6); // 配偶者 360
    expect(result.contribution).toBeCloseTo(NISA_ANNUAL_LIMIT * 2, 6); // 720
    expect(result.uninvested).toBeCloseTo((480 - NISA_ANNUAL_LIMIT) * 2, 6); // 各120 = 240
    expect(result.state.nisaLifetimeCostBasis).toEqual({
      self: NISA_ANNUAL_LIMIT,
      spouse: NISA_ANNUAL_LIMIT,
    });
  });

  it('生涯枠(1800万)は名義ごとに独立し、本人が尽きても配偶者は積み立てられる', () => {
    // 本人はすでに生涯枠を使い切り、配偶者は未使用。
    const prev: InvestmentState = {
      accounts: [
        { value: 1800, costBasis: 1800 },
        { value: 0, costBasis: 0 },
      ],
      nisaLifetimeCostBasis: { self: NISA_LIFETIME_LIMIT, spouse: 0 },
    };
    const investment: InvestmentInput = {
      accounts: [
        makeAccount({ accountType: 'nisa', owner: 'self', monthlyAmount: 10, annualReturn: 0 }),
        makeAccount({ accountType: 'nisa', owner: 'spouse', monthlyAmount: 10, annualReturn: 0 }),
      ],
    };

    const result = stepInvestment(prev, { age: 40, investment });

    // 本人は生涯枠が尽きて積み立てられず、配偶者は 120 万積み立てられる。
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(1800, 6); // 本人は据え置き
    expect(result.state.accounts[1]!.costBasis).toBeCloseTo(120, 6); // 配偶者は積立
    expect(result.contribution).toBeCloseTo(120, 6);
    expect(result.uninvested).toBeCloseTo(120, 6); // 本人分120が投資されず残る
    expect(result.state.nisaLifetimeCostBasis).toEqual({
      self: NISA_LIFETIME_LIMIT,
      spouse: 120,
    });
  });
});
