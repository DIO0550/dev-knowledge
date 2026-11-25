---
title: TanStack Query の isPending と isFetching は status と fetchStatus という別の軸を表す
tags: [react, tanstack-query, state-management, loading-state]
---

## TL;DR

- クエリの状態は 2 軸ある。`status`（pending / error / success）は「データを持っているか」、`fetchStatus`（fetching / paused / idle）は「`queryFn` が今動いているか」を表す。
- `isPending` は「まだデータがない」、`isFetching` は「通信中（バックグラウンド再取得を含む）」。初回のスピナーは `isPending`、更新中インジケータは `isFetching` を見る。
- `isLoading` は v5 では `isPending && isFetching`（初回取得中）。`enabled: false` のクエリは `isPending` が true のまま `isLoading` は false になる。
- `isRefetching` は `isFetching && !isPending`、`isPlaceholderData` は表示中の `data` が `placeholderData` 由来かどうか。

## 概要・対象

対象は TanStack Query v5（`@tanstack/react-query` 5.108.4、確認日 2026-11）。`useQuery` が返すフラグのうち、ローディング表示に関わるものの意味と使い分けを整理する。

既存記事「ローディング状態はドメインか？通信状態とドメイン状態の見分け方」で、取得中フラグは通信層の関心事であり TanStack Query 利用時は `status` / `fetchStatus` が所有すると書いた。本記事はその 2 軸の中身を扱う。

## 仕組み・仕様

### 2 つの軸

| 軸 | 値 | 意味 |
| --- | --- | --- |
| `status` | `pending` | キャッシュにデータがまだない |
| | `error` | 取得に失敗した |
| | `success` | データがある |
| `fetchStatus` | `fetching` | `queryFn` を実行中 |
| | `paused` | 実行したいがオフラインなどで一時停止中 |
| | `idle` | 何もしていない |

2 軸は独立しているので、`success` かつ `fetching`（バックグラウンド再取得中）や、`pending` かつ `paused`（初回マウント時にオフライン）、`pending` かつ `idle`（`enabled: false`）といった組み合わせが普通に起きる。

### 派生フラグ

`QueryObserver` の結果生成（`createResult`）では次のように導出されている。

```ts
const isFetching = newState.fetchStatus === 'fetching'
const isPending = status === 'pending'
const isLoading = isPending && isFetching
// ...
isRefetching: isFetching && !isPending,
isPaused: newState.fetchStatus === 'paused',
isLoadingError: isError && !hasData,
isRefetchError: isError && hasData,
```

| フラグ | 定義 | 典型的な用途 |
| --- | --- | --- |
| `isPending` | `status === 'pending'` | 初回の全面スピナー・スケルトン。`data` の型を絞る |
| `isLoading` | `isPending && isFetching` | 「実際に初回取得している」ときだけのスピナー |
| `isFetching` | `fetchStatus === 'fetching'` | 右上の小さな更新中インジケータ |
| `isRefetching` | `isFetching && !isPending` | データ表示を残したままの再取得表示 |
| `isPaused` | `fetchStatus === 'paused'` | オフライン表示 |
| `isPlaceholderData` | 表示中の `data` が `placeholderData` 由来 | ページ送り中に前ページを薄く表示する |

`placeholderData` が使われると `status` は `success` 扱いになるため、`isPending` は false になる。ページ送りで前のデータを見せながら次ページを取得している間は「`isPlaceholderData` が true かつ `isFetching` が true」になる。

## 使いどころ・注意点

- 基本形は「`isPending` で早期 return → `isError` で早期 return → `data` を描画、`isFetching` は補助表示」。`isPending` で分岐すると TypeScript 上でも `data` が定義済みに絞り込まれる。

```tsx
const { data, isPending, isError, error, isFetching } = useQuery(todosQuery)

if (isPending) return <Spinner />
if (isError) return <ErrorView error={error} />
return <TodoList todos={data} refreshing={isFetching} />
```

- `isFetching` で全面スピナーを出すと、フォーカス復帰やキャッシュ無効化のたびに画面が消えてちらつく。
- `isLoading` だけで分岐すると、`enabled: false` やオフラインで `paused` の間はスピナーも `data` も出ない空白状態になる。`enabled` で依存クエリを止めている場合は `isPending` との違いを意識する。
- 一覧のページ送りで `isPending` スピナーを避けたいなら `placeholderData: keepPreviousData` を使い、`isPlaceholderData` で「次へ」ボタンの無効化や半透明表示を行う。
- v4 からの移行では名前の意味がずれている（v4 の `isLoading` が v5 の `isPending`、v4 の `isInitialLoading` が v5 の `isLoading`）。v4 の書き方のまま `isLoading` を使い続けると上記の空白状態を踏みやすい。

## 参考

- [Queries — TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/queries)
- [Network Mode — TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)
- [Migrating to TanStack Query v5](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)
- [TanStack/query packages/query-core/src/queryObserver.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryObserver.ts)
