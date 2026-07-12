/**
 * 結果パネル(S-01 右メイン領域)。
 *
 * このファイルは後続チケットの空セクションを **合成するだけ** の器。
 * 後続(#10 / #11)は各セクションファイル内で完結させ、この合成点は極力編集しない方針。
 *
 * === セクション合成点(スロット) ===
 *   <SavingsChartSection/>    グラフ: 現預金残高推移 (#29 / features/result/SavingsChartSection.tsx)
 *   <YearDetailSection/>      年次内訳: 選択年の詳細 (#11 / features/result/YearDetailSection.tsx)
 *   <CashflowTableSection/>   CF表: 横=年次・縦=内訳 (#26 / features/result/CashflowTableSection.tsx)
 */
import { useSimulationResult } from '../../stores/simulationStore';
import { CashflowTableSection } from './CashflowTableSection';
import { SavingsChartSection } from './SavingsChartSection';
import { YearDetailSection } from './YearDetailSection';

export function ResultPanel() {
  // 疎通確認用の派生結果。入力変更→即時再計算のパイプラインが動いていることを最小表示する。
  const result = useSimulationResult();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-800">シミュレーション結果</h2>
        <p className="text-sm text-slate-500">
          {/* runSimulation の疎通確認: デフォルト入力で N 年分の結果が算出されている */}
          計算済み: <span className="font-semibold text-slate-700">{result.length}</span> 年分
        </p>
      </div>

      {/* --- スロット合成点(後続チケットはここは触らず各セクション内で実装する)--- */}
      <SavingsChartSection />
      <YearDetailSection />
      <CashflowTableSection />
    </div>
  );
}
