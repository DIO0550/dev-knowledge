---
title: useSuspenseQuery はローディングを Suspense に、初回エラーを ErrorBoundary に任せて data を必ず定義済みにする
tags: [react, tanstack-query, suspense, error-handling, error-boundary]
---

## TL;DR

- `useSuspenseQuery` はデータがなければ Promise を投げて Suspense に、データがないままの失敗はエラーを投げて ErrorBoundary に任せる。その代わり `data` は型上 `TData` で、`undefined` チェックが要らない。
- ErrorBoundary に投げるのは既定で「キャッシュにデータがないとき」だけ。バックグラウンド再取得の失敗はキャッシュのデータを表示し続ける。
- ErrorBoundary の「再試行」でクエリを取り直すには `QueryErrorResetBoundary`（または `useQueryErrorResetBoundary`）の `reset` を `onReset` に渡す。
- `useQuery` でも `throwOnError` で ErrorBoundary に送れる。トースト通知などの横断的なエラー処理は `QueryCache` の `onError` に 1 箇所でまとめる。

## 概要・対象

対象は TanStack Query v5（`@tanstack/react-query` 5.108.4、React 18 以上、確認日 2026-11）。v5 で安定版になった Suspense 専用 hook（`useSuspenseQuery` / `useSuspenseQueries` / `useSuspenseInfiniteQuery`）と、エラー処理の置き場所を整理する。

## 仕組み・仕様

### useSuspenseQuery は useQuery の設定を固定したもの

ソースでは `useBaseQuery` に次のオプションを上書きして渡しているだけである。

```ts
useBaseQuery({
  ...options,
  enabled: true,
  suspense: true,
  throwOnError: defaultThrowOnError, // (_error, query) => query.state.data === undefined
  placeholderData: undefined,
}, QueryObserver, queryClient)
```

ここから次の仕様が導かれる。

- `enabled` は常に true。条件付きで止めることはできず、`skipToken` も使えない
- `placeholderData` はない。キー変更時に fallback に戻したくなければ、キーを変える更新を `startTransition` で包む
- 戻り値の型 `UseSuspenseQueryResult` は `DefinedQueryObserverResult` から `isPlaceholderData` を除いたもので、`data` は必ず定義済み
- 1 コンポーネント内で複数回呼ぶと順番にサスペンドしてウォーターフォールになる。並列にしたいときは `useSuspenseQueries` を使う
- クエリキャンセルは効かない（公式ドキュメントの Limitations）

### どのエラーが ErrorBoundary に届くか

react-query 側の `getHasError` は「`isError` かつ境界がリセット中でなく、fetch 中でもなく、`suspense` でデータがない、または `throwOnError` が true を返す」ときだけエラーを投げる。`useSuspenseQuery` では `throwOnError` を変更できないので、バックグラウンド再取得のエラーも境界に送りたいなら自分で投げる。

```tsx
const { data, error, isFetching } = useSuspenseQuery(postsQuery)
if (error && !isFetching) throw error
```

### QueryErrorResetBoundary

エラーを投げたクエリは、境界がリセットされるまで再マウント時に再取得しないよう `retryOnMount` が false にされる。ErrorBoundary の再試行ボタンで取り直すには、`reset` を ErrorBoundary の `onReset` に渡す（以下は react-error-boundary の例）。

```tsx
<QueryErrorResetBoundary>
  {({ reset }) => (
    <ErrorBoundary
      onReset={reset}
      fallbackRender={({ resetErrorBoundary }) => (
        <button onClick={() => resetErrorBoundary()}>再試行</button>
      )}
    >
      <Suspense fallback={<Spinner />}>
        <Posts />
      </Suspense>
    </ErrorBoundary>
  )}
</QueryErrorResetBoundary>
```

`useQueryErrorResetBoundary()` を使うと、最も近い `QueryErrorResetBoundary`（なければグローバル）の `reset` を hook で取得できる。

### useQuery の throwOnError

`useQuery` でも `throwOnError` を指定すれば ErrorBoundary に送れる。関数を渡すと「5xx だけ境界に送り、4xx はその場で扱う」といった振り分けができる。v4 までの `useErrorBoundary` の改名である。

```ts
useQuery({ ...todosQuery, throwOnError: (error) => error.status >= 500 })
```

### グローバルエラー処理は QueryCache の onError

v5 で `useQuery` の `onError` は削除された。hook ごとのコールバックは、同じ hook を使うコンポーネントの数だけ実行されてトーストが重複する問題があったためである。`QueryCache` のコールバックはクエリ（リクエスト）ごとに 1 回しか呼ばれない。

```ts
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // データ表示中の再取得失敗だけトーストで知らせ、初回失敗は ErrorBoundary に任せる
      if (query.state.data !== undefined) toast.error(error.message)
    },
  }),
})
```

## 使いどころ・注意点

- 役割分担の目安は「初回取得の失敗 → ErrorBoundary」「表示中データの再取得失敗 → `QueryCache.onError` のトースト」「フォーム送信など局所的な失敗 → その場で `error` を表示」。
- ErrorBoundary と Suspense の置き場所が、エラー時・ロード時に置き換わる UI の範囲を決める。画面全体を 1 つで包むと一部の失敗で全体がフォールバックになるので、独立して表示できる単位で包む。
- Suspense を使うと親子コンポーネントの取得が直列になりやすい。ルート遷移やイベント時に先読み（`queryClient.prefetchQuery`、5.102.0 以降は非推奨で `queryClient.query(options).catch(noop)` が推奨）しておくと Render-as-you-fetch にできる。
- mutation のエラーを境界に送りたい場合も `throwOnError: true` を使える。

## 参考

- [Suspense — TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)
- [Query Cancellation — TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [React Query Error Handling — TkDodo](https://tkdodo.eu/blog/react-query-error-handling)
- [Breaking React Query's API on purpose — TkDodo](https://tkdodo.eu/blog/breaking-react-querys-api-on-purpose)
- [TanStack/query packages/react-query/src/useSuspenseQuery.ts](https://github.com/TanStack/query/blob/main/packages/react-query/src/useSuspenseQuery.ts)
