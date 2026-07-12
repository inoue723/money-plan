/**
 * 教育費モデル(SPEC.md 2.3.3)。
 *
 * 子ども1人の「その年の年齢」と進路プラン(公立/私立、大学は国公立/私立文系/私立理系)から、
 * その年の年額教育費(万円)を算出する純粋関数群。金額テーブルは
 * `constants/education2026.ts`(設定で上書き可能なデフォルト値)を参照する。
 *
 * シミュレーション本体(SPEC.md T5)が年次ループ内で各子どもの「その年の年齢」を渡して計上する。
 * 本モジュールは UI にも年次ループにも依存しない(index.ts からは公開せず、相対 import で利用する)。
 *
 * 単位: すべて「万円/年」。
 */

import { EDUCATION_COST, UNIVERSITY_COST } from './constants/education2026';
import type { EducationPlan } from './types';

/**
 * 学齢期の対応年齢(SPEC.md 2.3.3)。上限は含む(inclusive)。
 * - 未就学  : 0〜5歳
 * - 小学校  : 6〜11歳
 * - 中学校  : 12〜14歳
 * - 高校    : 15〜17歳
 * - 大学    : 18〜21歳
 * これ以外(未就学前の負の年齢・22歳〜)は教育費 0。
 */
const PRESCHOOL_MAX_AGE = 5;
const ELEMENTARY_MAX_AGE = 11;
const JUNIOR_HIGH_MAX_AGE = 14;
const HIGH_SCHOOL_MAX_AGE = 17;
const UNIVERSITY_MAX_AGE = 21;

/**
 * 進路プランと「その年の年齢」から、その年の年額教育費(万円)を返す。
 *
 * 年齢で学齢期を判定し、対応する区分の公立/私立(大学は種別)テーブル値を返す。
 * 学齢期の範囲外(負の年齢、および 22歳以降)は 0。
 * 大学に進学しない(`university === 'none'`)場合は大学年齢でも 0。
 *
 * @param education 子どもの進路プラン。
 * @param ageThisYear 対象年における子どもの年齢(歳)。
 */
export function educationCostForAge(education: EducationPlan, ageThisYear: number): number {
  if (ageThisYear < 0) return 0;
  if (ageThisYear <= PRESCHOOL_MAX_AGE) return EDUCATION_COST.preschool[education.preschool];
  if (ageThisYear <= ELEMENTARY_MAX_AGE) return EDUCATION_COST.elementary[education.elementary];
  if (ageThisYear <= JUNIOR_HIGH_MAX_AGE) return EDUCATION_COST.juniorHigh[education.juniorHigh];
  if (ageThisYear <= HIGH_SCHOOL_MAX_AGE) return EDUCATION_COST.highSchool[education.highSchool];
  if (ageThisYear <= UNIVERSITY_MAX_AGE) {
    if (education.university === 'none') return 0;
    return UNIVERSITY_COST[education.university];
  }
  return 0;
}

/** 対象年における子どもの状態(年齢と進路プラン)。 */
export interface ChildAtAge {
  /** 対象年における年齢(歳)。 */
  age: number;
  /** 進路プラン。 */
  education: EducationPlan;
}

/**
 * 複数の子どもについて、その年の教育費の合計(万円)を返す。
 *
 * `age` フィールドを「対象年における年齢」として扱う。
 * 年次ループ側で各年の年齢に補正したデータを渡す想定(純粋関数)。
 *
 * @param children 対象年の年齢を保持した子ども一覧。
 */
export function totalEducationCost(children: readonly ChildAtAge[]): number {
  return children.reduce((sum, child) => sum + educationCostForAge(child.education, child.age), 0);
}
