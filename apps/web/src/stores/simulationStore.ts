/**
 * シミュレーションの状態管理ストア(Zustand。SPEC.md 4.2)。
 *
 * ## 設計方針(issue #8)
 * - state は `SimulationInput` 全体を保持する。計算結果(`SimulationResult`)は
 *   **入力の派生**として算出し、別 state として二重管理しない(SPEC.md 4.4 / issue 技術方針)。
 * - 各セクション(basic / family / income / expense / events / investment)に対して
 *   型安全な部分更新 setter を提供する。setter は必ず `input` オブジェクトの参照を
 *   新しくすることで、下記の派生セレクタのメモ化が正しく無効化される。
 * - 結果は `useSimulationResult()` から取得する。`runSimulation` の呼び出しは
 *   入力の参照が変わったときだけ行い(メモ化)、入力変更→即時再計算のパイプラインを
 *   100ms 以内(SPEC.md 5)で回す前提の実装とする。
 * - `selectedYear`(年次詳細で選択中の年)も保持する。#10(グラフ)がクリックで設定し、
 *   #11(年次内訳)が購読する共有 state。
 */
import { create } from 'zustand';
import { runSimulation } from '@money-plan/finance-core';
import type {
  BasicInput,
  ExpenseInput,
  FamilyInput,
  IncomeInput,
  InvestmentInput,
  LifeEvent,
  SimulationInput,
  SimulationResult,
} from '@money-plan/finance-core';

// ---------------------------------------------------------------------------
// デフォルト入力(SPEC.md 2.2 の各デフォルト値)
// ---------------------------------------------------------------------------

/** SPEC.md 2.2 のデフォルト値に基づく初期入力。金額は万円、率は %。 */
export const DEFAULT_INPUT: SimulationInput = {
  basic: {
    currentAge: 30, // シミュレーション起点(18〜80)
    endAge: 90, // SPEC.md 2.2 デフォルト 90 歳
    savings: 300, // 現在の預金残高(万円)
    investments: 0, // SPEC.md 2.2 デフォルト 0
  },
  family: {
    spouse: undefined, // 配偶者なし
    children: [],
  },
  income: {
    // 働き方期間: 現在年齢〜65歳・会社員の1期間(現行デフォルト相当。#30)
    workPeriods: [
      {
        startAge: 30, // 開始年齢(= デフォルトの現在年齢)
        endAge: 65, // 65 歳まで働く
        workStyle: 'employee', // 会社員
        income: 500, // 年収(額面・万円)
        raiseRate: 1.0, // SPEC.md 2.2 デフォルト 1.0%
      },
    ],
    retirementBonus: 0,
    pension: 150, // 年金受給額(年額・万円)の概算目安値
    other: 0,
  },
  expense: {
    rent: 8, // 家賃(月額・万円)
    living: 15, // 生活費(月額・万円)
    insurance: 1, // 保険料(月額・万円)
    fixed: 2, // その他固定費(月額・万円)
    inflationRate: 1.0, // SPEC.md 2.2 デフォルト 1.0%
  },
  events: [],
  investment: {
    // デフォルトは現行相当の 1 枠(NISA)。SPEC.md 2.2 の各デフォルト値に準拠。
    accounts: [
      {
        name: 'NISA',
        accountType: 'nisa', // NISA 利用(非課税枠内の運用益を非課税)
        monthlyAmount: 0, // SPEC.md 2.2 デフォルト 0
        annualReturn: 3.0, // SPEC.md 2.2 デフォルト 3.0%
        startAge: 30, // 積立開始年齢。デフォルトは現在年齢(30)
        endAge: 65, // 積立終了年齢。デフォルトは退職年齢(65)
        withdrawal: undefined,
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// ストア定義
// ---------------------------------------------------------------------------

export interface SimulationState {
  /** 入力一式(唯一の真実。結果はここから派生する)。 */
  input: SimulationInput;
  /** 年次詳細で選択中の年(西暦)。未選択は null。#10 が設定し #11 が購読する。 */
  selectedYear: number | null;

  /** F-01 基本情報の部分更新。 */
  setBasic: (patch: Partial<BasicInput>) => void;
  /** F-01 家族構成の部分更新。 */
  setFamily: (patch: Partial<FamilyInput>) => void;
  /** F-02 収入情報の部分更新。 */
  setIncome: (patch: Partial<IncomeInput>) => void;
  /** F-03 支出情報の部分更新。 */
  setExpense: (patch: Partial<ExpenseInput>) => void;
  /** F-05 投資設定の部分更新。 */
  setInvestment: (patch: Partial<InvestmentInput>) => void;
  /** F-04 ライフイベント一覧の置き換え。 */
  setEvents: (events: LifeEvent[]) => void;
  /** 入力一式をデフォルトへ戻す。 */
  resetInput: () => void;

  /** 選択年を設定する(#10 のグラフクリック等から)。 */
  setSelectedYear: (year: number | null) => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  input: DEFAULT_INPUT,
  selectedYear: null,

  setBasic: (patch) =>
    set((state) => ({ input: { ...state.input, basic: { ...state.input.basic, ...patch } } })),
  setFamily: (patch) =>
    set((state) => ({ input: { ...state.input, family: { ...state.input.family, ...patch } } })),
  setIncome: (patch) =>
    set((state) => ({ input: { ...state.input, income: { ...state.input.income, ...patch } } })),
  setExpense: (patch) =>
    set((state) => ({ input: { ...state.input, expense: { ...state.input.expense, ...patch } } })),
  setInvestment: (patch) =>
    set((state) => ({
      input: { ...state.input, investment: { ...state.input.investment, ...patch } },
    })),
  setEvents: (events) => set((state) => ({ input: { ...state.input, events } })),
  resetInput: () => set({ input: DEFAULT_INPUT, selectedYear: null }),

  setSelectedYear: (year) => set({ selectedYear: year }),
}));

// ---------------------------------------------------------------------------
// 派生セレクタ(結果は入力からメモ化算出)
// ---------------------------------------------------------------------------

/**
 * `runSimulation` のメモ化ラッパ。入力の参照が前回と同じなら再計算せず前回結果を返す。
 * setter が `input` の参照を必ず更新するため、入力変更時のみ再計算される。
 */
let cachedInput: SimulationInput | null = null;
let cachedResult: SimulationResult = [];

const selectResult = (state: SimulationState): SimulationResult => {
  if (state.input !== cachedInput) {
    cachedInput = state.input;
    cachedResult = runSimulation(state.input);
  }
  return cachedResult;
};

/**
 * シミュレーション結果を購読するフック。
 * 入力が変わったときのみ `runSimulation` が走り、結果の参照も安定する(メモ化)。
 * 後続チケット(#10 グラフ / #11 年次内訳)は本フックを唯一の結果入口として使う。
 */
export const useSimulationResult = (): SimulationResult => useSimulationStore(selectResult);
