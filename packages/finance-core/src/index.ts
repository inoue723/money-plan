/**
 * finance-core — 資産推移シミュレーションの計算エンジン(UI非依存)。
 *
 * 税・社会保険料・教育費・投資運用などの純粋関数と、それらを統合した
 * 年次シミュレーション本体(runSimulation)を公開する。
 */

// 入出力の型定義。
export type * from './types';

// 年度別定数テーブル(税率・料率・教育費など)。
export * from './constants';

// シミュレーション本体(公開API。Web 側の唯一の計算入口)。
export { runSimulation } from './simulation';

// 退職所得課税(退職金の退職所得控除・1/2課税・分離課税)の計算関数(#19)。
// 退職金額・勤続年数の引数で完結する汎用関数。#73(iDeCo・小規模企業共済の一時金)でも再利用する。
export {
  calcRetirementIncomeDeduction,
  calcRetirementTax,
  calcRetirementTaxableIncome,
  type RetirementTaxInput,
  type RetirementTaxResult,
} from './tax';

// 投資枠のバリデーション補助(NISA 枠の初期保有額合計を求める。UI の上限警告に使う)。
export { nisaInitialLifetimeUsage } from './investment';

/** workspace 依存の疎通確認用ダミー関数。 */
export const ping = (): string => 'pong';
