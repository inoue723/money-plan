import { describe, expect, it } from 'vitest';

import { CAPITAL_GAINS_TAX_RATE, NISA_ANNUAL_LIMIT, NISA_LIFETIME_LIMIT } from './constants';
import {
  initInvestmentState,
  investmentAccountValuesBeforeWithdrawal,
  stepInvestment,
  type InvestmentState,
} from './investment';
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
  withdrawals: [],
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

  describe('取得価額(簿価)を持つ初期保有(#59)', () => {
    it('取得価額 < 時価 のとき、評価額は時価・簿価は取得価額になる', () => {
      const state = initInvestmentState([
        makeAccount({ accountType: 'taxable', initialHolding: 500, acquisitionCost: 400 }),
      ]);
      // value(評価額)は時価、costBasis(簿価)は取得価額。
      expect(state.accounts[0]).toEqual({ value: 500, costBasis: 400 });
    });

    it('NISA 枠の生涯枠消費は時価ではなく簿価(取得価額)ぶんになる', () => {
      const state = initInvestmentState([
        makeAccount({ accountType: 'nisa', initialHolding: 500, acquisitionCost: 400 }),
      ]);
      // 時価 500 ではなく簿価 400 だけ生涯枠を消費する(含み益 100 は枠を消費しない)。
      expect(state.accounts[0]).toEqual({ value: 500, costBasis: 400 });
      expect(state.nisaLifetimeCostBasis).toEqual({ self: 400, spouse: 0 });
    });

    it('名義ごとに簿価ベースで生涯枠消費を独立集計する', () => {
      const state = initInvestmentState([
        makeAccount({
          accountType: 'nisa',
          owner: 'self',
          initialHolding: 500,
          acquisitionCost: 400,
        }),
        makeAccount({
          accountType: 'nisa',
          owner: 'spouse',
          initialHolding: 900,
          acquisitionCost: 700,
        }),
      ]);
      expect(state.nisaLifetimeCostBasis).toEqual({ self: 400, spouse: 700 });
    });

    it('acquisitionCost 未指定なら時価を簿価とみなす(#46/#52 と後方互換)', () => {
      const withUndefined = initInvestmentState([
        makeAccount({ accountType: 'nisa', initialHolding: 400 }),
      ]);
      const withExplicit = initInvestmentState([
        makeAccount({ accountType: 'nisa', initialHolding: 400, acquisitionCost: 400 }),
      ]);
      // 取得価額を省略した場合と時価と同額を明示した場合で完全に一致する。
      expect(withUndefined).toEqual(withExplicit);
      expect(withUndefined.accounts[0]).toEqual({ value: 400, costBasis: 400 });
      expect(withUndefined.nisaLifetimeCostBasis).toEqual({ self: 400, spouse: 0 });
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
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 100 }],
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
    const investment = oneAccount({
      withdrawals: [{ type: 'spread', startAge: 65, endAge: 85 }],
    });

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
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 100 }],
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
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 100 }],
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
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 100 }],
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    expect(result.tax).toBe(0);
    expect(result.investmentValue).toBeCloseTo(900, 10);
  });
});

describe('stepInvestment - iDeCo・小規模企業共済(#73)', () => {
  it('拠出額を名義ごとに集計する(小規模企業共済等掛金控除の対象)', () => {
    const prev: InvestmentState = {
      accounts: [
        { value: 0, costBasis: 0 },
        { value: 0, costBasis: 0 },
        { value: 0, costBasis: 0 },
      ],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment: InvestmentInput = {
      accounts: [
        makeAccount({ accountType: 'ideco', owner: 'self', monthlyAmount: 2, annualReturn: 0 }),
        makeAccount({ accountType: 'mutualAid', owner: 'self', monthlyAmount: 5, annualReturn: 0 }),
        makeAccount({ accountType: 'ideco', owner: 'spouse', monthlyAmount: 1, annualReturn: 0 }),
      ],
    };

    const result = stepInvestment(prev, { age: 40, investment });

    // 本人: (2 + 5) × 12 = 84、配偶者: 1 × 12 = 12。
    expect(result.mutualAidContributionByOwner).toEqual({ self: 84, spouse: 12 });
  });

  it('iDeCo・小規模企業共済は NISA 生涯・年間枠を消費しない', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 0, costBasis: 0 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    // 年間 360 万を超える拠出でも上限で止まらず、NISA 累計簿価も増えない。
    const investment = oneAccount({
      accountType: 'ideco',
      monthlyAmount: 40, // 年 480 万(NISA 年間枠 360 万超)
      annualReturn: 0,
    });

    const result = stepInvestment(prev, { age: 40, investment });

    expect(result.contribution).toBe(480); // 上限で止まらない
    expect(result.uninvested).toBe(0);
    expect(result.state.nisaLifetimeCostBasis).toEqual({ self: 0, spouse: 0 });
  });

  it('運用益は非課税(取り崩しでも運用益課税は発生しない)', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 600 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({
      accountType: 'ideco',
      annualReturn: 0,
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 100 }],
    });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    expect(result.tax).toBe(0); // 運用益課税なし
  });

  it('一括取崩を「勤続年数 = 受取年齢 − 積立開始年齢」つきで名義別に報告する', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 0 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({
      accountType: 'ideco',
      owner: 'self',
      startAge: 30,
      annualReturn: 0,
      withdrawals: [{ type: 'lumpSum', age: 65, amount: 300 }],
    });

    const result = stepInvestment(prev, { age: 65, investment });

    expect(result.mutualAidLumpSums).toEqual([
      { owner: 'self', amount: 300, yearsOfService: 35 }, // 65 − 30
    ]);
    // spread は無いため 0。
    expect(result.mutualAidSpreadByOwner).toEqual({ self: 0, spouse: 0 });
  });

  it('分割取崩を名義ごとに集計する(年金合算課税の対象)', () => {
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 0 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };
    const investment = oneAccount({
      accountType: 'mutualAid',
      owner: 'spouse',
      annualReturn: 0,
      withdrawals: [{ type: 'spread', startAge: 65, endAge: 84 }], // 残り20年 → 1000/20 = 50
    });

    const result = stepInvestment(prev, { age: 65, investment });

    expect(result.mutualAidSpreadByOwner).toEqual({ self: 0, spouse: 50 });
    expect(result.mutualAidLumpSums).toEqual([]);
    expect(result.tax).toBe(0);
  });
});

describe('stepInvestment - 分割取崩(spread。#69)', () => {
  /** 取崩フェーズだけを見たい枠(積立なし・利回りは指定)。 */
  const spreadAccount = (
    startAge: number,
    endAge: number,
    overrides: Partial<InvestmentAccount> = {},
  ): InvestmentInput =>
    oneAccount({
      accountType: 'nisa',
      monthlyAmount: 0,
      annualReturn: 0,
      withdrawals: [{ type: 'spread', startAge, endAge }],
      ...overrides,
    });

  it('利回り0なら期間中は均等に取り崩し、終了年齢の年末に残高が0になる', () => {
    // 65〜69 歳の 5 年で 1000 万を取り崩し切る。利回り 0 なので毎年ちょうど 200 万。
    const investment = spreadAccount(65, 69);
    let state: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const withdrawals: number[] = [];
    for (let age = 65; age <= 69; age++) {
      const result = stepInvestment(state, { age, investment });
      withdrawals.push(result.withdrawal);
      state = result.state;
    }

    // 残り年数(endAge − age + 1)は 5,4,3,2,1 と減り、取崩額は毎年 200 万で均等になる。
    expect(withdrawals).toEqual([200, 200, 200, 200, 200]);
    // 終了年齢(69)の年末に残高 0。
    expect(state.accounts[0]!.value).toBeCloseTo(0, 10);
  });

  it('運用益があっても終了年齢の年末に残高が0になる(残高に応じて取崩額が増減)', () => {
    // 65〜85 歳の 21 年、利回り 3%。運用益ぶん取崩額は毎年変動するが、期間末には必ず 0 になる。
    const investment = spreadAccount(65, 85, { annualReturn: 3.0 });
    let state: InvestmentState = {
      accounts: [{ value: 3000, costBasis: 3000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    let total = 0;
    for (let age = 65; age <= 85; age++) {
      const result = stepInvestment(state, { age, investment });
      expect(result.withdrawal).toBeGreaterThan(0); // 期間中は毎年取り崩す
      total += result.withdrawal;
      state = result.state;
    }

    // 終了年齢の年に残額をすべて取り崩すため、期間末の残高は 0。
    expect(state.accounts[0]!.value).toBeCloseTo(0, 10);
    // 運用益ぶん、取崩総額は元の評価額(3000)を上回る。
    expect(total).toBeGreaterThan(3000);
  });

  it('開始年齢より前・終了年齢より後は取り崩さない', () => {
    const investment = spreadAccount(65, 85);
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    expect(stepInvestment(prev, { age: 64, investment }).withdrawal).toBe(0);
    expect(stepInvestment(prev, { age: 86, investment }).withdrawal).toBe(0);
    // 開始年齢ちょうどから取り崩す(1000 / (85 − 65 + 1) = 1000 / 21)。
    expect(stepInvestment(prev, { age: 65, investment }).withdrawal).toBeCloseTo(1000 / 21, 10);
  });

  it('開始年齢 = 終了年齢(1年)なら残高を全額取り崩す', () => {
    const investment = spreadAccount(70, 70);
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(1000);
    expect(result.investmentValue).toBeCloseTo(0, 10);
  });

  it('課税口座の分割取崩は取崩額の評価益部分に課税されつつ、期間末に残高0になる', () => {
    // 時価 1000 / 簿価 600(含み益 400)。65〜66 歳の 2 年で取り崩し切る。
    const investment = spreadAccount(65, 66, { accountType: 'taxable' });
    let state: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 600 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    // 1 年目(65 歳): 1000 / 2 = 500 を取り崩す。評価益割合 = (1000 − 600) / 1000 = 0.4。
    const y1 = stepInvestment(state, { age: 65, investment });
    expect(y1.withdrawal).toBe(500);
    expect(y1.tax).toBeCloseTo(500 * 0.4 * CAPITAL_GAINS_TAX_RATE, 10);
    expect(y1.state.accounts[0]!.value).toBeCloseTo(500, 10);
    expect(y1.state.accounts[0]!.costBasis).toBeCloseTo(300, 10); // 600 × (1 − 500/1000)
    state = y1.state;

    // 2 年目(66 歳 = 終了年齢): 残額 500 をすべて取り崩す。評価益割合は 0.4 のまま。
    const y2 = stepInvestment(state, { age: 66, investment });
    expect(y2.withdrawal).toBe(500);
    expect(y2.tax).toBeCloseTo(500 * 0.4 * CAPITAL_GAINS_TAX_RATE, 10);
    expect(y2.investmentValue).toBeCloseTo(0, 10);
  });
});

describe('stepInvestment - 一括取崩(lumpSum。#69)', () => {
  it('指定した年齢の年にだけ指定額を取り崩す', () => {
    const investment = oneAccount({
      accountType: 'nisa',
      annualReturn: 0,
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 300 }],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    // 対象年齢の前後では取り崩さない。
    expect(stepInvestment(prev, { age: 69, investment }).withdrawal).toBe(0);
    expect(stepInvestment(prev, { age: 71, investment }).withdrawal).toBe(0);

    const result = stepInvestment(prev, { age: 70, investment });
    expect(result.withdrawal).toBe(300);
    expect(result.investmentValue).toBeCloseTo(700, 10);
  });

  it('残高が指定額に満たない場合は残高全額を取り崩す(min(amount, 残高))', () => {
    const investment = oneAccount({
      accountType: 'nisa',
      annualReturn: 0,
      // 残高(200)を大きく超える額を指定 = 「全額取り崩す」運用。
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 9999 }],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 200, costBasis: 150 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(200);
    expect(result.investmentValue).toBeCloseTo(0, 10);
  });

  it('課税口座では取崩額の評価益部分に課税される', () => {
    // 時価 1000 / 簿価 600 → 評価益割合 0.4。300 万取り崩す。
    const investment = oneAccount({
      accountType: 'taxable',
      annualReturn: 0,
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 300 }],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 600 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(300);
    // 課税対象益 = 300 × 0.4 = 120
    expect(result.tax).toBeCloseTo(120 * CAPITAL_GAINS_TAX_RATE, 10);
    expect(result.investmentValue).toBeCloseTo(700, 10);
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(420, 10); // 600 × (1 − 300/1000)
  });
});

describe('stepInvestment - 複数の取り崩し設定(#69)', () => {
  it('同一年に該当する設定は spread → lumpSum の順に順次適用する', () => {
    // 分割取崩(65〜69)と一括取崩(65 歳・100 万)が同じ年に該当する。
    const investment = oneAccount({
      accountType: 'nisa',
      annualReturn: 0,
      withdrawals: [
        { type: 'spread', startAge: 65, endAge: 69 },
        { type: 'lumpSum', age: 65, amount: 100 },
      ],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 65, investment });

    // spread が先: 1000 / 5 = 200 → 残高 800。続けて lumpSum 100 → 残高 700。合計 300。
    // (lumpSum が先だと spread は (1000 − 100) / 5 = 180 になり合計 280 になる)
    expect(result.withdrawal).toBe(300);
    expect(result.investmentValue).toBeCloseTo(700, 10);
  });

  it('定義順が lumpSum 先でも spread から適用される', () => {
    const investment = oneAccount({
      accountType: 'nisa',
      annualReturn: 0,
      withdrawals: [
        { type: 'lumpSum', age: 65, amount: 100 },
        { type: 'spread', startAge: 65, endAge: 69 },
      ],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    // 定義順によらず spread(200)→ lumpSum(100)の順で適用され、合計 300。
    expect(stepInvestment(prev, { age: 65, investment }).withdrawal).toBe(300);
  });

  it('残高が尽きたら以降の設定の取崩額は0になる', () => {
    const investment = oneAccount({
      accountType: 'nisa',
      annualReturn: 0,
      withdrawals: [
        { type: 'lumpSum', age: 70, amount: 100 }, // 残高 100 を使い切る
        { type: 'lumpSum', age: 70, amount: 50 }, // 取り崩せる残高がない
      ],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 100, costBasis: 100 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    expect(result.investmentValue).toBeCloseTo(0, 10);
  });

  it('spread 期間が重複しても順次適用でクラッシュせず処理される', () => {
    // UI 側では警告するが、計算は定義順に順次適用する。
    const investment = oneAccount({
      accountType: 'nisa',
      annualReturn: 0,
      withdrawals: [
        { type: 'spread', startAge: 65, endAge: 66 },
        { type: 'spread', startAge: 65, endAge: 66 },
      ],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 65, investment });

    // 1 本目: 1000 / 2 = 500 → 残高 500。2 本目: 500 / 2 = 250 → 残高 250。合計 750。
    expect(result.withdrawal).toBe(750);
    expect(result.investmentValue).toBeCloseTo(250, 10);
  });

  it('積立を継続しながら複数年にわたり2回の一括取崩を適用できる', () => {
    // 初期保有 1000 万、毎月 10 万(年 120 万)積立、利回り 0。
    // 40 歳に 200 万、45 歳に 300 万の一括取崩(取崩後も積立は継続する)。
    const investment = oneAccount({
      accountType: 'nisa',
      initialHolding: 1000,
      monthlyAmount: 10,
      annualReturn: 0,
      startAge: 30,
      endAge: 50,
      withdrawals: [
        { type: 'lumpSum', age: 40, amount: 200 },
        { type: 'lumpSum', age: 45, amount: 300 },
      ],
    });

    let state = initInvestmentState(investment.accounts);
    const byAge = new Map<number, number>();
    for (let age = 40; age <= 45; age++) {
      const result = stepInvestment(state, { age, investment });
      byAge.set(age, result.withdrawal);
      state = result.state;
    }

    // 40 歳: 積立 120 → 1120、一括 200 → 920。
    expect(byAge.get(40)).toBe(200);
    // 41〜44 歳: 取り崩しなし(積立のみ)。920 + 120 × 4 = 1400。
    expect(byAge.get(41)).toBe(0);
    expect(byAge.get(44)).toBe(0);
    // 45 歳: 積立 120 → 1520、2 回目の一括 300 → 1220。
    expect(byAge.get(45)).toBe(300);
    expect(state.accounts[0]!.value).toBeCloseTo(1220, 10);
  });

  it('課税口座で複数設定を適用しても二重課税・課税漏れが起きない', () => {
    // 時価 1000 / 簿価 600(評価益割合 0.4)。spread(200)+ lumpSum(100)= 計 300 を取り崩す。
    const investment = oneAccount({
      accountType: 'taxable',
      annualReturn: 0,
      withdrawals: [
        { type: 'spread', startAge: 65, endAge: 69 },
        { type: 'lumpSum', age: 65, amount: 100 },
      ],
    });
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 600 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 65, investment });

    expect(result.withdrawal).toBe(300);
    // 簿価按分(残存比率)では評価益割合が取崩の前後で不変(0.4)なため、
    // 課税額は取崩総額 300 に対して一度に課税した場合と一致する。
    expect(result.tax).toBeCloseTo(300 * 0.4 * CAPITAL_GAINS_TAX_RATE, 10);
    expect(result.investmentValue).toBeCloseTo(700, 10);
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(420, 10); // 600 × (1 − 300/1000)
  });

  it('取り崩し設定が空配列なら取り崩さない', () => {
    const investment = oneAccount({ accountType: 'nisa', annualReturn: 0, withdrawals: [] });
    const prev: InvestmentState = {
      accounts: [{ value: 1000, costBasis: 1000 }],
      nisaLifetimeCostBasis: { self: 0, spouse: 0 },
    };

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.investmentValue).toBeCloseTo(1000, 10);
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
      withdrawals: [{ type: 'lumpSum', age: 65, amount: 500 }],
    });

    const result = stepInvestment(prev, { age: 65, investment });

    // 取り崩しても翌年に枠は戻らない(本issue対象外)。
    expect(result.state.nisaLifetimeCostBasis.self).toBe(NISA_LIFETIME_LIMIT);
    expect(result.contribution).toBe(0);
    expect(result.uninvested).toBe(120);
  });
});

describe('取得価額(簿価)を持つ初期保有の運用(#59)', () => {
  it('取得価額 < 時価 の NISA 枠で、生涯枠消費が簿価ぶんだけになる', () => {
    // 初期保有: 時価 1700 万 / 取得価額(簿価)1750 万… ではなく含み益ケース。
    // 時価 1700・簿価 1600 → 生涯枠は 1600 だけ消費し、残枠 200 万を新規積立できる。
    const investment = oneAccount({
      accountType: 'nisa',
      initialHolding: 1700,
      acquisitionCost: 1600,
      monthlyAmount: 30, // 希望 360 万/年
      annualReturn: 0,
    });
    const prev = initInvestmentState(investment.accounts);
    // 簿価 1600 だけ生涯枠を消費(時価 1700 ではない)。
    expect(prev.nisaLifetimeCostBasis.self).toBe(1600);

    const result = stepInvestment(prev, { age: 40, investment });

    // 生涯枠の残りは 1800 − 1600 = 200 万。希望 360 万のうち 200 万だけ積み立てられる。
    expect(result.contribution).toBe(200);
    expect(result.uninvested).toBe(160);
    expect(result.state.nisaLifetimeCostBasis.self).toBe(NISA_LIFETIME_LIMIT); // 1800
  });

  it('時価をそのまま消費していたら残枠が過小になる(簿価ベースの効果を確認)', () => {
    // 対比: 取得価額を指定しない(=時価 1700 を簿価とみなす)と残枠は 100 万しかない。
    const investment = oneAccount({
      accountType: 'nisa',
      initialHolding: 1700,
      monthlyAmount: 30,
      annualReturn: 0,
    });
    const prev = initInvestmentState(investment.accounts);
    expect(prev.nisaLifetimeCostBasis.self).toBe(1700);

    const result = stepInvestment(prev, { age: 40, investment });
    // 残枠 1800 − 1700 = 100 万しか積み立てられない(簿価指定時の 200 万より少ない)。
    expect(result.contribution).toBe(100);
  });

  it('taxable 枠で取得価額 < 時価 のとき、取崩時に初期保有の評価益へ課税される', () => {
    // 初期保有: 時価 1000 万・取得価額(簿価)600 万 → 含み益 400 万。
    const investment = oneAccount({
      accountType: 'taxable',
      initialHolding: 1000,
      acquisitionCost: 600,
      annualReturn: 0,
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 100 }],
    });
    const prev = initInvestmentState(investment.accounts);
    expect(prev.accounts[0]).toEqual({ value: 1000, costBasis: 600 });

    const result = stepInvestment(prev, { age: 70, investment });

    expect(result.withdrawal).toBe(100);
    // 評価益割合 = (1000 − 600) / 1000 = 0.4、課税対象益 = 100 × 0.4 = 40。
    expect(result.tax).toBeCloseTo(40 * CAPITAL_GAINS_TAX_RATE, 10);
    // 取崩後: 評価額 900、簿価 600 × (1 − 100/1000) = 540。
    expect(result.investmentValue).toBeCloseTo(900, 10);
    expect(result.state.accounts[0]!.costBasis).toBeCloseTo(540, 10);
  });

  it('acquisitionCost 未指定なら初期保有に含み益なし=取崩時課税ゼロ(後方互換)', () => {
    // 取得価額を省略すると時価=簿価(含み益 0)。取崩しても課税されない。
    const investment = oneAccount({
      accountType: 'taxable',
      initialHolding: 1000,
      annualReturn: 0,
      withdrawals: [{ type: 'lumpSum', age: 70, amount: 100 }],
    });
    const prev = initInvestmentState(investment.accounts);
    expect(prev.accounts[0]).toEqual({ value: 1000, costBasis: 1000 });

    const result = stepInvestment(prev, { age: 70, investment });
    expect(result.withdrawal).toBe(100);
    expect(result.tax).toBe(0);
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

describe('stepInvestment の accountValuesBeforeWithdrawal(取崩前評価額。#72)', () => {
  it('取崩処理の適用前(運用成長後)の枠評価額を返す。取崩後の state.value より大きい', () => {
    // 課税枠: 初期保有 1000 万・利回り 10%・当年に 200 万を一括取崩。
    const prev = initInvestmentState([makeAccount({ accountType: 'taxable', initialHolding: 1000 })]);
    const investment = oneAccount({
      accountType: 'taxable',
      initialHolding: 1000,
      annualReturn: 10,
      startAge: 30,
      endAge: 30, // 積立なし
      withdrawals: [{ type: 'lumpSum', age: 31, amount: 200 }],
    });

    const result = stepInvestment(prev, { age: 31, investment });

    // 成長後 = 1000 × 1.10 = 1100(取崩前)。
    expect(result.accountValuesBeforeWithdrawal).toHaveLength(1);
    expect(result.accountValuesBeforeWithdrawal[0]!).toBeCloseTo(1100, 6);
    // 取崩後の評価額は 1100 − 200 = 900 で、取崩前より小さい。
    expect(result.state.accounts[0]!.value).toBeCloseTo(900, 6);
    expect(result.withdrawal).toBeCloseTo(200, 6);
  });

  it('accounts と同順・同数の配列を返す', () => {
    const prev = initInvestmentState([
      makeAccount({ accountType: 'taxable', initialHolding: 1000 }),
      makeAccount({ accountType: 'taxable', initialHolding: 500 }),
    ]);
    const investment: InvestmentInput = {
      accounts: [
        makeAccount({ accountType: 'taxable', initialHolding: 1000, annualReturn: 0 }),
        makeAccount({ accountType: 'taxable', initialHolding: 500, annualReturn: 0 }),
      ],
    };
    const result = stepInvestment(prev, { age: 40, investment });
    expect(result.accountValuesBeforeWithdrawal).toEqual([1000, 500]);
  });
});

describe('investmentAccountValuesBeforeWithdrawal(年次評価額ヘルパ。#72)', () => {
  it('currentAge〜endAge の各年について、取崩適用前の枠評価額を返す', () => {
    // 課税枠: 初期保有 1000 万・利回り 10%・積立なし・31 歳で 200 万を一括取崩。
    const investment = oneAccount({
      accountType: 'taxable',
      initialHolding: 1000,
      annualReturn: 10,
      startAge: 30,
      endAge: 30,
      withdrawals: [{ type: 'lumpSum', age: 31, amount: 200 }],
    });

    const series = investmentAccountValuesBeforeWithdrawal({
      investment,
      currentAge: 30,
      endAge: 32,
    });

    expect(series.map((s) => s.age)).toEqual([30, 31, 32]);
    // 30 歳: 1000 × 1.10 = 1100。
    expect(series[0]!.values[0]!).toBeCloseTo(1100, 6);
    // 31 歳: 1100 × 1.10 = 1210(200 万の取崩を差し引く「前」の値)。
    expect(series[1]!.values[0]!).toBeCloseTo(1210, 6);
    // 32 歳: 前年の取崩(−200)を反映した残高 1010 が成長 → 1010 × 1.10 = 1111。
    expect(series[2]!.values[0]!).toBeCloseTo(1111, 6);
  });

  it('同一枠の他の取り崩し設定(分割取崩)を反映した評価額になる', () => {
    // 30 歳時点 1000 万・利回り 0%。30〜31 歳の分割取崩で毎年残高を均等取崩し。
    const investment = oneAccount({
      accountType: 'taxable',
      initialHolding: 1000,
      annualReturn: 0,
      startAge: 30,
      endAge: 30,
      withdrawals: [{ type: 'spread', startAge: 30, endAge: 31 }],
    });

    const series = investmentAccountValuesBeforeWithdrawal({
      investment,
      currentAge: 30,
      endAge: 32,
    });

    // 30 歳: 取崩前は 1000(この年 500 取崩 → 残 500)。
    expect(series[0]!.values[0]!).toBeCloseTo(1000, 6);
    // 31 歳: 前年の分割取崩を反映して取崩前は 500(この年に残額 500 を取崩 → 残 0)。
    expect(series[1]!.values[0]!).toBeCloseTo(500, 6);
    // 32 歳: 期間末に残高 0。
    expect(series[2]!.values[0]!).toBeCloseTo(0, 6);
  });

  it('複数枠は accounts と同順・同数の values を返す(枠は独立運用)', () => {
    const investment: InvestmentInput = {
      accounts: [
        makeAccount({ accountType: 'taxable', initialHolding: 1000, annualReturn: 0 }),
        makeAccount({ accountType: 'taxable', initialHolding: 500, annualReturn: 0 }),
      ],
    };
    const series = investmentAccountValuesBeforeWithdrawal({
      investment,
      currentAge: 30,
      endAge: 31,
    });
    expect(series).toHaveLength(2);
    expect(series[0]!.values).toEqual([1000, 500]);
    expect(series[1]!.values).toEqual([1000, 500]);
  });

  it('endAge < currentAge の場合は空配列を返す', () => {
    const investment = oneAccount({ accountType: 'taxable', initialHolding: 1000 });
    expect(
      investmentAccountValuesBeforeWithdrawal({ investment, currentAge: 40, endAge: 39 }),
    ).toEqual([]);
  });

  it('startMonth(初年の月割。#51)を運用成長に反映する', () => {
    // 7 月開始 → 初年は 6 ヶ月分(monthFactor 0.5)だけ運用益を計上する。
    const investment = oneAccount({
      accountType: 'taxable',
      initialHolding: 1000,
      annualReturn: 10,
      startAge: 30,
      endAge: 30,
      withdrawals: [],
    });
    const series = investmentAccountValuesBeforeWithdrawal({
      investment,
      currentAge: 30,
      endAge: 30,
      startMonth: 7,
    });
    // 初年は成長益が半分: 1000 × (1 + 0.10 × 0.5) = 1050。
    expect(series[0]!.values[0]!).toBeCloseTo(1050, 6);
  });
});
