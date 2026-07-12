/**
 * 進路プラン(EducationPlan)入力(#9)。
 *
 * 子ども(F-01)および出産イベント(F-04 birth)で共通利用する。各学齢期の公立/私立と
 * 大学の進路区分を選択し、教育費モデル(SPEC.md 2.3.3)の適用に用いる。
 */
import type { EducationPlan, SchoolType, UniversityType } from '@money-plan/finance-core';
import { SelectField } from '../../components/SelectField';

const SCHOOL_OPTIONS = [
  { value: 'public', label: '公立' },
  { value: 'private', label: '私立' },
];

const UNIVERSITY_OPTIONS = [
  { value: 'none', label: '進学しない' },
  { value: 'national', label: '国公立' },
  { value: 'privateLiberal', label: '私立文系' },
  { value: 'privateScience', label: '私立理系' },
];

export interface EducationFieldsProps {
  value: EducationPlan;
  onChange: (plan: EducationPlan) => void;
}

export function EducationFields({ value, onChange }: EducationFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <SelectField
        label="未就学"
        value={value.preschool}
        options={SCHOOL_OPTIONS}
        onChange={(v) => onChange({ ...value, preschool: v as SchoolType })}
      />
      <SelectField
        label="小学校"
        value={value.elementary}
        options={SCHOOL_OPTIONS}
        onChange={(v) => onChange({ ...value, elementary: v as SchoolType })}
      />
      <SelectField
        label="中学校"
        value={value.juniorHigh}
        options={SCHOOL_OPTIONS}
        onChange={(v) => onChange({ ...value, juniorHigh: v as SchoolType })}
      />
      <SelectField
        label="高校"
        value={value.highSchool}
        options={SCHOOL_OPTIONS}
        onChange={(v) => onChange({ ...value, highSchool: v as SchoolType })}
      />
      <SelectField
        label="大学"
        value={value.university}
        options={UNIVERSITY_OPTIONS}
        onChange={(v) => onChange({ ...value, university: v as UniversityType })}
      />
    </div>
  );
}
