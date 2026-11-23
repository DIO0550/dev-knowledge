---
title: Vitest が .claude/worktrees 配下を拾って偽テスト失敗するのを --exclude で防ぐ
tags: [vitest, testing, worktree, exclude, ci-cd]
---

## TL;DR

- Vitest のデフォルト設定は `.claude/` を除外しないため、`.claude/worktrees/` 配下に作られた一時ワークツリーのテストまでスキャンして偽失敗する。
- CLI なら `--exclude '**/.claude/**'` を付け、`vitest.config.ts` なら `configDefaults.exclude` に `**/.claude/**` を追記して除外する。

## 遭遇した問題

Vitest（例：`pnpm test:run`）を実行すると、`.claude/worktrees/` 配下の一時的なワークツリー内のファイルまでスキャン対象に入り、テストが偽失敗する。

- 本体のテストは壊れていないにもかかわらずテスト実行が失敗する。
- 失敗ログに出ているファイルパスが `.claude/worktrees/...` から始まっている。

## 原因

Vitest のデフォルトのファイル探索は `.claude/` を除外対象に含めていない。

Claude Code などがリポジトリ直下の `.claude/worktrees/` に作業用の git worktree を展開すると、別ブランチ・別状態のテストファイルまで Vitest が拾って実行してしまい、本体のコードとは無関係な失敗が発生する。

## 解決

Vitest 実行時に `--exclude '**/.claude/**'` を指定してスキャン対象から外す。

```bash
# NG: .claude/worktrees 配下まで拾って偽失敗する
pnpm vitest run

# OK: .claude 配下を除外する
pnpm vitest run --exclude '**/.claude/**'
```

`package.json` の scripts に組み込んでおくと毎回指定する手間を省ける。

```json
{
  "scripts": {
    "test:run": "vitest run --exclude '**/.claude/**'"
  }
}
```

設定ファイル側で恒久化する場合は、`vitest.config.ts` の `test.exclude` に追加する。`exclude` を直接配列で上書きすると既定の除外設定が消えるため、`configDefaults.exclude` を展開したうえで追記する。

```ts
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
});
```

- worktree に限らず、リポジトリ配下に一時的な作業ツリーを展開するツールを併用している場合は、そのディレクトリも同様に除外パターンへ追加しておくと同種の偽失敗を防げる。

## 参考

- [Configuration - exclude | Vitest](https://vitest.dev/config/#exclude)
