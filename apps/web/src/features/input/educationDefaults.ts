/**
 * 進路プラン(EducationPlan)の既定値(#9)。
 *
 * 子ども追加(F-01)・出産イベント登録(F-04 birth)時の初期プラン。
 * すべて公立・大学は国公立とする。UI コンポーネントと分離しておくことで
 * Fast Refresh(react-refresh)の対象をコンポーネントのみに保つ。
 */
import type { EducationPlan } from '@money-plan/finance-core';

export const DEFAULT_EDUCATION_PLAN: EducationPlan = {
  preschool: 'public',
  elementary: 'public',
  juniorHigh: 'public',
  highSchool: 'public',
  university: 'national',
};
