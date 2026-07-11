# #002 シミュレーション計算エンジンの実装

- ステータス: Todo
- 優先度: 高
- 見積: 2〜3日
- 依存: #001(monorepo初期セットアップ)
- 関連仕様: SPEC.md 2.3(シミュレーション機能)、4.4(主要データ型)

## 目的 / 背景

入力データから年次の資産推移を算出する計算エンジンを `packages/finance-core` に実装する。UIから独立した純粋関数群として実装し、単体テスト可能とする。Webアプリの入力フォーム・グラフはこのエンジンの出力に依存するため、機能実装の中核かつ最優先となる。

## スコープ

### やること

- 入出力の型定義(SPEC.md 4.4 の `SimulationInput` / `YearlyResult` を基に実装)
- 年次シミュレーション本体(`simulation.ts`)
  - 現在年齢から終了年齢まで1年刻みで各年を計算
  - SPEC.md 2.3.1 の計算式(手取り収入・年間収支・預金残高・投資資産・総資産)を実装
- 税金・社会保険料の計算(`tax.ts`) — SPEC.md 2.3.2
  - 給与所得控除、社会保険料(概算料率)、所得税(超過累進 + 復興特別所得税)、住民税
  - 配偶者控除・扶養控除、児童手当、年金受給時の簡易計算
- 教育費モデル(`education.ts`) — SPEC.md 2.3.3
  - 子どもの年齢と進路(公立/私立)に応じた年額教育費の算出
- 投資運用の計算(`investment.ts`) — SPEC.md 2.3.4/2.5
  - 積立・複利運用・取り崩し、課税口座(20.315%)とNISA(非課税)の区別
- ライフイベントの反映(結婚・出産・住宅購入・車購入・一時収支)
- 税率表・料率・教育費テーブル等の定数を年度別に分離(`constants/`)
- 上記すべての単体テスト(Vitest)

### やらないこと

- UI・入力フォーム・グラフ描画(別issue)
- localStorage 等の永続化(別issue)
- 個人事業主向け税計算、住民税の地域差、iDeCo/ふるさと納税(SPEC.md 6章のスコープ外)

## 技術方針

- `packages/finance-core` 内に純粋関数として実装(副作用・DOM/IO依存なし)
- エントリポイントは `runSimulation(input: SimulationInput): YearlyResult[]` を想定
- 定数は `constants/2026.ts` のように年度別ファイルで管理し、税制改正時は定数追加で対応できる構造にする
- 税制はSPEC.md 2.3.2 に従い給与所得者向けの簡易モデルとする(2026年度基準)

## 主要インターフェース(想定)

```typescript
// packages/finance-core/src/index.ts
export function runSimulation(input: SimulationInput): YearlyResult[];

// 内部モジュール
export function calcTax(income: number, deductions: Deductions, year: TaxTable): TaxBreakdown;
export function calcEducationCost(children: Child[], age: number): number;
export function calcInvestment(prev: InvestmentState, params: InvestmentParams): InvestmentState;
```

型の詳細は SPEC.md 4.4 を参照。

## 完了条件(受け入れ基準)

- [ ] `runSimulation` が `SimulationInput` を受け取り、開始年齢〜終了年齢の `YearlyResult[]` を返す
- [ ] 各 `YearlyResult` に SPEC.md 2.3.4 の項目(収入内訳・控除内訳・支出内訳・資産)がすべて含まれる
- [ ] 所得税・住民税・社会保険料の計算が、国税庁の計算例など既知の基準値とテストで一致する(許容誤差を定義)
- [ ] 教育費が子どもの年齢・進路に応じて正しく計上される
- [ ] 投資の複利運用・取り崩し・課税/非課税の区別がテストで検証される
- [ ] ライフイベント(住宅購入で家賃→ローンに切替、出産で教育費・児童手当が発生 等)が結果に反映される
- [ ] `pnpm --filter finance-core test` で全テストがパスする
- [ ] UI・IO への依存がない(import に React やブラウザAPIを含まない)

## テスト観点

- 境界値: 年収0、子ども0人、投資利回り0%、資産がマイナスに転じるケース
- 税計算: 給与所得控除・各種控除の適用有無、累進税率の各ブラケット
- 長期運用: 終了年齢90歳など長期間での複利計算のオーバーフロー・丸め誤差
- ライフイベントが複数年・複数種同時に発生するケース

## メモ

- 計算精度と丸めの方針(円単位/万円単位、四捨五入のタイミング)を実装冒頭で決め、テストの許容誤差に反映する
- 定数の出典(給与所得控除の速算表、教育費の調査データ等)はコメントまたは `constants/` 内のREADMEに記録する
