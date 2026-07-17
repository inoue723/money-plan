/**
 * F-01 基本情報セクション(#9)。
 *
 * 現在年齢 / 終了年齢 / 預金 / 配偶者有無(有→年齢・収入) /
 * 子ども人数と年齢・進路 / 居住地域 を入力する。値は #8 の setter 経由でストアへ反映する。
 *
 * 子どもは「既に生まれている子ども(現在の年齢を入力)」に加えて、
 * 「将来生まれる予定の子ども(誕生時の本人年齢を入力)」も登録できる(#32)。
 * ストアには誕生年基準の `bornAtParentAge` で保持する。
 */
import { useState } from 'react';
import type { Child } from '@money-plan/finance-core';
import {
  createDefaultSpouse,
  isArrayItemDirty,
  useSavedInput,
  useSimulationStore,
} from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { SelectField } from '../../components/SelectField';
import { ToggleField } from '../../components/ToggleField';
import { EducationFields } from './EducationFields';
import { DEFAULT_EDUCATION_PLAN } from './educationDefaults';

/** 居住地域(v1では住民税一律のため計算未使用。UI 表示のみ)。 */
const PREFECTURES = [
  '北海道',
  '青森県',
  '岩手県',
  '宮城県',
  '秋田県',
  '山形県',
  '福島県',
  '茨城県',
  '栃木県',
  '群馬県',
  '埼玉県',
  '千葉県',
  '東京都',
  '神奈川県',
  '新潟県',
  '富山県',
  '石川県',
  '福井県',
  '山梨県',
  '長野県',
  '岐阜県',
  '静岡県',
  '愛知県',
  '三重県',
  '滋賀県',
  '京都府',
  '大阪府',
  '兵庫県',
  '奈良県',
  '和歌山県',
  '鳥取県',
  '島根県',
  '岡山県',
  '広島県',
  '山口県',
  '徳島県',
  '香川県',
  '愛媛県',
  '高知県',
  '福岡県',
  '佐賀県',
  '長崎県',
  '熊本県',
  '大分県',
  '宮崎県',
  '鹿児島県',
  '沖縄県',
];

export function BasicSection() {
  const basic = useSimulationStore((s) => s.input.basic);
  const family = useSimulationStore((s) => s.input.family);
  const setBasic = useSimulationStore((s) => s.setBasic);
  const setFamily = useSimulationStore((s) => s.setFamily);
  // 未保存の子ども(アイテム)ハイライト用に、保存済みの子どもリストを取得する(#74)。
  const savedChildren = useSavedInput()?.family.children;

  // 居住地域は現行の計算に未使用のためローカル state のみで保持する(SPEC.md 2.2 F-01 の項目網羅用)。
  const [prefecture, setPrefecture] = useState('東京都');

  const hasSpouse = family.spouse !== undefined;

  // 計算開始年月(#51)。未設定の保存済みプランは表示上は当月を初期値とする。
  const now = new Date();
  const startYear = basic.startYear ?? now.getFullYear();
  const startMonth = basic.startMonth ?? now.getMonth() + 1;

  const updateChild = (index: number, patch: Partial<Child>) => {
    const children = family.children.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setFamily({ children });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="計算開始年"
          value={startYear}
          onChange={(v) => setBasic({ startYear: v })}
          min={1900}
          max={2200}
          unit="年"
          required
        />
        <SelectField
          label="計算開始月"
          value={String(startMonth)}
          options={Array.from({ length: 12 }, (_, i) => ({
            value: String(i + 1),
            label: `${i + 1}月`,
          }))}
          onChange={(v) => setBasic({ startMonth: Number(v) })}
          hint="初年はこの月から12月までを月割で計算"
        />
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
      </div>

      <SelectField
        label="居住地域"
        value={prefecture}
        options={PREFECTURES.map((p) => ({ value: p, label: p }))}
        onChange={setPrefecture}
        hint="v1では住民税を一律計算(地域差は将来対応)"
      />

      {/* 配偶者(有無・年齢のみ。収入は「収入」セクションで本人と同じUIで入力する。#49) */}
      <div className="rounded-md bg-slate-50 p-2">
        <ToggleField
          label="配偶者あり"
          checked={hasSpouse}
          onChange={(checked) =>
            setFamily({ spouse: checked ? createDefaultSpouse(basic.currentAge) : undefined })
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
          </div>
        )}
        {family.spouse && (
          <p className="mt-2 text-[11px] text-slate-400">
            配偶者の収入は「収入」セクションで入力します。
          </p>
        )}
      </div>

      {/* 子ども */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">
            子ども({family.children.length}人)
          </span>
          <button
            type="button"
            onClick={() =>
              setFamily({
                children: [
                  ...family.children,
                  { bornAtParentAge: basic.currentAge, education: DEFAULT_EDUCATION_PLAN },
                ],
              })
            }
            className="rounded-md border border-sky-300 px-2 py-0.5 text-xs font-medium text-sky-600 hover:bg-sky-50"
          >
            + 追加
          </button>
        </div>
        {family.children.map((child, i) => {
          // bornAtParentAge が現在年齢より大きい = まだ生まれていない(将来生まれる)子ども。
          const isFuture = child.bornAtParentAge > basic.currentAge;
          const dirty = isArrayItemDirty(child, savedChildren, i);
          return (
            <div
              key={i}
              className={`rounded-md border p-2 ${dirty ? 'border-sky-400' : 'border-slate-200'}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">子ども {i + 1}</span>
                <button
                  type="button"
                  onClick={() => setFamily({ children: family.children.filter((_, j) => j !== i) })}
                  className="rounded-md border border-rose-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50"
                >
                  削除
                </button>
              </div>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <SelectField
                  label="生まれている?"
                  value={isFuture ? 'future' : 'born'}
                  options={[
                    { value: 'born', label: '既に生まれている' },
                    { value: 'future', label: '将来生まれる予定' },
                  ]}
                  onChange={(v) =>
                    updateChild(i, {
                      // 切替時の初期値: 既に生まれている → 0歳、将来 → 来年誕生。
                      bornAtParentAge: v === 'future' ? basic.currentAge + 1 : basic.currentAge,
                    })
                  }
                />
                {isFuture ? (
                  <NumberField
                    label="誕生時のあなたの年齢"
                    value={child.bornAtParentAge}
                    onChange={(v) => updateChild(i, { bornAtParentAge: v })}
                    min={basic.currentAge + 1}
                    max={100}
                    unit="歳"
                    hint={`${child.bornAtParentAge - basic.currentAge}年後に誕生`}
                  />
                ) : (
                  <NumberField
                    label="現在の年齢"
                    value={basic.currentAge - child.bornAtParentAge}
                    onChange={(v) => updateChild(i, { bornAtParentAge: basic.currentAge - v })}
                    min={0}
                    max={30}
                    unit="歳"
                  />
                )}
              </div>
              <EducationFields
                value={child.education}
                onChange={(education) => updateChild(i, { education })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
