import { describe, expect, it } from 'vitest';

import {
  calcChildAllowance,
  calcChildAllowanceManyen,
  calcIncomeTax,
  calcNetSalary,
  calcPensionDeduction,
  calcPensionTax,
  calcPensionTaxableIncome,
  calcResidentTax,
  calcSalaryIncome,
  calcSalaryIncomeDeduction,
  calcSalaryTax,
  calcSocialInsurance,
} from './tax';

describe('給与所得控除', () => {
  it('速算表どおりに控除額を計算する', () => {
    // 年収 400 万: 収入 × 20% + 44 万 = 124 万
    expect(calcSalaryIncomeDeduction(4_000_000)).toBe(1_240_000);
    // 年収 700 万: 収入 × 10% + 110 万 = 180 万
    expect(calcSalaryIncomeDeduction(7_000_000)).toBe(1_800_000);
    // 年収 1000 万: 上限区分の定数 195 万
    expect(calcSalaryIncomeDeduction(10_000_000)).toBe(1_950_000);
  });

  it('給与所得は収入 − 控除で求まり、0 未満にはならない', () => {
    expect(calcSalaryIncome(4_000_000)).toBe(2_760_000);
    expect(calcSalaryIncome(300_000)).toBe(0); // 収入 < 給与所得控除下限
  });
});

describe('社会保険料', () => {
  it('種別ごとに概算し、合計は内訳の和に一致する', () => {
    const s = calcSocialInsurance(4_000_000);
    expect(s.health).toBe(200_000); // 5.0%
    expect(s.pension).toBe(366_000); // 9.15%
    expect(s.employment).toBe(24_000); // 0.6%
    expect(s.total).toBe(s.health + s.pension + s.employment);
    // 合計はおおむね額面の 15% 前後
    expect(s.total / 4_000_000).toBeGreaterThan(0.13);
    expect(s.total / 4_000_000).toBeLessThan(0.16);
  });

  it('高所得では年間上限(概算 200 万円)で頭打ちになり、内訳の和が total に一致する', () => {
    const s = calcSocialInsurance(30_000_000);
    expect(s.total).toBeLessThanOrEqual(2_000_000);
    expect(s.total).toBeGreaterThan(1_999_000); // 切り捨て誤差の範囲でほぼ上限
    expect(s.health + s.pension + s.employment).toBe(s.total);
  });
});

describe('所得税(復興特別所得税込み)', () => {
  it('課税所得 195 万は 5% 区分 + 復興特別所得税', () => {
    // 1,950,000 × 5% = 97,500、× 1.021 = 99,547.5 → 切り捨て 99,547
    expect(calcIncomeTax(1_950_000)).toBe(99_547);
  });

  it('国税庁の速算例: 課税所得 700 万 → 974,000 円(復興税前)相当', () => {
    // 7,000,000 × 23% − 636,000 = 974,000、× 1.021 = 994,454 → 切り捨て
    expect(calcIncomeTax(7_000_000)).toBe(994_454);
  });

  it('課税所得 0 以下は 0', () => {
    expect(calcIncomeTax(0)).toBe(0);
    expect(calcIncomeTax(-100_000)).toBe(0);
  });
});

describe('住民税', () => {
  it('所得割 10% + 均等割', () => {
    expect(calcResidentTax(2_000_000)).toBe(2_000_000 * 0.1 + 5_000);
  });

  it('課税所得 0 以下は非課税(均等割も課さない)', () => {
    expect(calcResidentTax(0)).toBe(0);
  });
});

describe('給与の総合計算(calcSalaryTax)', () => {
  const cases = [
    { gross: 400, minRate: 0.75, maxRate: 0.82 },
    { gross: 700, minRate: 0.72, maxRate: 0.79 },
    { gross: 1000, minRate: 0.68, maxRate: 0.75 },
  ];

  it.each(cases)('年収 $gross 万(独身)の手取り率が妥当な範囲に収まる', ({ gross, minRate, maxRate }) => {
    const { breakdown, netSalary } = calcSalaryTax({ grossSalary: gross });
    const rate = netSalary / gross;
    expect(rate).toBeGreaterThan(minRate);
    expect(rate).toBeLessThan(maxRate);

    // 内訳の社会保険料合計は各保険料の和に一致する。
    expect(breakdown.socialInsurance).toBeCloseTo(
      breakdown.healthInsurance + breakdown.pensionInsurance + breakdown.employmentInsurance,
      6,
    );

    // 手取り = 額面 − 所得税 − 住民税 − 社会保険料。
    expect(netSalary).toBeCloseTo(
      gross - breakdown.incomeTax - breakdown.residentTax - breakdown.socialInsurance,
      6,
    );
  });

  it('年収 400 万・独身の税額がおおよその想定値に一致する', () => {
    const { breakdown } = calcSalaryTax({ grossSalary: 400 });
    // 所得税 ≈ 8.6 万、住民税 ≈ 17.9 万、社会保険料 ≈ 59 万(万円単位)
    expect(breakdown.incomeTax).toBeCloseTo(8.6274, 2);
    expect(breakdown.residentTax).toBeCloseTo(17.9, 2);
    expect(breakdown.socialInsurance).toBeCloseTo(59.0, 1);
  });

  it('配偶者控除・扶養控除で課税が軽くなる', () => {
    const single = calcSalaryTax({ grossSalary: 700 });
    const withFamily = calcSalaryTax({
      grossSalary: 700,
      hasSpouseDeduction: true,
      dependents: ['specific'], // 特定扶養(大学生年代)
    });
    expect(withFamily.netSalary).toBeGreaterThan(single.netSalary);
    expect(withFamily.breakdown.incomeTax).toBeLessThan(single.breakdown.incomeTax);
    expect(withFamily.breakdown.residentTax).toBeLessThan(single.breakdown.residentTax);
  });

  it('calcNetSalary は calcSalaryTax の手取りと一致する', () => {
    expect(calcNetSalary({ grossSalary: 700 })).toBe(calcSalaryTax({ grossSalary: 700 }).netSalary);
  });
});

describe('児童手当', () => {
  it('0〜2 歳は月 1.5 万、3〜18 歳は月 1 万', () => {
    expect(calcChildAllowance([1])).toBe(15_000 * 12);
    expect(calcChildAllowance([5])).toBe(10_000 * 12);
  });

  it('高校生年代を超える子は対象外', () => {
    expect(calcChildAllowance([19])).toBe(0);
  });

  it('第3子以降は月 3 万の加算(年齢の高い順に出生順を判定)', () => {
    // 子3人(10, 7, 1 歳)→ 第1子 1万, 第2子 1万, 第3子 3万(すべて月額)
    const annual = calcChildAllowance([1, 7, 10]);
    expect(annual).toBe((10_000 + 10_000 + 30_000) * 12);
  });

  it('万円版は年額を 1/10000 する', () => {
    expect(calcChildAllowanceManyen([1])).toBeCloseTo(18, 6);
  });
});

describe('公的年金等控除・年金受給', () => {
  it('65 歳以上は控除が手厚い', () => {
    const under = calcPensionDeduction(2_000_000, 64);
    const over = calcPensionDeduction(2_000_000, 65);
    expect(over).toBeGreaterThan(under);
    // 65 歳以上・年金 330 万以下は控除 110 万
    expect(over).toBe(1_100_000);
  });

  it('雑所得 = 年金収入 − 控除、0 未満にはならない', () => {
    // 65 歳・年金 200 万 → 200 − 110 = 90 万
    expect(calcPensionTaxableIncome(2_000_000, 65)).toBe(900_000);
    // 控除以下の少額年金は雑所得 0
    expect(calcPensionTaxableIncome(500_000, 65)).toBe(0);
  });

  it('控除内に収まる少額年金は所得税・住民税ともに 0(手取り = 受給額)', () => {
    // 65 歳・年金 150 万 → 雑所得 40 万。基礎控除(所得税48万/住民税43万)以下で非課税。
    const { incomeTax, residentTax, netPension } = calcPensionTax({ pension: 150, age: 68 });
    expect(incomeTax).toBe(0);
    expect(residentTax).toBe(0);
    expect(netPension).toBe(150);
  });

  it('課税水準の年金では所得税・住民税が生じ、手取りが受給額を下回る', () => {
    // 年金 250 万・68 歳 → 雑所得 140 万。基礎控除を超え課税される。
    const { incomeTax, residentTax, netPension } = calcPensionTax({ pension: 250, age: 68 });
    expect(incomeTax).toBeGreaterThan(0);
    expect(residentTax).toBeGreaterThan(0);
    expect(netPension).toBeLessThan(250);
    expect(netPension).toBeGreaterThan(230);
  });
});
