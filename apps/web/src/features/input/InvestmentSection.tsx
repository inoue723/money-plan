/**
 * F-05 投資設定セクション(#9)。
 *
 * 毎月積立額 / 想定利回り(0〜15%)/ 積立終了年齢 / NISA有無 / 取り崩し設定 を入力する。
 * 取り崩し設定は有効化トグルで on/off し、on の場合のみ開始年齢・年間取崩額を入力する。
 */
import { useSimulationStore } from '../../stores/simulationStore';
import { NumberField } from '../../components/NumberField';
import { ToggleField } from '../../components/ToggleField';

export function InvestmentSection() {
  const investment = useSimulationStore((s) => s.input.investment);
  const currentAge = useSimulationStore((s) => s.input.basic.currentAge);
  const setInvestment = useSimulationStore((s) => s.setInvestment);

  const withdrawal = investment.withdrawal;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="毎月の積立額"
          value={investment.monthlyAmount}
          onChange={(v) => setInvestment({ monthlyAmount: v })}
          min={0}
          step={0.1}
          unit="万円"
        />
        <NumberField
          label="想定利回り"
          value={investment.annualReturn}
          onChange={(v) => setInvestment({ annualReturn: v })}
          min={0}
          max={15}
          step={0.1}
          unit="%"
          hint="0〜15%"
        />
        <NumberField
          label="積立終了年齢"
          value={investment.endAge}
          onChange={(v) => setInvestment({ endAge: v })}
          min={currentAge}
          max={100}
          unit="歳"
        />
      </div>

      <ToggleField
        label="NISA利用"
        checked={investment.useNisa}
        onChange={(checked) => setInvestment({ useNisa: checked })}
        hint="非課税枠内の運用益を非課税とする"
      />

      <div className="rounded-md bg-slate-50 p-2">
        <ToggleField
          label="取り崩しを設定する"
          checked={withdrawal !== undefined}
          onChange={(checked) =>
            setInvestment({
              withdrawal: checked ? { startAge: investment.endAge, annualAmount: 0 } : undefined,
            })
          }
          hint="老後の投資資産の取り崩し"
        />
        {withdrawal && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="開始年齢"
              value={withdrawal.startAge}
              onChange={(v) => setInvestment({ withdrawal: { ...withdrawal, startAge: v } })}
              min={currentAge}
              max={100}
              unit="歳"
            />
            <NumberField
              label="年間取崩額"
              value={withdrawal.annualAmount}
              onChange={(v) => setInvestment({ withdrawal: { ...withdrawal, annualAmount: v } })}
              min={0}
              unit="万円"
            />
          </div>
        )}
      </div>
    </div>
  );
}
