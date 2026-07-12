---
name: implement-issue
description: >-
  GitHub上の実装チケット(Issue)を1件受け取り、mainから作業ブランチを切り、
  Issueの内容を実装し、Pull Requestを作成するワークフロー。ユーザーが
  「Issue #2 を実装して」「このissueをやって」「#002 に着手して」のように
  GitHub Issueの番号やタイトルを指定して実装を依頼したときは、必ずこのskillを使うこと。
  issueの実装・着手・チケット消化・PR作成までを一気通貫で行いたい場合に適用する。
---

# implement-issue

GitHub Issue を1件、mainから派生したブランチ上で実装し、Pull Requestを作成するためのワークフロー。

このリポジトリでは実装作業を GitHub Issue 単位で切り出している。このskillは「1 issue = 1 ブランチ = 1 PR」を徹底し、レビューしやすい単位で変更を積み上げるためのもの。

作業は git worktree 上で行う。これにより、別のissue実装や既存PRのレビューと同じリポジトリを、ブランチ切り替えなしで**並列に**進められる。

## 対象issueの特定

ユーザーは次のいずれかの形で対象を指定する。まず対象issueの番号を1つに確定させる。

- issue番号: `#2`、`2`、「issue 2」
- タイトル・スラッグ: 「monorepoセットアップのissue」→ `gh issue list` でタイトルから該当を探す

番号が分かれば内容を取得する:

```bash
gh issue view <番号> --json number,title,body,url,state,labels
```

複数候補が該当する、または該当が見つからない場合は、`gh issue list` で一覧を提示してユーザーに確認する。**推測で別のissueを実装し始めないこと。**

対象issueがすでに `state: CLOSED` の場合は、その旨を伝えてユーザーに続行意思を確認する(誤って完了済みissueを再実装しないため)。

取得した issue の本文から、特に次を把握する:

- **依存**: 本文に依存issueの記載(例: 「依存: #1」)があれば、`gh issue view <依存番号> --json state` で状態を確認する。未クローズなら着手可否をユーザーに確認する。土台が無い状態で実装するとブランチが破綻するため。
- **スコープ(やること/やらないこと)**: 「やらないこと」に挙がった作業には手を出さない。スコープを越える変更はPRを肥大化させ、issue分割の意図を壊す。
- **完了条件(受け入れ基準)**: これが実装のゴールであり、後で自己検証するチェックリストになる。
- **技術方針**: SPEC.md や既存コードの規約に沿うこと。迷ったら SPEC.md の該当節を読む。

## 手順

ブランチ作成から PR 作成まで、承認を求めず自律的に進めてよい(ユーザーの方針)。push・PR 作成の前に確認を挟む必要はない。

### 1. worktree の作成

複数のissueを並列に進められるよう、実装はメインの作業ツリーではなく **git worktree** 上で行う。メインの作業ツリーはブランチを切り替えずそのまま残せるので、別作業やレビューと衝突しない。

まず最新の main を取得する(fetch のみ。メイン作業ツリーは触らない):

```bash
git fetch origin
```

ブランチ名は issue番号ベースで `feature/<番号>` とする。worktree はリポジトリ外の兄弟ディレクトリに作り、`origin/main` から新ブランチを切る。

- issue `#2` → ブランチ `feature/2`

```bash
BRANCH=feature/2
WT=../money-plan-worktrees/2
git worktree add -b "$BRANCH" "$WT" origin/main
```

#### gitignore対象の必要ファイルをコピー

`.env` などは gitignore されているため `git worktree add` では複製されない。しかしビルド・実行に必要なので、メインの作業ツリーから worktree へコピーする。コピーしないと後続の検証(ビルド・テスト)が環境変数不足で失敗する。

```bash
# メイン作業ツリーで gitignore 対象のうち .env 系の設定ファイルを worktree へコピー
git ls-files --others --ignored --exclude-standard \
  | grep -E '(^|/)\.env' \
  | while read -r f; do
      mkdir -p "$WT/$(dirname "$f")"
      cp "$f" "$WT/$f"
    done
```

`.env` 以外にも gitignore されていて動作に必要なローカル設定ファイル(認証情報、ローカル設定など)があれば、同様にコピーする。判断に迷うものがあればユーザーに確認する。

以降の実装・検証・コミットは、すべて worktree ディレクトリ(`$WT`)内で行う。node_modules は worktree 間で共有されないため、依存関係が必要な場合は worktree 内で `pnpm install` を実行する。

### 2. 実装

issue の「スコープ」「技術方針」に沿って実装する。進め方の指針:

- **完了条件を実装のチェックリストとして使う。** 各受け入れ基準を満たすように作る。
- **既存の規約に合わせる。** 既にコードがあるならその命名・構成・スタイルに寄せる。無ければ SPEC.md 4章(技術スタック・モジュール構成)に従う。
- **「やらないこと」には触れない。** 気づいた別の改善点は、実装に混ぜずPR本文の「補足」やフォローアップとして言及するに留める。
- コミットは意味のある単位で分割してよい。

### 3. 自己検証

PRを出す前に、issue の完了条件を実際に満たしているか検証する。issue に検証コマンド(ビルド・lint・テスト)が書かれていれば実行し、結果を確認する。落ちたら直してから次へ進む。「テストが落ちている」状態でPRを出さない。

検証できた項目・できなかった項目を区別して記録し、PR本文の受け入れ基準チェックリストに正直に反映する。

### 4. push と PR 作成

自己検証まで終えたら、確認を挟まずそのまま push して PR を作成してよい。PR本文には `Closes #<番号>` を含め、マージ時にissueが自動クローズされるようにする。

```bash
git push -u origin "$BRANCH"
gh pr create --base main --head "$BRANCH" \
  --title "<PRタイトル>" --body "<PR本文>"
```

PR タイトルは issue の主題を簡潔に表す(例: `monorepo初期セットアップ (#1)`)。PR 本文は次の構成にする:

```markdown
## 概要
<このPRで何を実装したか。対応issue: #<番号>>

Closes #<番号>

## 変更内容
- <主要な変更点>

## 受け入れ基準
- [x] <issueの完了条件のうち満たしたもの>
- [ ] <未達・別issue送りのもの(理由を添える)>

## 補足
<レビュー時の注意点、スコープ外にした事項など>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

PR作成後、PRのURLをユーザーに伝えて完了とする。

## 完了後

- 作成したPRのURLを報告する。あわせて、作業した worktree のパス(`$WT`)も伝える。
- worktree はPRマージ後に不要になる。掃除する場合は `git worktree remove <path>` で削除できる(このskillでは自動削除せず、ユーザーの判断に委ねる)。
- issueは PR 本文の `Closes #<番号>` によりマージ時に自動クローズされる。マージ前に手動でステータスを更新する必要はない。
