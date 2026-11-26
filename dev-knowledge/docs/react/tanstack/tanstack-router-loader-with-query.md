---
title: TanStack Router の loader は TanStack Query のキャッシュを温める役に徹させる
tags: [react, tanstack-router, tanstack-query, cache, suspense]
---

## TL;DR

- `createRootRouteWithContext<{ queryClient: QueryClient }>()` で router context に `queryClient` を渡し、loader では Query のキャッシュを埋めるだけにする。描画側は `useSuspenseQuery` で同じ `queryOptions` を読む。
- loader で使う API は `ensureQueryData`（await してブロック）と `prefetchQuery`（await せず先行取得）。ただし TanStack Query 5.102.0 以降はどちらも deprecated で、`queryClient.query(options)` に寄せるのが今の推奨（`ensureQueryData` 相当は `staleTime: 'static'` を付ける）。
- キャッシュの主役は Query に一本化する。Router 側は `defaultPreloadStaleTime: 0` にして、preload / 遷移のたびに loader を呼ばせ、鮮度判断は Query の `staleTime` に任せる。
- search params を loader で使うときは `loaderDeps` で必要な値だけ取り出す。Router のキャッシュキーになるので、search 全体を返すと無関係な変更でも再実行される。

## 概要・対象

- 対象: TanStack Router（React）v1（`@tanstack/react-router` 1.170.x）、TanStack Query v5（`@tanstack/react-query` 5.108.x）。確認日 2026-11。
- `queryClient.query()` の追加と `fetchQuery` / `prefetchQuery` / `ensureQueryData` の deprecated 化は `@tanstack/query-core` 5.102.0 のソース（JSDoc の `@deprecated`）で確認した。5.101.0 には `query()` は無い。
- SPA 構成を前提にする。SSR（TanStack Start 等）の dehydrate / hydrate は `@tanstack/react-router-ssr-query` の範囲なので扱わない。

## 仕組み・仕様

### router context に queryClient を渡す

ルートルートで context の型を宣言し、`createRouter` で値を渡す。`createRootRouteWithContext` は factory なので二重呼び出しになる。

```tsx
// src/routes/__root.tsx
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
})
```

```tsx
// src/main.tsx
const queryClient = new QueryClient()

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})
```

これで全ルートの `loader` / `beforeLoad` が `context.queryClient` を型付きで受け取れる。`QueryClientProvider` は通常どおり `RouterProvider` の外側に置く。

### loader でキャッシュを埋め、コンポーネントで読む

`queryOptions` を loader とコンポーネントで共有するのが基本形。

```tsx
const postQueryOptions = (postId: string) =>
  queryOptions({
    queryKey: ['posts', postId],
    queryFn: () => fetchPost(postId),
  })

export const Route = createFileRoute('/posts/$postId')({
  loader: ({ context: { queryClient }, params: { postId } }) =>
    queryClient.ensureQueryData(postQueryOptions(postId)),
  component: PostComponent,
})

function PostComponent() {
  const { postId } = Route.useParams()
  const { data: post } = useSuspenseQuery(postQueryOptions(postId))
  return <h1>{post.title}</h1>
}
```

- `ensureQueryData` はキャッシュがあればそれを返し、無ければ取得する。loader が Promise を返すので遷移はデータが揃うまで待つ（必須データ向け）。
- `prefetchQuery` は結果もエラーも捨てる。await せずに呼べば「取得だけ先に始めて遷移はブロックしない」（補助データ向け）。TkDodo は、どちらを選ぶかより「loader で早く始める」ことが重要で、ブロックするかどうかは描画側で `useSuspenseQuery`（ブロック）/ `useQuery`（非ブロック）を選び分ければよいとしている。
- コンポーネントで `useLoaderData` だけを使うと Query のオブザーバーがいないため、invalidate や window focus での再取得が効かず、GC 対象にもなる。描画側は必ず `useQuery` / `useSuspenseQuery` で購読する。
- `useSuspenseQuery` は Router の pending / error 境界にそのまま乗るので、`defaultPendingComponent` / `defaultErrorComponent` を一度設定すれば各ルートは成功時だけ書けばよい。

### Query 5.102.0 以降の書き方

現行の公式 External Data Loading ガイドは `queryClient.query` を使っている。

```tsx
loader: ({ context: { queryClient } }) =>
  queryClient.query({ ...postsQueryOptions, staleTime: 'static' }),
```

| 旧 API | 置き換え |
| --- | --- |
| `fetchQuery(options)` | `query(options)` |
| `ensureQueryData(options)` | `query({ ...options, staleTime: 'static' })` |
| `prefetchQuery(options)` | `query(options).catch(noop)` |

`staleTime: 'static'` は「キャッシュがあれば鮮度に関係なくそれを使う」指定で、`ensureQueryData` の挙動に相当する。旧 API は次のメジャーで削除予定とされている。

### loaderDeps

loader で search params を直接読むと、Router のキャッシュキーにその値が入らず、page 2 の preload 結果が page 1 の URL に紐づくといった不整合が起きる。使う値だけを `loaderDeps` で宣言する。

```tsx
export const Route = createFileRoute('/posts')({
  validateSearch: postsSearchSchema,
  loaderDeps: ({ search: { offset, limit } }) => ({ offset, limit }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.ensureQueryData(postsQueryOptions(deps)),
})
```

`loaderDeps: ({ search }) => search` のように全体を返すと、無関係な param の変更でも loader が再実行される。Query 側の `queryKey` にも同じ値を入れておく。

## 使いどころ・注意点

### Router のキャッシュと Query のキャッシュの役割分担

Router 自体も loader の結果を「パス名 + `loaderDeps`」をキーに stale-while-revalidate でキャッシュする。既定値は次のとおり。

| オプション | 既定値 | 意味 |
| --- | --- | --- |
| `staleTime` | 0 | 遷移で得たデータは即 stale、再訪時に裏で loader 再実行 |
| `preloadStaleTime` | 30 秒 | preload したデータはこの間 fresh 扱いで loader を呼ばない |
| `gcTime` / `preloadGcTime` | 5 分 | 未使用データの保持期間 |

Router のキャッシュはルート単位で、複数ルートが同じデータを使っても共有されない。Query のキャッシュは `queryKey` 単位のグローバルなので、共有・invalidate・mutation 後の更新は Query に任せる方が素直になる。TkDodo も「キャッシュを制御するのは片方だけにすべき」としている。

### defaultPreloadStaleTime: 0 を推奨する理由

Router の既定値で非ゼロなのは `preloadStaleTime` の 30 秒だけである。これが残っていると、hover で preload した直後の 30 秒間は Router が loader を呼ばないため、Query 側で invalidate されていても loader 経由の再取得が走らない。`defaultPreloadStaleTime: 0` にすると preload / 遷移のたびに loader が呼ばれ、実際に fetch するかどうかは Query の `staleTime` が決める。loader が毎回呼ばれても、Query のキャッシュが fresh なら通信は発生しない。

### その他

- エラー時に再試行させるなら、`errorComponent` で `useQueryErrorResetBoundary().reset()` を effect で呼び、ボタンで `router.invalidate()` を実行する（公式 example の形）。
- 型チェックを軽くしたいときは、loader で値を返さずにブロック内で取得だけ行うと loader データ型の推論を省ける（公式 Type Safety ガイド）。

## 参考

- [External Data Loading | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading)
- [Data Loading | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading)
- [Preloading | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/guide/preloading)
- [TanStack Query Integration | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/integrations/query)
- [QueryClient | TanStack Query Docs](https://tanstack.com/query/v5/docs/framework/react/reference/classes/QueryClient)
- [Important Defaults | TanStack Query Docs](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [QueryClient に query / infiniteQuery を追加する PR（TanStack/query#9835）](https://github.com/TanStack/query/pull/9835)
- [TanStack Router and Query | TkDodo's blog](https://tkdodo.eu/tan-stack-router-and-query)
- [basic-react-query-file-based example | TanStack Router（GitHub）](https://github.com/TanStack/router/tree/main/examples/react/basic-react-query-file-based)
