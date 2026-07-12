/**
 * F-03 支出情報セクション(#9)。
 *
 * 家賃 / 生活費 / 保険料 / その他固定費(いずれも月額)/ 物価上昇率 を入力する。
 */
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';

export function ExpenseSection() {
  const expense = useSimulationStore((s) => s.input.expense);
  const setExpense = useSimulationStore((s) => s.setExpense);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="家賃(月額)"
          value={expense.rent}
          onChange={(v) => setExpense({ rent: v })}
          min={0}
          unit="万円"
          required
          hint="持ち家は 0"
        />
        <NumberField
          label="生活費(月額)"
          value={expense.living}
          onChange={(v) => setExpense({ living: v })}
          min={0}
          unit="万円"
          required
          hint="食費・光熱費・通信費など"
        />
        <NumberField
          label="保険料(月額)"
          value={expense.insurance}
          onChange={(v) => setExpense({ insurance: v })}
          min={0}
          unit="万円"
        />
        <NumberField
          label="その他固定費(月額)"
          value={expense.fixed}
          onChange={(v) => setExpense({ fixed: v })}
          min={0}
          unit="万円"
          hint="サブスク・駐車場代など"
        />
      </div>
      <NumberField
        label="物価上昇率"
        value={expense.inflationRate}
        onChange={(v) => setExpense({ inflationRate: v })}
        min={0}
        max={20}
        step={0.1}
        unit="%"
        hint="生活費・家賃に適用"
      />
    </div>
  );
}
