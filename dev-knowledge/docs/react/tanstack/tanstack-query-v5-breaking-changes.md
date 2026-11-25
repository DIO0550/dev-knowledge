---
title: TanStack Query v4 から v5 への移行で押さえる破壊的変更
tags: [react, tanstack-query, migration, typescript]
---

## TL;DR

- 引数はオブジェクト 1 つだけになった（`useQuery(key, fn, options)` は不可）。公式 codemod で大半を機械的に直せる。
- 名前の変更が多い。`cacheTime` → `gcTime`、`useErrorBoundary` → `throwOnError`、`status: 'loading'` → `'pending'`、`isLoading` → `isPending`（v5 の `isLoading` は旧 `isInitialLoading`）、`keepPreviousData` → `placeholderData: keepPreviousData`。
- `useQuery` の `onSuccess` / `onError` / `onSettled` は削除された（mutation は残る）。グローバル処理は `QueryCache` のコールバックへ、状態同期は `data` からの導出へ移す。
- Suspense は専用 hook（`useSuspenseQuery` など）になり、`suspense: true` フラグは削除。React 18 以上と TypeScript 4.7 以上が必須。

## 概要・対象

TanStack Query（React）v4 から v5 への移行時に影響の大きい破壊的変更と、その移行方法をまとめる。確認したのは公式の移行ガイド（main ブランチ）と `@tanstack/react-query` 5.108.4 のソース（確認日 2026-11）。

## 仕組み・仕様

### 主な破壊的変更

| 変更 | v4 | v5 |
| --- | --- | --- |
| 呼び出しシグネチャ | `useQuery(key, fn, opts)` などのオーバーロード | `useQuery({ queryKey, queryFn, ...opts })` のみ。`queryClient` のメソッドや `useIsFetching` なども同様 |
| GC 時間の名前 | `cacheTime` | `gcTime` |
| ErrorBoundary 連携 | `useErrorBoundary` | `throwOnError` |
| 状態名 | `status: 'loading'` / `isLoading` | `status: 'pending'` / `isPending`（mutation も同様） |
| 初回取得中フラグ | `isInitialLoading` | `isLoading`（`isPending && isFetching`）。`isInitialLoading` は非推奨 |
| 前データ保持 | `keepPreviousData: true` / `isPreviousData` | `placeholderData: keepPreviousData` / `isPlaceholderData` |
| クエリのコールバック | `onSuccess` / `onError` / `onSettled` | 削除（`useMutation` には残る） |
| Suspense | `suspense: true` オプション | `useSuspenseQuery` / `useSuspenseQueries` / `useSuspenseInfiniteQuery` |
| エラーの既定型 | `unknown` | `Error` |
| 無限クエリ | `pageParam = 0` を `queryFn` の引数既定値で書く | `initialPageParam` が必須 |
| その他削除 | `remove()`、`isDataEqual`、カスタム `logger`、`context` prop、`contextSharing` | 削除 |
| 動作環境 | React 16.8 以上 | React 18 以上（`useSyncExternalStore` を使うため）、TypeScript 4.7 以上 |

挙動の変更としては、フォーカス時再取得が `focus` イベントではなく `visibilitychange` だけを見るようになったこと、オンライン判定が `navigator.onLine` を使わず初期値 online で `online` / `offline` イベントだけを見るようになったこと、サーバ上では `retry` の既定が 0 になったことがある。

### keepPreviousData の置き換え

```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const { data, isPlaceholderData } = useQuery({
  queryKey: ['projects', page],
  queryFn: () => fetchProjects(page),
  placeholderData: keepPreviousData, // (previousData) => previousData と同じ
})
```

完全な互換ではない。`placeholderData` 表示中は常に `status: 'success'` になり、`dataUpdatedAt` は 0 のままになる。

### onSuccess / onError の置き換え

コールバックは hook を呼ぶコンポーネントの数だけ実行され、`staleTime` 内のキャッシュ読みでは実行されないなど一貫性がなかったため削除された。用途別の移行先は次のとおり。

| v4 での用途 | v5 での移行先 |
| --- | --- |
| エラートースト・ログ送信 | `new QueryCache({ onError })`（リクエストごとに 1 回） |
| 取得結果をローカル state にコピー | コピーをやめて `data` から導出する。必要なら `select` |
| 取得後に何か副作用 | `data` を依存にした `useEffect`、または `queryFn` 内 |

### 移行の手順

1. まず v4 の最新に上げ、非推奨警告を解消する。
2. codemod（`remove-overloads`）でシグネチャをオブジェクト形式に変換する。TS / TSX には `--parser=tsx` が必要。変換できなかった箇所はログに出るので手で直す。

```bash
npx jscodeshift@latest ./src/ \
  --extensions=ts,tsx --parser=tsx \
  --transform=./node_modules/@tanstack/react-query/build/codemods/v5/remove-overloads/remove-overloads.cjs
```

3. `cacheTime` / `useErrorBoundary` / `keepPreviousData` / `isPreviousData` をリネームする。
4. `isLoading` の使用箇所を 1 つずつ見直す。v4 の意味のまま使っていたなら `isPending` に置き換える。機械的に置換しないこと。
5. クエリの `onSuccess` / `onError` / `onSettled` を上の表に従って移す。
6. `suspense: true` を `useSuspenseQuery` に置き換え、`enabled` や `placeholderData` に頼っていた箇所を設計し直す。

## 使いどころ・注意点

- 最も事故が起きやすいのは `isLoading` である。名前は残っているので型エラーにならず、`enabled: false` のときにスピナーが出なくなるなど挙動だけが変わる。
- `setQueryDefaults` は v5 で一致する登録をすべてマージするようになったので、汎用的なキーから順に登録する。
- `@tanstack/query-core` 5.102.0 で `queryClient.query()` が追加され、`queryClient.fetchQuery` / `prefetchQuery` / `ensureQueryData` が非推奨になった（次のメジャーで削除予定）。`prefetchQuery` は `query(options).catch(noop)`、`ensureQueryData` は `query({ ...options, staleTime: 'static' })` に置き換える。v5 に移行するなら新しい書き方に合わせておくと次の移行が楽になる。

## 参考

- [Migrating to TanStack Query v5](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)
- [Breaking React Query's API on purpose — TkDodo](https://tkdodo.eu/blog/breaking-react-querys-api-on-purpose)
- [RFC: Remove callbacks on useQuery — TanStack/query Discussions #5279](https://github.com/TanStack/query/discussions/5279)
- [v5 roadmap — TanStack/query Discussions #4252](https://github.com/TanStack/query/discussions/4252)
