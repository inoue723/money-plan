/**
 * F-01 基本情報セクション(#9)。
 *
 * 現在年齢 / 終了年齢 / 預金 / 投資資産 / 配偶者有無(有→年齢・収入) /
 * 子ども人数と年齢・進路 / 居住地域 を入力する。値は #8 の setter 経由でストアへ反映する。
 */
import { useState } from 'react';
import type { Child } from '@money-plan/finance-core';
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { SelectField } from '../../components/SelectField';
import { ToggleField } from '../../components/ToggleField';
import { EducationFields } from './EducationFields';
import { DEFAULT_EDUCATION_PLAN } from './educationDefaults';

/** 居住地域(v1では住民税一律のため計算未使用。UI 表示のみ)。 */
const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

export function BasicSection() {
  const basic = useSimulationStore((s) => s.input.basic);
  const family = useSimulationStore((s) => s.input.family);
  const setBasic = useSimulationStore((s) => s.setBasic);
  const setFamily = useSimulationStore((s) => s.setFamily);

  // 居住地域は現行の計算に未使用のためローカル state のみで保持する(SPEC.md 2.2 F-01 の項目網羅用)。
  const [prefecture, setPrefecture] = useState('東京都');

  const hasSpouse = family.spouse !== undefined;

  const updateChild = (index: number, patch: Partial<Child>) => {
    const children = family.children.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setFamily({ children });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="現在の年齢"
          value={basic.currentAge}
          onChange={(v) => setBasic({ currentAge: v })}
          min={18}
          max={80}
          unit="歳"
          required
        />
        <NumberField
          label="終了年齢"
          value={basic.endAge}
          onChange={(v) => setBasic({ endAge: v })}
          min={basic.currentAge + 1}
          max={100}
          unit="歳"
          required
        />
        <NumberField
          label="預金残高"
          value={basic.savings}
          onChange={(v) => setBasic({ savings: v })}
          min={0}
          unit="万円"
          required
        />
        <NumberField
          label="投資資産額"
          value={basic.investments}
          onChange={(v) => setBasic({ investments: v })}
          min={0}
          unit="万円"
        />
      </div>

      <SelectField
        label="居住地域"
        value={prefecture}
        options={PREFECTURES.map((p) => ({ value: p, label: p }))}
        onChange={setPrefecture}
        hint="v1では住民税を一律計算(地域差は将来対応)"
      />

      {/* 配偶者 */}
      <div className="rounded-md bg-slate-50 p-2">
        <ToggleField
          label="配偶者あり"
          checked={hasSpouse}
          onChange={(checked) =>
            setFamily({ spouse: checked ? { age: basic.currentAge, income: 0 } : undefined })
          }
        />
        {family.spouse && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="配偶者の年齢"
              value={family.spouse.age}
              onChange={(v) => setFamily({ spouse: { ...family.spouse!, age: v } })}
              min={18}
              max={100}
              unit="歳"
            />
            <NumberField
              label="配偶者の年収"
              value={family.spouse.income}
              onChange={(v) => setFamily({ spouse: { ...family.spouse!, income: v } })}
              min={0}
              unit="万円"
            />
          </div>
        )}
      </div>

      {/* 子ども */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">子ども({family.children.length}人)</span>
          <button
            type="button"
            onClick={() =>
              setFamily({
                children: [...family.children, { age: 0, education: DEFAULT_EDUCATION_PLAN }],
              })
            }
            className="rounded-md border border-sky-300 px-2 py-0.5 text-xs font-medium text-sky-600 hover:bg-sky-50"
          >
            + 追加
          </button>
        </div>
        {family.children.map((child, i) => (
          <div key={i} className="rounded-md border border-slate-200 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="w-24">
                <NumberField
                  label={`子ども ${i + 1} の年齢`}
                  value={child.age}
                  onChange={(v) => updateChild(i, { age: v })}
                  min={0}
                  max={30}
                  unit="歳"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setFamily({ children: family.children.filter((_, j) => j !== i) })
                }
                className="mt-4 rounded-md border border-rose-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50"
              >
                削除
              </button>
            </div>
            <EducationFields
              value={child.education}
              onChange={(education) => updateChild(i, { education })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
