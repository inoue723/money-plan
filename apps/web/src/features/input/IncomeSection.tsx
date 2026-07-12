/**
 * F-02 収入情報セクション(#9)。
 *
 * 本人年収 / 昇給率 / 退職年齢 / 退職金 / 年金受給額 / その他収入 を入力する。
 * 配偶者年収は F-01(配偶者あり時)で入力するためここでは案内のみ表示する。
 */
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';

export function IncomeSection() {
  const income = useSimulationStore((s) => s.input.income);
  const hasSpouse = useSimulationStore((s) => s.input.family.spouse !== undefined);
  const setIncome = useSimulationStore((s) => s.setIncome);

  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="本人の年収(額面)"
        value={income.salary}
        onChange={(v) => setIncome({ salary: v })}
        min={0}
        unit="万円"
        required
        hint="税・社会保険料は自動計算されます"
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="昇給率"
          value={income.raiseRate}
          onChange={(v) => setIncome({ raiseRate: v })}
          min={0}
          max={20}
          step={0.1}
          unit="%"
        />
        <NumberField
          label="退職年齢"
          value={income.retirementAge}
          onChange={(v) => setIncome({ retirementAge: v })}
          min={0}
          max={100}
          unit="歳"
        />
        <NumberField
          label="退職金"
          value={income.retirementBonus}
          onChange={(v) => setIncome({ retirementBonus: v })}
          min={0}
          unit="万円"
        />
        <NumberField
          label="年金受給額(年額)"
          value={income.pension}
          onChange={(v) => setIncome({ pension: v })}
          min={0}
          unit="万円"
        />
      </div>
      <NumberField
        label="その他の収入(年額)"
        value={income.other}
        onChange={(v) => setIncome({ other: v })}
        min={0}
        unit="万円"
        hint="副業・不動産収入など(手取り扱い)"
      />
      <p className="text-[11px] text-slate-400">
        {hasSpouse
          ? '配偶者の年収は「基本情報」で入力します。'
          : '配偶者の年収は「基本情報」で配偶者ありにすると入力できます。'}
      </p>
    </div>
  );
}
