import { describe, expect, it } from 'vitest';

import { educationCostForAge, totalEducationCost } from './education';
import { EDUCATION_COST, UNIVERSITY_COST } from './constants/education2026';
import type { Child, EducationPlan } from './types';

/** 全区分を公立、大学は国公立にした基準プラン。 */
const publicPlan: EducationPlan = {
  preschool: 'public',
  elementary: 'public',
  juniorHigh: 'public',
  highSchool: 'public',
  university: 'national',
};

/** 全区分を私立、大学は私立理系にしたプラン。 */
const privatePlan: EducationPlan = {
  preschool: 'private',
  elementary: 'private',
  juniorHigh: 'private',
  highSchool: 'private',
  university: 'privateScience',
};

describe('educationCostForAge — 区分の境界年齢', () => {
  it('未就学(0〜5歳)は preschool テーブルを返す', () => {
    expect(educationCostForAge(publicPlan, 0)).toBe(EDUCATION_COST.preschool.public);
    expect(educationCostForAge(publicPlan, 5)).toBe(EDUCATION_COST.preschool.public);
  });

  it('小学校(6〜11歳)は elementary テーブルを返す', () => {
    expect(educationCostForAge(publicPlan, 6)).toBe(EDUCATION_COST.elementary.public);
    expect(educationCostForAge(publicPlan, 11)).toBe(EDUCATION_COST.elementary.public);
  });

  it('中学校(12〜14歳)は juniorHigh テーブルを返す', () => {
    expect(educationCostForAge(publicPlan, 12)).toBe(EDUCATION_COST.juniorHigh.public);
    expect(educationCostForAge(publicPlan, 14)).toBe(EDUCATION_COST.juniorHigh.public);
  });

  it('高校(15〜17歳)は highSchool テーブルを返す', () => {
    expect(educationCostForAge(publicPlan, 15)).toBe(EDUCATION_COST.highSchool.public);
    expect(educationCostForAge(publicPlan, 17)).toBe(EDUCATION_COST.highSchool.public);
  });

  it('大学(18〜21歳)は UNIVERSITY_COST を返す', () => {
    expect(educationCostForAge(publicPlan, 18)).toBe(UNIVERSITY_COST.national);
    expect(educationCostForAge(publicPlan, 21)).toBe(UNIVERSITY_COST.national);
  });

  it('範囲外(負の年齢・22歳以降)は 0', () => {
    expect(educationCostForAge(publicPlan, -1)).toBe(0);
    expect(educationCostForAge(publicPlan, 22)).toBe(0);
    expect(educationCostForAge(publicPlan, 30)).toBe(0);
  });
});

describe('educationCostForAge — 公私の切替', () => {
  it('各区分で公立/私立が正しく切り替わる', () => {
    expect(educationCostForAge(privatePlan, 3)).toBe(EDUCATION_COST.preschool.private);
    expect(educationCostForAge(privatePlan, 8)).toBe(EDUCATION_COST.elementary.private);
    expect(educationCostForAge(privatePlan, 13)).toBe(EDUCATION_COST.juniorHigh.private);
    expect(educationCostForAge(privatePlan, 16)).toBe(EDUCATION_COST.highSchool.private);
  });

  it('同じ年齢でも進路選択で異なる値を返す(小学校)', () => {
    expect(educationCostForAge(publicPlan, 8)).toBe(EDUCATION_COST.elementary.public);
    expect(educationCostForAge(privatePlan, 8)).toBe(EDUCATION_COST.elementary.private);
    expect(EDUCATION_COST.elementary.public).not.toBe(EDUCATION_COST.elementary.private);
  });
});

describe('educationCostForAge — 大学の種別', () => {
  const withUniversity = (university: EducationPlan['university']): EducationPlan => ({
    ...publicPlan,
    university,
  });

  it('国公立/私立文系/私立理系で対応するテーブル値を返す', () => {
    expect(educationCostForAge(withUniversity('national'), 19)).toBe(UNIVERSITY_COST.national);
    expect(educationCostForAge(withUniversity('privateLiberal'), 19)).toBe(
      UNIVERSITY_COST.privateLiberal,
    );
    expect(educationCostForAge(withUniversity('privateScience'), 19)).toBe(
      UNIVERSITY_COST.privateScience,
    );
  });

  it('進学しない(none)場合は大学年齢でも 0', () => {
    expect(educationCostForAge(withUniversity('none'), 18)).toBe(0);
    expect(educationCostForAge(withUniversity('none'), 21)).toBe(0);
  });
});

describe('totalEducationCost — 複数の子の合計', () => {
  it('子が居なければ 0', () => {
    expect(totalEducationCost([])).toBe(0);
  });

  it('各子の教育費を合算する', () => {
    const children: Child[] = [
      { age: 8, education: publicPlan }, // 小学校・公立
      { age: 16, education: privatePlan }, // 高校・私立
      { age: 25, education: publicPlan }, // 範囲外 → 0
    ];
    const expected =
      EDUCATION_COST.elementary.public + EDUCATION_COST.highSchool.private + 0;
    expect(totalEducationCost(children)).toBe(expected);
  });

  it('大学生を含む合計', () => {
    const children: Child[] = [
      { age: 19, education: publicPlan }, // 大学・国公立
      { age: 3, education: privatePlan }, // 未就学・私立
    ];
    const expected = UNIVERSITY_COST.national + EDUCATION_COST.preschool.private;
    expect(totalEducationCost(children)).toBe(expected);
  });
});
