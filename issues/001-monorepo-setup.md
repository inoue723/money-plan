# #001 monorepo初期セットアップ

- ステータス: Todo
- 優先度: 高
- 見積: 0.5〜1日
- 依存: なし(最初に着手するissue)
- 関連仕様: SPEC.md 4.1〜4.3(システム構成・技術スタック・モジュール構成)

## 目的 / 背景

今後の実装(計算エンジン、Webアプリ)の土台となる、pnpm workspace による monorepo の骨組みを構築する。以降の全issueはこの構成の上に実装される。

## スコープ

### やること

- pnpm workspace の初期化(`pnpm-workspace.yaml`、ルート `package.json`)
- ディレクトリ構成の作成
  - `apps/web`(空のViteプロジェクトとして初期化。詳細な画面実装は別issue)
  - `packages/domain`(空のTypeScriptパッケージとして初期化。計算ロジックは別issue)
- `apps/web` から `packages/domain` への workspace 依存が解決できることを確認
- TypeScript の共通設定(ルートの `tsconfig.base.json` を各パッケージが継承)
- Lint / Format ツールの導入(ESLint + Prettier)
- ルートに共通スクリプトを定義(`dev` / `build` / `lint` / `test`)
- `.gitignore` の追加(`node_modules`、`dist` 等)

### やらないこと

- 画面・入力フォーム・グラフの実装(別issue)
- 計算エンジンのロジック実装(別issue)
- CI / デプロイ設定(別issue)

## 技術方針

- パッケージマネージャ: pnpm(workspace 機能を使用)
- ビルドツール: Vite(`apps/web`)
- 言語: TypeScript(strict モード有効)
- ディレクトリ構成は SPEC.md 4.3 に準拠:

```
.
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── apps/
│   └── web/          # React + TypeScript + Vite
└── packages/
    └── domain/       # 計算エンジン(UI非依存)
```

## 完了条件(受け入れ基準)

- [ ] リポジトリルートで `pnpm install` が成功する
- [ ] `pnpm --filter web dev` で Vite 開発サーバーが起動し、初期画面がブラウザで表示される
- [ ] `packages/domain` にダミー関数(例: `export const ping = () => 'pong'`)を置き、`apps/web` から import して画面に表示できる(workspace 依存の疎通確認)
- [ ] ルートで `pnpm build` を実行すると `packages/domain` と `apps/web` がビルドされる
- [ ] ルートで `pnpm lint` が実行でき、エラーなく完了する
- [ ] TypeScript が strict モードで型チェックを通過する

## メモ

- ホスティングは Cloudflare Pages を想定(デプロイ設定は別issue)。ビルド出力ディレクトリの想定は `apps/web/dist`
- テストランナー(Vitest / Playwright)の導入は、対象ロジックが存在する各issueで行う想定。本issueでは最小限のセットアップに留める
