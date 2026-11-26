---
title: TanStack Query を使うコードのテストはテストごとに QueryClient を作り retry を切る
tags: [react, tanstack-query, testing, msw, vitest]
---

## TL;DR

- `QueryClient` はキャッシュそのものなので、テストごとに `new QueryClient()` して wrapper で渡す。使い回すとキャッシュが前のテストから漏れ、MSW のハンドラを差し替えても古い結果が返る。
- `defaultOptions.queries.retry: false` を入れる。既定はクライアント環境で 3 回リトライ（指数バックオフ）なので、エラー系テストがタイムアウトする。
- `gcTime` は既定 5 分のタイマーを残す。Jest で終了しない警告が出る場合は `gcTime: Infinity` にする。
- MSW はハンドラを `server.use()` でテスト単位に上書きし、`afterEach` で `resetHandlers()` する。キャッシュの分離と組み合わせて初めてテストが独立する。

## 概要・対象

対象は TanStack Query v5（`@tanstack/react-query` 5.108.4、確認日 2026-11）、React Testing Library の `renderHook` / `render`、MSW v2、Vitest または Jest。

既存記事「古典学派での React API 呼び出し hooks テスト戦略（モック境界とテストケース数）」では、何をモックするか（HTTP 境界だけを MSW で差し替える）とテストケース数の決め方を扱った。本記事は TanStack Query 固有のセットアップ、つまりキャッシュ・リトライ・GC タイマーがテストにどう影響するかに絞る。

## 仕組み・仕様

### テストごとに QueryClient を作る

```tsx
export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

test('ユーザー一覧を返す', async () => {
  const { result } = renderHook(() => useUsers(), { wrapper: createWrapper() })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toHaveLength(2)
})
```

`QueryClient` を 1 つだけ作ってファイル全体で共有すると、前のテストで成功した `['users']` のデータがキャッシュに残る。次のテストで `server.use()` によりエラーを返すように変えても、マウント直後はキャッシュの成功データが返る。`isSuccess` を待つテストは実際の取得を待たずに通り、`staleTime` を設定していればネットワークにすら行かない。共有する場合は `afterEach` で `queryClient.clear()` し、テストを並列実行しないことが前提になる（公式ドキュメントの注意書き）。

### retry: false

リトライ回数は `retryer` で `config.retry ?? (isServer ? 0 : 3)` と決まる。jsdom / happy-dom ではクライアント扱いなので 3 回リトライし、遅延は 1 秒から倍々で伸びる。`waitFor` の既定タイムアウト（1 秒）ではまず終わらない。

注意点として `defaultOptions` はフォールバックなので、`useQuery` 側で `retry: 5` のように明示しているクエリには効かない。そうしたクエリはリトライ設定を hook に直書きせず、`queryClient.setQueryDefaults` などクライアント側の設定に寄せておくとテストで差し替えやすい。

### gcTime

使われなくなったクエリは `gcTime`（クライアント既定 5 分、サーバ扱いでは `Infinity`）後に削除されるタイマーが張られる。テスト終了後もこのタイマーが残るため、Jest では「Jest did not exit one second after the test run completed」が出ることがある。`gcTime: Infinity` にするとタイマー自体が張られない（`Infinity` は有効なタイムアウトとして扱われない）。Vitest で問題が出ていなければ必須ではない。

### MSW との組み合わせ

```ts
const server = setupServer(http.get('/api/users', () => HttpResponse.json(users)))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('エラー時に isError になる', async () => {
  server.use(http.get('/api/users', () => new HttpResponse(null, { status: 500 })))
  const { result } = renderHook(() => useUsers(), { wrapper: createWrapper() })
  await waitFor(() => expect(result.current.isError).toBe(true))
})
```

- `fetch` は 4xx / 5xx で reject しないので、`queryFn` 側で `if (!res.ok) throw ...` していないとエラー系テストは `isSuccess` になる。これはテストの不備ではなく実装のバグを見つけた状態である。
- `onUnhandledRequest: 'error'` にしておくと、`queryKey` の組み立てミスで想定外の URL を叩いたときにすぐ気付ける。

## 使いどころ・注意点

- 前提データが欲しいだけなら、MSW を経由せず `queryClient.setQueryData(key, data)` でキャッシュに直接入れてから描画してもよい。その場合は wrapper を作る関数が `queryClient` も返すようにする。
- コンポーネントテストでも同じ wrapper を `render(ui, { wrapper })` で使う。Suspense を使うコンポーネントは wrapper に `Suspense` を足す。
- v5 ではカスタム logger が削除されたので、v4 時代の「テスト用に logger を黙らせる」設定は不要（そもそも渡せない）。エラー時のコンソール出力が気になる場合は MSW やテストランナー側で抑制する。
- `waitFor` の中には `isSuccess` などの状態を待つ assertion だけを書き、データの検証はその外で行うと失敗時のメッセージが読みやすい。

## 参考

- [Testing — TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/testing)
- [Testing React Query — TkDodo](https://tkdodo.eu/blog/testing-react-query)
- [Migrating to TanStack Query v5](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)
- [Mock Service Worker](https://mswjs.io/)
- [TanStack/query packages/query-core/src/retryer.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/retryer.ts)
