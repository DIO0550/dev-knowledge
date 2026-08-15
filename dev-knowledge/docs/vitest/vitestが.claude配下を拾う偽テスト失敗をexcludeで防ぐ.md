---
title: Vitest が .claude/worktrees 配下を拾って偽テスト失敗するのを --exclude で防ぐ
tags: [vitest, worktree, test, false-positive, exclude, ci]
---

## 遭遇した問題

`pnpm test:run`（Vitest）を実行すると、`.claude/worktrees/` 配下の一時的な
ワークツリーファイルまで Vitest のスキャン対象に入り、テストが偽失敗する。

- 自分が書いたテストは壊れていないのに、赤くなる。
- 失敗しているのは `.claude/worktrees/...` 以下に存在するファイル。

## 原因

Vitest のデフォルトのファイルスキャンは `.claude/` を除外しない。

Claude Code などが作る作業用の git worktree が `.claude/worktrees/` に展開されると、
その中の（別ブランチ・別状態の）テストファイルまで Vitest が拾ってしまい、
本来のプロジェクトとは無関係なテストが実行されて失敗する。

## 解決

Vitest 実行時に `--exclude '**/.claude/**'` を付けてスキャン対象から外す。

```bash
# NG: .claude/worktrees 配下まで拾って偽失敗する
pnpm vitest run

# OK: .claude 配下を除外する
pnpm vitest run --exclude '**/.claude/**'
```

`package.json` の scripts に組み込んでおくと恒久化できる。

```json
{
  "scripts": {
    "test:run": "vitest run --exclude '**/.claude/**'"
  }
}
```

CLI ではなく設定ファイルに寄せたい場合は、`vitest.config.ts` の
`test.exclude` に同じパターンを追加する（`exclude` を上書きすると
デフォルト除外が消えるので、既定値を残したまま追記する）。

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
```

## メモ

- 症状の見分け方: 失敗ファイルのパスが `.claude/worktrees/` から始まっていれば本件。
- worktree に限らず、リポジトリ直下に一時的な作業ツリーを展開するツールを
  併用しているときは、そのディレクトリを除外パターンに足すと同種の偽失敗を防げる。
