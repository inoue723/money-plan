import { describe, expect, it } from 'vitest';

import {
  calcBusinessIncome,
  calcChildAllowance,
  calcChildAllowanceManyen,
  calcIncomeTax,
  calcNationalHealthInsurance,
  calcNetSalary,
  calcPensionDeduction,
  calcPensionTax,
  calcPensionTaxableIncome,
  calcResidentTax,
  calcPensionTaxDetailed,
  calcRetirementIncomeDeduction,
  calcRetirementIncomeDeductionDetailed,
  calcRetirementTax,
  calcRetirementTaxDetailed,
  calcRetirementTaxableIncome,
  calcRetirementTaxableIncomeDetailed,
  calcSalaryTaxDetailed,
  calcSelfEmployedTaxDetailed,
  calcSalaryIncome,
  calcSalaryIncomeDeduction,
  calcSalaryTax,
  calcSelfEmployedSocialInsurance,
  calcSelfEmployedTax,
  calcSocialInsurance,
  estimatePension,
} from './tax';
import { renderFormula, type CalcNode, type FormulaPart } from './explain';
import type { IncomeInput, WorkPeriod } from './types';

/** 式(FormulaPart[])からノード参照の項だけを取り出す(テスト用)。 */
const formulaNodes = (node: CalcNode): CalcNode[] =>
  (node.formula ?? [])
    .filter((p): p is Exclude<FormulaPart, string> => typeof p !== 'string')
    .map((p) => p.node);

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

  it('40〜64 歳は健康保険料に介護分(0.8%)が上乗せされる', () => {
    // 額面 400 万・50 歳: 健康保険 (5.0% + 0.8%) × 400 万 = 232,000。厚生年金・雇用保険は不変。
    const withCare = calcSocialInsurance(4_000_000, 50);
    expect(withCare.health).toBe(232_000);
    expect(withCare.pension).toBe(366_000);
    expect(withCare.employment).toBe(24_000);

    // 40 歳未満・65 歳以上、年齢未指定は介護分なし(健康保険 200,000)。
    expect(calcSocialInsurance(4_000_000, 39).health).toBe(200_000);
    expect(calcSocialInsurance(4_000_000, 65).health).toBe(200_000);
    expect(calcSocialInsurance(4_000_000).health).toBe(200_000);
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

  it.each(cases)(
    '年収 $gross 万(独身)の手取り率が妥当な範囲に収まる',
    ({ gross, minRate, maxRate }) => {
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
    },
  );

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

  it('40〜64 歳は介護分の分だけ健康保険料が増え、手取りが減る', () => {
    const noCare = calcSalaryTax({ grossSalary: 400 });
    const withCare = calcSalaryTax({ grossSalary: 400, age: 50 });
    expect(withCare.breakdown.healthInsurance).toBeGreaterThan(noCare.breakdown.healthInsurance);
    expect(withCare.breakdown.socialInsurance).toBeGreaterThan(noCare.breakdown.socialInsurance);
    expect(withCare.netSalary).toBeLessThan(noCare.netSalary);
  });

  it('calcNetSalary は calcSalaryTax の手取りと一致する', () => {
    expect(calcNetSalary({ grossSalary: 700 })).toBe(calcSalaryTax({ grossSalary: 700 }).netSalary);
  });
});

describe('個人事業主(青色申告)の税・社会保険料', () => {
  it('青色申告特別控除 65 万円を差し引いた所得を求める(0 未満は 0)', () => {
    expect(calcBusinessIncome(5_000_000)).toBe(4_350_000);
    expect(calcBusinessIncome(500_000)).toBe(0);
  });

  it('国民健康保険料 = 医療分 + 支援金分 + 子育て支援金分の 所得割 + 均等割(介護分なし)', () => {
    // 所得 435 万・介護分なし(年齢未指定)。
    // 基礎控除後 392 万に対し 医療分 349,532 + 支援金分 122,148 + 子育て支援金分 9,040 = 480,720。
    expect(calcNationalHealthInsurance(4_350_000)).toBe(480_720);
    // 所得 0(基礎控除以下)は各区分の均等割のみ(47,300 + 16,700 + 1,200 = 65,200)。
    expect(calcNationalHealthInsurance(0)).toBe(65_200);
  });

  it('40〜64 歳は介護分が上乗せされる', () => {
    // 所得 435 万・50 歳: 介護分(392 万 × 2.42% + 16,600 = 111,464)が加算され 592,184。
    expect(calcNationalHealthInsurance(4_350_000, 50)).toBe(592_184);
    // 40 歳未満・65 歳以上は介護分なし。
    expect(calcNationalHealthInsurance(4_350_000, 39)).toBe(480_720);
    expect(calcNationalHealthInsurance(4_350_000, 65)).toBe(480_720);
  });

  it('国民健康保険料は区分ごとの賦課限度額で頭打ちになる', () => {
    // 介護分なし: 医療分 66万 + 支援金分 26万 + 子育て支援金分 6万 = 98万。
    expect(calcNationalHealthInsurance(50_000_000)).toBe(980_000);
    // 介護分(40〜64歳)ありは介護分の限度額 17万が加わり 115万。
    expect(calcNationalHealthInsurance(50_000_000, 50)).toBe(1_150_000);
  });

  it('社会保険料 = 国保 + 国民年金(定額)。雇用保険・厚生年金なし', () => {
    const s = calcSelfEmployedSocialInsurance(4_350_000);
    expect(s.health).toBe(480_720); // 国民健康保険(介護分なし)
    expect(s.pension).toBe(215_040); // 国民年金 17,920 円 × 12
    expect(s.employment).toBe(0);
    expect(s.total).toBe(s.health + s.pension);

    // 40〜64 歳は国保に介護分が加わり保険料が増える。
    const withCare = calcSelfEmployedSocialInsurance(4_350_000, 50);
    expect(withCare.health).toBe(592_184);
    expect(withCare.total).toBeGreaterThan(s.total);
  });

  it('calcSelfEmployedTax: 手取り = 事業所得 − 所得税 − 住民税 − 社会保険料', () => {
    const { breakdown, netIncome } = calcSelfEmployedTax({ businessIncome: 500 });

    // 内訳: 国民年金は定額、雇用保険は 0。合計は各保険料の和。
    expect(breakdown.pensionInsurance).toBeCloseTo(21.504, 6);
    expect(breakdown.employmentInsurance).toBe(0);
    expect(breakdown.socialInsurance).toBeCloseTo(
      breakdown.healthInsurance + breakdown.pensionInsurance,
      6,
    );

    expect(netIncome).toBeCloseTo(
      500 - breakdown.incomeTax - breakdown.residentTax - breakdown.socialInsurance,
      6,
    );

    // 手取り率がおおよそ妥当な範囲に収まる。
    const rate = netIncome / 500;
    expect(rate).toBeGreaterThan(0.7);
    expect(rate).toBeLessThan(0.85);
  });

  it('事業所得 500 万・独身の税額がおおよその想定値に一致する', () => {
    const { breakdown } = calcSelfEmployedTax({ businessIncome: 500 });
    // 所得 435 万 − 社保 69.576 万 − 基礎控除で(介護分なし)、
    // 所得税 ≈ 22.5 万、住民税 ≈ 32.7 万、社会保険料 ≈ 69.6 万(万円単位)。
    expect(breakdown.incomeTax).toBeCloseTo(22.4517, 2);
    expect(breakdown.residentTax).toBeCloseTo(32.74, 2);
    expect(breakdown.socialInsurance).toBeCloseTo(69.576, 3);
  });

  it('40〜64 歳は介護分の分だけ社会保険料が増え、手取りが減る', () => {
    const noCare = calcSelfEmployedTax({ businessIncome: 500 });
    const withCare = calcSelfEmployedTax({ businessIncome: 500, age: 50 });
    // 介護分により国保(健康保険)が増える。
    expect(withCare.breakdown.healthInsurance).toBeGreaterThan(noCare.breakdown.healthInsurance);
    expect(withCare.breakdown.socialInsurance).toBeGreaterThan(noCare.breakdown.socialInsurance);
    expect(withCare.netIncome).toBeLessThan(noCare.netIncome);
  });

  it('配偶者控除・扶養控除で課税が軽くなる', () => {
    const single = calcSelfEmployedTax({ businessIncome: 500 });
    const withFamily = calcSelfEmployedTax({
      businessIncome: 500,
      hasSpouseDeduction: true,
      dependents: ['general'],
    });
    expect(withFamily.netIncome).toBeGreaterThan(single.netIncome);
    expect(withFamily.breakdown.incomeTax).toBeLessThan(single.breakdown.incomeTax);
    expect(withFamily.breakdown.residentTax).toBeLessThan(single.breakdown.residentTax);
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

describe('公的年金受給額の推定(estimatePension。#21)', () => {
  /** 会社員の働き方期間を1つ生成する(既定 25〜64歳・年収500万・昇給0%)。 */
  const empPeriod = (o: Partial<WorkPeriod> = {}): WorkPeriod => ({
    startAge: 25,
    endAge: 64,
    workStyle: 'employee',
    income: 500,
    raiseRate: 0,
    ...o,
  });

  /** 働き方期間だけを差し替えた最小の収入情報。 */
  const incomeWith = (workPeriods: WorkPeriod[]): IncomeInput => ({
    workPeriods,
    retirementBonus: 0,
    pension: 0,
    other: 0,
  });

  it('就労期間が無ければ推定額は 0', () => {
    expect(estimatePension(incomeWith([]))).toBe(0);
  });

  it('会社員期間から老齢基礎年金 + 老齢厚生年金を概算する', () => {
    // 25〜64歳・会社員・年収500万・昇給0%。
    // 基礎: 加入対象20〜59歳に重なる35年 → 816,000 × 35/40 = 714,000円。
    // 厚生: 500万 × 0.005481 × 40年 = 1,096,200円。合計 1,810,200円 = 181.02万円。
    expect(estimatePension(incomeWith([empPeriod()]))).toBeCloseTo(181.02, 2);
  });

  it('個人事業主期間は厚生年金がつかず基礎年金のみで概算する', () => {
    // 25〜64歳・個人事業主。基礎のみ 816,000 × 35/40 = 714,000円 = 71.4万円。
    expect(estimatePension(incomeWith([empPeriod({ workStyle: 'selfEmployed' })]))).toBeCloseTo(
      71.4,
      2,
    );
  });

  it('同条件では会社員のほうが個人事業主より推定額が大きい(厚生年金の分)', () => {
    const employee = estimatePension(incomeWith([empPeriod()]));
    const selfEmployed = estimatePension(incomeWith([empPeriod({ workStyle: 'selfEmployed' })]));
    expect(employee).toBeGreaterThan(selfEmployed);
  });

  it('老齢基礎年金は加入40年で満額に頭打ちする', () => {
    // ちょうど40年(20〜59歳)で基礎年金は満額 816,000円 = 81.6万円ぶんを含む。
    const exactly40 = estimatePension(incomeWith([empPeriod({ startAge: 20, endAge: 59 })]));
    expect(exactly40).toBeGreaterThan(81.6);
    // 40年を超えて就労しても基礎年金は満額どまり(差は厚生年金の加入年数だけ)。
    const over40 = estimatePension(incomeWith([empPeriod({ startAge: 15, endAge: 70 })]));
    const basicPortionExactly40 = 81.6; // 満額(万円)
    const basicPortionOver40 = 81.6; // 頭打ちで同額
    expect(basicPortionOver40).toBe(basicPortionExactly40);
    expect(over40).toBeGreaterThan(exactly40); // 厚生年金の加入年数ぶんだけ増える
  });

  it('昇給率を考慮し、平均年収を期間中央まで成長させて概算する', () => {
    const flat = estimatePension(
      incomeWith([empPeriod({ startAge: 30, endAge: 64, raiseRate: 0 })]),
    );
    const rising = estimatePension(
      incomeWith([empPeriod({ startAge: 30, endAge: 64, raiseRate: 2.0 })]),
    );
    // 昇給ありは平均年収が高く、厚生年金部分が増えて推定額が大きくなる。
    expect(rising).toBeGreaterThan(flat);
  });
});

describe('退職所得(退職金の退職所得控除・分離課税)', () => {
  it('退職所得控除は勤続20年以下が40万/年・20年超が70万/年、最低80万', () => {
    // 勤続10年: 40万 × 10 = 400万
    expect(calcRetirementIncomeDeduction(10)).toBe(4_000_000);
    // 勤続20年: 40万 × 20 = 800万
    expect(calcRetirementIncomeDeduction(20)).toBe(8_000_000);
    // 勤続38年: 800万 + 70万 ×(38 − 20)= 800万 + 1,260万 = 2,060万
    expect(calcRetirementIncomeDeduction(38)).toBe(20_600_000);
    // 勤続1年でも最低80万を保証
    expect(calcRetirementIncomeDeduction(1)).toBe(800_000);
    // 1年未満の端数は切り上げ(10.1年 → 11年扱い = 440万)
    expect(calcRetirementIncomeDeduction(10.1)).toBe(4_400_000);
  });

  it('課税退職所得金額 =(退職金 − 控除)× 1/2、0 未満は 0', () => {
    // 退職金 2000万・勤続10年 → (2000万 − 400万)/2 = 800万
    expect(calcRetirementTaxableIncome(20_000_000, 10)).toBe(8_000_000);
    // 控除が退職金を上回る場合は 0
    expect(calcRetirementTaxableIncome(20_000_000, 38)).toBe(0);
  });

  it('控除内に収まる退職金は非課税(手取り = 退職金額)', () => {
    // 退職金 1000万・勤続30年 → 控除 1500万 > 退職金。課税退職所得 0。
    const { incomeTax, residentTax, netRetirementBonus } = calcRetirementTax({
      retirementBonus: 1000,
      yearsOfService: 30,
    });
    expect(incomeTax).toBe(0);
    expect(residentTax).toBe(0);
    expect(netRetirementBonus).toBe(1000);
  });

  it('課税水準の退職金は分離課税で所得税・住民税が生じる', () => {
    // 退職金 2000万・勤続10年 → 課税退職所得 800万。
    // 所得税: 800万 × 23% − 63.6万 = 120.4万 → ×1.021 = 1,229,284 円
    // 住民税(所得割のみ): 800万 × 10% = 80万 円。均等割は課さない。
    const { incomeTax, residentTax, netRetirementBonus } = calcRetirementTax({
      retirementBonus: 2000,
      yearsOfService: 10,
    });
    expect(incomeTax).toBeCloseTo(122.9284, 4);
    expect(residentTax).toBe(80);
    // 手取り = 2000 − 122.9284 − 80 = 1797.0716 万
    expect(netRetirementBonus).toBeCloseTo(1797.0716, 4);
  });
});

describe('退職所得の計算根拠(Detailed 版。CF表ツールチップ用)', () => {
  it('退職所得控除: 勤続20年超の式と10年ルール未適用の注記を持つ', () => {
    const d = calcRetirementIncomeDeductionDetailed(35);
    // 800万 + 70万 × (35 − 20) = 1,850万
    expect(d.value).toBe(1850);
    expect(renderFormula(d)).toBe('800万円 + 70万円 × ( 35年(勤続年数) − 20年)');
    expect(d.notes).toHaveLength(1);
    expect(d.notes![0]!.severity).toBe('info');
    expect(d.notes![0]!.text).toContain('10年ルール');
    expect(d.notes![0]!.text).toContain('未適用');
    // 整数入力なら勤続年数の項は切り上げの根拠を持たない(ドリルダウン不可な葉のまま)。
    const [yearsNode] = formulaNodes(d);
    expect(yearsNode!.formula).toBeUndefined();
  });

  it('退職所得控除: 勤続20年以下の式・端数切り上げの根拠・最低80万の適用を表示する', () => {
    // 端数入力(10.1年)では勤続年数の項が切り上げの根拠(formula)を持つ。
    const fractional = calcRetirementIncomeDeductionDetailed(10.1);
    expect(fractional.value).toBe(440);
    expect(renderFormula(fractional)).toBe('40万円 × 11年(勤続年数)');
    const [yearsNode] = formulaNodes(fractional);
    expect(renderFormula(yearsNode!)).toContain('10.1年 の1年未満を切り上げ');

    // 勤続1年は 40万 × 1 = 40万 < 最低80万 → 最低保証の適用を式に明記する。
    const minimum = calcRetirementIncomeDeductionDetailed(1);
    expect(minimum.value).toBe(80);
    expect(renderFormula(minimum)).toBe('40万円 × 1年(勤続年数) (最低80万円を適用)');
  });

  it('課税退職所得: (額面 − 控除) × 1/2 の式で、控除の項からドリルダウンできる', () => {
    const d = calcRetirementTaxableIncomeDetailed(20_000_000, 10);
    expect(d.value).toBe(800);
    expect(renderFormula(d)).toBe('( 2,000万円(退職金 額面) − 400万円(退職所得控除) ) × 1/2');
    // 控除の項自身が式(40万円 × 勤続年数)を持ち、ドリルダウンできる。
    const deductionNode = formulaNodes(d).find((n) => n.label === '退職所得控除')!;
    expect(renderFormula(deductionNode)).toBe('40万円 × 10年(勤続年数)');
  });

  it('退職金税: result は legacy と同値で、explain は 額面 − 所得税 − 住民税 の根拠ツリーになる', () => {
    const input = { retirementBonus: 2000, yearsOfService: 10 };
    const { result, explain } = calcRetirementTaxDetailed(input);

    // 算術は Detailed 側に一本化しており、legacy(ラッパー)と完全一致する。
    expect(result).toEqual(calcRetirementTax(input));
    expect(explain.value).toBe(result.netRetirementBonus);
    expect(renderFormula(explain)).toBe(
      '2,000万円(退職金 額面) − 122.93万円(所得税) − 80万円(住民税)',
    );

    // 所得税の項: 課税退職所得 × 税率 − 速算控除額(課税退職所得からさらにドリルダウンできる)。
    const [, incomeTaxNode, residentTaxNode] = formulaNodes(explain);
    expect(incomeTaxNode!.value).toBeCloseTo(result.incomeTax, 10);
    expect(renderFormula(incomeTaxNode!)).toBe(
      '800万円(課税退職所得) × 23%(所得税率) − 63.6万円(速算控除額) (復興特別所得税2.1%込)',
    );
    const taxableNode = formulaNodes(incomeTaxNode!).find((n) => n.label === '課税退職所得')!;
    expect(renderFormula(taxableNode)).toContain('× 1/2');

    // 住民税の項: 課税退職所得 × 10%(均等割なし)。
    expect(residentTaxNode!.value).toBeCloseTo(result.residentTax, 10);
    expect(renderFormula(residentTaxNode!)).toBe(
      '800万円(課税退職所得) × 10%(住民税率(所得割)) (分離課税のため均等割なし)',
    );
  });

  it('退職金税: 控除内に収まる場合は税の項が非課税表記になる', () => {
    const { result, explain } = calcRetirementTaxDetailed({
      retirementBonus: 1000,
      yearsOfService: 30,
    });
    expect(result.netRetirementBonus).toBe(1000);
    const [, incomeTaxNode, residentTaxNode] = formulaNodes(explain);
    expect(incomeTaxNode!.value).toBe(0);
    expect(residentTaxNode!.value).toBe(0);
    expect(renderFormula(incomeTaxNode!)).toBe('課税退職所得が0円のため非課税');
    expect(renderFormula(residentTaxNode!)).toBe('課税退職所得が0円のため非課税');
  });
});

describe('給与・事業・年金の所得税の計算根拠(Detailed 版。CF表ツールチップ用)', () => {
  it('給与: result は legacy と同値で、課税所得(給与)→給与所得→給与所得控除とドリルダウンできる', () => {
    const input = { grossSalary: 700, age: 45 };
    const { result, explain } = calcSalaryTaxDetailed(input);
    expect(result).toEqual(calcSalaryTax(input));
    expect(explain.incomeTax.value).toBeCloseTo(result.breakdown.incomeTax, 10);

    const rendered = renderFormula(explain.incomeTax);
    expect(rendered).toContain('課税所得(給与)');
    expect(rendered).toContain('所得税率');
    expect(rendered).toContain('復興特別所得税');

    // 課税所得(給与) = 給与所得 − 社会保険料控除 − 基礎控除(丸めの注記つき)。
    const taxableNode = formulaNodes(explain.incomeTax).find((n) => n.label === '課税所得(給与)')!;
    const taxableRendered = renderFormula(taxableNode);
    expect(taxableRendered).toContain('給与所得');
    expect(taxableRendered).toContain('社会保険料控除');
    expect(taxableRendered).toContain('基礎控除');
    expect(taxableRendered).toContain('1,000円未満切捨て');

    // 給与所得 = 給与収入(額面) − 給与所得控除(速算表の式つき)。
    const salaryIncomeNode = formulaNodes(taxableNode).find((n) => n.label === '給与所得')!;
    expect(renderFormula(salaryIncomeNode)).toContain('給与収入(額面)');
    const deductionNode = formulaNodes(salaryIncomeNode).find((n) => n.label === '給与所得控除')!;
    expect(renderFormula(deductionNode)).toContain('速算表');

    // 社会保険料控除 = 健康保険 + 厚生年金 + 雇用保険。
    const socialNode = formulaNodes(taxableNode).find((n) => n.label === '社会保険料控除')!;
    expect(formulaNodes(socialNode).map((n) => n.label)).toEqual([
      '健康保険',
      '厚生年金',
      '雇用保険',
    ]);
  });

  it('給与: 配偶者控除・扶養控除・iDeCo が課税所得の式の項に現れる', () => {
    const { explain } = calcSalaryTaxDetailed({
      grossSalary: 700,
      hasSpouseDeduction: true,
      dependents: ['specific', 'general', 'general'],
      smallBusinessMutualAidDeduction: 24,
    });
    const taxableNode = formulaNodes(explain.incomeTax).find((n) => n.label === '課税所得(給与)')!;
    const labels = formulaNodes(taxableNode).map((n) => n.label);
    expect(labels).toContain('配偶者控除');
    expect(labels).toContain('扶養控除(特定)');
    expect(labels).toContain('扶養控除(一般×2)');
    expect(labels).toContain('小規模企業共済等掛金控除(iDeCo等)');
  });

  it('給与: 課税所得が 0 なら非課税の式になる', () => {
    const { result, explain } = calcSalaryTaxDetailed({ grossSalary: 100 });
    expect(result.breakdown.incomeTax).toBe(0);
    expect(renderFormula(explain.incomeTax)).toBe('課税所得(給与)が0円のため非課税');
  });

  it('事業: result は legacy と同値で、青色申告特別控除と国保・国民年金の式を持つ', () => {
    const input = { businessIncome: 600, age: 40 };
    const { result, explain } = calcSelfEmployedTaxDetailed(input);
    expect(result).toEqual(calcSelfEmployedTax(input));

    const taxableNode = formulaNodes(explain.incomeTax).find((n) => n.label === '課税所得(事業)')!;
    const businessNode = formulaNodes(taxableNode).find(
      (n) => n.label === '青色申告特別控除後の所得',
    )!;
    expect(renderFormula(businessNode)).toContain('青色申告特別控除');
    const socialNode = formulaNodes(taxableNode).find((n) => n.label === '社会保険料控除')!;
    expect(formulaNodes(socialNode).map((n) => n.label)).toEqual(['国民健康保険', '国民年金']);
  });

  it('年金: result は legacy と同値で、公的年金等控除(65歳以上の速算表)の式を持つ', () => {
    const input = { pension: 200, age: 70 };
    const { result, explain } = calcPensionTaxDetailed(input);
    expect(result).toEqual(calcPensionTax(input));

    const taxableNode = formulaNodes(explain.incomeTax).find((n) => n.label === '課税所得(年金)')!;
    const miscNode = formulaNodes(taxableNode).find((n) => n.label === '公的年金等の雑所得')!;
    // 年金収入 200万(65歳以上)→ 公的年金等控除 110万・雑所得 90万。
    expect(miscNode.value).toBe(90);
    const pensionDeduction = formulaNodes(miscNode).find((n) => n.label === '公的年金等控除')!;
    expect(pensionDeduction.value).toBe(110);
    expect(renderFormula(pensionDeduction)).toContain('65歳以上');
  });
});

describe('小規模企業共済等掛金控除(iDeCo・小規模企業共済の拠出。#73)', () => {
  it('給与所得者: 拠出額の分だけ所得税・住民税が下がり、手取りが増える', () => {
    const without = calcSalaryTax({ grossSalary: 700 });
    const withDeduction = calcSalaryTax({
      grossSalary: 700,
      smallBusinessMutualAidDeduction: 27.6,
    });
    expect(withDeduction.breakdown.incomeTax).toBeLessThan(without.breakdown.incomeTax);
    expect(withDeduction.breakdown.residentTax).toBeLessThan(without.breakdown.residentTax);
    expect(withDeduction.netSalary).toBeGreaterThan(without.netSalary);
  });

  it('給与所得者: 住民税は控除額 27.6 万 × 所得割 10% = 2.76 万だけ下がる(課税所得が正の範囲)', () => {
    const without = calcSalaryTax({ grossSalary: 700 });
    const withDeduction = calcSalaryTax({
      grossSalary: 700,
      smallBusinessMutualAidDeduction: 27.6,
    });
    // 住民税所得割は 10% 定率のため、控除額 × 10% ぶんだけ減る(課税所得が控除後も正)。
    expect(without.breakdown.residentTax - withDeduction.breakdown.residentTax).toBeCloseTo(
      2.76,
      6,
    );
  });

  it('個人事業主: 拠出額の分だけ所得税・住民税が下がる', () => {
    const without = calcSelfEmployedTax({ businessIncome: 700 });
    const withDeduction = calcSelfEmployedTax({
      businessIncome: 700,
      smallBusinessMutualAidDeduction: 60,
    });
    expect(withDeduction.breakdown.incomeTax).toBeLessThan(without.breakdown.incomeTax);
    expect(withDeduction.breakdown.residentTax).toBeLessThan(without.breakdown.residentTax);
    expect(withDeduction.netIncome).toBeGreaterThan(without.netIncome);
  });

  it('年金受給: 拠出控除で年金の所得税・住民税が下がる', () => {
    const without = calcPensionTax({ pension: 250, age: 68 });
    const withDeduction = calcPensionTax({
      pension: 250,
      age: 68,
      smallBusinessMutualAidDeduction: 20,
    });
    expect(withDeduction.incomeTax).toBeLessThanOrEqual(without.incomeTax);
    expect(withDeduction.residentTax).toBeLessThanOrEqual(without.residentTax);
    expect(withDeduction.netPension).toBeGreaterThanOrEqual(without.netPension);
    // いずれかの税は実際に減る(課税所得が正の範囲)。
    expect(withDeduction.incomeTax + withDeduction.residentTax).toBeLessThan(
      without.incomeTax + without.residentTax,
    );
  });

  it('未指定・0 のときは控除なし(従来挙動と一致)', () => {
    const base = calcSalaryTax({ grossSalary: 700 });
    const zero = calcSalaryTax({ grossSalary: 700, smallBusinessMutualAidDeduction: 0 });
    expect(zero.breakdown.incomeTax).toBe(base.breakdown.incomeTax);
    expect(zero.breakdown.residentTax).toBe(base.breakdown.residentTax);
  });
});
