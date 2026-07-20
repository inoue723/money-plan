/**
 * 計算根拠ツリー(CalcNode)— CF表のツールチップ等で「値がどう計算されたか」を表示するための
 * 共通インターフェース。
 *
 * 各計算関数は金額(number)だけでなく、label・計算式・入れ子の根拠を持つ `CalcNode` を返す
 * ことを最終形とする。計算式(formula)は文字列の羅列ではなく、子ノード参照を項として埋め込んだ
 * 構造(`FormulaPart[]`)で持ち、UI 側で「1000万円(課税所得) × 20%(所得税率)」のように表示し、
 * 項をクリックするとその項自身の計算式へドリルダウンできる。
 *
 * ## 移行規約(段階的移行。全計算の移行完了までの過渡ルール)
 * - 既存の `calcXxx` に対して `calcXxxDetailed` を併設する。
 *   - 純粋な葉関数(数値を返すだけ): `calcXxxDetailed` は `CalcNode` を直接返す。
 *   - リッチな結果オブジェクトを返す複合関数: `{ result: XxxResult; explain: CalcNode }` を返す。
 * - 算術は Detailed 側に一本化し、legacy の `calcXxx` は `.value` / `.result` を返す
 *   1行ラッパーにする(値の同一性は既存テストで保証される)。
 * - 全呼び出し元が Detailed 版へ移行したら legacy 関数を削除してよい。
 */

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** ノード値の単位。表示側でフォーマットを切り替える(既定は 'manyen')。 */
export type CalcUnit = 'manyen' | 'yen' | 'year' | 'percent' | 'none';

/** 注記の重要度。info は補足・簡易化の断り、warning は上限超過などのアラート。 */
export type CalcNoteSeverity = 'info' | 'warning';

/** ノードに付ける注記(例: 「控除枠の重複調整は簡易化のため未適用」「NISA上限を超過」)。 */
export interface CalcNote {
  severity: CalcNoteSeverity;
  text: string;
}

/**
 * 計算式(formula)の1項。
 * - `string`: リテラル(括弧・固定係数など。例 '× 1/2', '800万円 + 70万円 × (')。
 * - `{ op?, node }`: 子ノード参照。「値(label)」として表示され(例 '1,000万円(課税退職所得)')、
 *   node が formula か notes を持てば UI 上でクリックしてドリルダウンできる。
 *   `op` は項に先行する演算子('+', '−', '×' など)。`node.hidden` のときは op ごと表示しない。
 */
export type FormulaPart = string | { op?: string; node: CalcNode };

/** 計算根拠ツリーの1ノード。すべての計算関数が最終的にこの形を返す(移行規約はファイルヘッダ参照)。 */
export interface CalcNode {
  /** 表示名(例: '退職所得控除')。 */
  label: string;
  /** 計算結果の値。`unit` の単位で持つ(既定 'manyen')。 */
  value: number;
  /** 値の単位。省略時は 'manyen'。 */
  unit?: CalcUnit;
  /**
   * この値の計算式。子ノード参照を項として埋め込む
   * (例: `[{node: 課税所得}, {op: '×', node: 税率}, {op: '−', node: 控除額}]`)。
   * 入力値そのもの等、根拠を持たない葉ノードでは省略する。
   */
  formula?: FormulaPart[];
  /** 注記(info: 補足・簡易化の断り / warning: アラート)。 */
  notes?: CalcNote[];
  /** true なら親の式の中でこの項を(op ごと)表示しない(結果に影響しない自明な項のノイズ抑制)。 */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// 葉ノードビルダー
// ---------------------------------------------------------------------------

/** 1 万円 = 10,000 円。 */
const YEN_PER_MANYEN = 10_000;

/** 万円の葉ノードを作る。 */
export function manyen(label: string, value: number, extra?: Partial<CalcNode>): CalcNode {
  return { label, value, ...extra };
}

/** 円の値から万円の葉ノードを作る(値は万円に換算して持つ)。 */
export function fromYen(label: string, valueYen: number, extra?: Partial<CalcNode>): CalcNode {
  return { label, value: valueYen / YEN_PER_MANYEN, ...extra };
}

/** 率(%)の葉ノードを作る(`ratePercent` は 20% なら 20)。 */
export function percent(label: string, ratePercent: number, extra?: Partial<CalcNode>): CalcNode {
  return { label, value: ratePercent, unit: 'percent', ...extra };
}

/** 年数の葉ノードを作る。 */
export function years(label: string, value: number, extra?: Partial<CalcNode>): CalcNode {
  return { label, value, unit: 'year', ...extra };
}

// ---------------------------------------------------------------------------
// 表示フォーマッタ(UI・テスト共用)
// ---------------------------------------------------------------------------

/** 数値を桁区切り + 小数2桁までで整形する(端数は丸めるが、計算値そのものは丸めない)。 */
const formatNumber = (value: number): string =>
  value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });

/** ノード値を単位付きで整形する(例: '1,850万円' / '20%' / '35年')。 */
export function formatNodeValue(node: CalcNode): string {
  switch (node.unit ?? 'manyen') {
    case 'manyen':
      return `${formatNumber(node.value)}万円`;
    case 'yen':
      return `${formatNumber(node.value)}円`;
    case 'percent':
      return `${formatNumber(node.value)}%`;
    case 'year':
      return `${formatNumber(node.value)}年`;
    case 'none':
      return formatNumber(node.value);
  }
}

/** 式に埋め込むノード参照の表示形式 `値(label)`(例: '1,850万円(退職金 額面)')。 */
export function formatNodeRef(node: CalcNode): string {
  return `${formatNodeValue(node)}(${node.label})`;
}

/**
 * ノードの計算式を1階層だけ平文化する(テスト・デバッグ用。UI はドリルダウン付きで自前描画する)。
 * hidden の項は op ごとスキップする。formula が無ければ空文字を返す。
 * 例: '1,000万円(課税退職所得) × 20%(所得税率) − 42.75万円(速算控除額)'
 */
export function renderFormula(node: CalcNode): string {
  if (!node.formula) return '';
  const parts: string[] = [];
  for (const part of node.formula) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }
    if (part.node.hidden) continue;
    const ref = formatNodeRef(part.node);
    parts.push(part.op ? `${part.op} ${ref}` : ref);
  }
  return parts.join(' ');
}
