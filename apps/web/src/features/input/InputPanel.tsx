/**
 * 入力パネル(S-01 左サイドパネル。#9)。
 *
 * 基本情報 / 収入 / 支出 / ライフイベント / 投資 の各セクション(F-01〜F-05)を
 * アコーディオンで合成する(SPEC.md 2.2 / 3.2)。各セクションは #8 のストア setter を
 * 呼び、入力変更は既存の即時再計算パイプライン(useSimulationResult)経由で結果に反映される。
 * App.tsx / stores 定義は編集しない方針。
 */
import { useSimulationStore } from '../../stores/simulationStore';
import { Accordion } from '../../components/Accordion';
import { PlanSummary } from '../plan/PlanSummary';
import { BasicSection } from './BasicSection';
import { IncomeSection } from './IncomeSection';
import { ExpenseSection } from './ExpenseSection';
import { EventsSection } from './EventsSection';
import { InvestmentSection } from './InvestmentSection';

export function InputPanel() {
  const eventCount = useSimulationStore((s) => s.input.events.length);

  return (
    <div className="flex flex-col gap-3">
      {/* プラン概要(プラン名の編集・変更の保存/破棄)。入力フィールドの上に配置する。 */}
      <PlanSummary />

      <Accordion title="基本情報" defaultOpen>
        <BasicSection />
      </Accordion>

      <Accordion title="収入">
        <IncomeSection />
      </Accordion>

      <Accordion title="支出">
        <ExpenseSection />
      </Accordion>

      <Accordion
        title="ライフイベント"
        badge={
          eventCount > 0 ? (
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
              {eventCount}
            </span>
          ) : undefined
        }
      >
        <EventsSection />
      </Accordion>

      <Accordion title="投資">
        <InvestmentSection />
      </Accordion>
    </div>
  );
}
