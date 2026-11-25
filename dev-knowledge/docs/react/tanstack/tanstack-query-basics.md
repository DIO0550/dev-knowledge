---
title: TanStack Query の最小構成は QueryClient と Provider と useQuery と useMutation の 4 つ
tags: [react, tanstack-query, fetch, cache, error-handling]
---

## TL;DR

- `QueryClient` がキャッシュ本体で、`QueryClientProvider` でツリーに配る。読み取りは `useQuery`、書き込み（作成・更新・削除）は `useMutation` が担当する。
- `queryFn` は「データで resolve するか、throw / reject する Promise」を返せばよい。`fetch` は 4xx / 5xx で throw しないので `res.ok` を見て自分で throw する。
- `queryFn` が `undefined` を resolve するのは失敗扱いになる。「データなし」を表すなら `null` を返す。
- `enabled: false`（または `skipToken`）で自動フェッチを止められる。依存クエリ（ID が決まるまで待つ）に使う。
- query はデフォルトで失敗時に 3 回リトライするが、mutation はリトライしない。

## 概要・対象

- 対象：`@tanstack/react-query` v5（確認時点の最新は 5.108.x、確認日 2026-11）
- React からサーバー状態（API レスポンス）を扱うための最小構成と、各部品の役割を整理する。キャッシュの鮮度やキー設計は別記事に分ける。

## 仕組み・仕様

### 4 つの部品の役割

| 部品 | 役割 |
|---|---|
| `QueryClient` | キャッシュ（QueryCache / MutationCache）とデフォルトオプションを持つ本体。アプリで 1 つ作る |
| `QueryClientProvider` | `QueryClient` を React ツリーに配る。`useQueryClient()` で取り出せる |
| `useQuery` | `queryKey` ごとにデータを取得・キャッシュ・再取得する読み取り用フック |
| `useMutation` | サーバー側に副作用を起こす書き込み用フック。キャッシュには自動で入らない |

```tsx
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

// コンポーネント外で 1 回だけ作る（レンダーごとに作るとキャッシュが消える）
const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Todos />
    </QueryClientProvider>
  );
}
```

### queryFn は Promise を返し、失敗は throw で表す

`queryFn` は「データで resolve する」か「throw / reject する」Promise を返す関数であればよい。TanStack Query は throw を検知して `status: 'error'` に遷移させ、`error` に格納する。

```ts
async function fetchTodos({ signal }: { signal: AbortSignal }): Promise<Todo[]> {
  const res = await fetch('/api/todos', { signal });
  // fetch は HTTP エラーでは reject しないので自分で throw する
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

- `queryFn` には `QueryFunctionContext`（`queryKey` / `signal` / `meta` / `client` など）が渡る。`signal` を `fetch` に渡すと、クエリのキャンセル時にリクエストも中断される。
- resolve 値に `undefined` は使えない（失敗扱い）。データが無いことを成功として扱うなら `null` を返す。

### useQuery の基本

```tsx
function Todos() {
  const { data, isPending, isError, error, isFetching } = useQuery({
    queryKey: ['todos'],
    queryFn: fetchTodos,
  });

  if (isPending) return <p>Loading...</p>;
  if (isError) return <p>{error.message}</p>;
  return (
    <ul>
      {data.map((t) => (
        <li key={t.id}>{t.title}</li>
      ))}
    </ul>
  );
}
```

- `status` は `pending`（まだ表示できるデータが無い）/ `error` / `success` の 3 つ。`isPending` 等はその派生 boolean。
- `isFetching` は「通信中かどうか」で、データ表示中のバックグラウンド再取得でも `true` になる。v5 の `isLoading` は `isPending && isFetching`（初回取得中）を意味する。
- v5 ではオプションはオブジェクト 1 つで渡す形に統一され、`useQuery` の `onSuccess` / `onError` / `onSettled` は廃止された（mutation 側には残っている）。

### 基本オプション

| オプション | デフォルト | 意味 |
|---|---|---|
| `enabled` | `true` | `false` で自動フェッチ（マウント時・キー変更時）を止める。関数 `(query) => boolean` も可 |
| `staleTime` | `0` | データが fresh とみなされる時間。詳細は別記事 |
| `gcTime` | 5 分 | 使われなくなったキャッシュを破棄するまでの時間 |
| `retry` | `3`（サーバー側は `0`） | 失敗時のリトライ回数。指数バックオフで再試行される |
| `select` | なし | キャッシュは変えずにコンポーネントに渡す値だけ変換する |
| `placeholderData` | なし | 取得中に仮表示する値。`keepPreviousData` を渡すとページ送りで前ページを残せる（v4 の `keepPreviousData` オプションの後継） |
| `throwOnError` | `false` | エラーを Error Boundary に投げる（v4 の `useErrorBoundary` から改名） |

依存クエリは `enabled` で書く。型安全に止めたい場合は `queryFn` に `skipToken` を渡す方法もある（ただし `skipToken` の間は `refetch()` が動かないので、手動トリガー用途なら `enabled: false` を使う）。

```ts
const { data: user } = useQuery({ queryKey: ['user', email], queryFn: () => getUser(email) });
const userId = user?.id;

const { data: projects } = useQuery({
  queryKey: ['projects', userId],
  queryFn: () => getProjects(userId!),
  enabled: userId != null, // userId が決まるまで実行しない
});
```

### useMutation の基本

```tsx
function AddTodo() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (title: string) => postTodo({ title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });

  return (
    <button disabled={mutation.isPending} onClick={() => mutation.mutate('new')}>
      追加
    </button>
  );
}
```

- 状態は `idle` / `pending` / `error` / `success` の 4 つ。
- `mutate()` は Promise を返さず、結果は state とコールバックで受け取る。`await` したいときは `mutateAsync()` を使う（失敗時は reject されるので `try/catch` が必要）。
- コールバックは `onMutate` → `onSuccess` / `onError` → `onSettled` の順。コールバックが Promise を返すと、それを待ってから次に進む。
- `useMutation` に渡したコールバックは毎回呼ばれる。`mutate(vars, { onSuccess })` のように呼び出し側に渡したコールバックは、`useMutation` 側の後に実行され、完了時にコンポーネントがアンマウントされていれば呼ばれない。連続で `mutate` した場合は最後の 1 回分しか呼ばれない。
- mutation はデフォルトでリトライしない（`retry` で明示的に有効化する）。

## 使いどころ・注意点

- `QueryClient` をコンポーネント本体で `new` するとレンダーごとに作り直されてキャッシュが消える。モジュールスコープか `useState(() => new QueryClient())` で 1 回だけ作る。
- `fetch` を使う場合の `res.ok` チェック漏れはよくある落とし穴で、404 でも `success` になってしまう。
- mutation の結果はキャッシュに自動反映されない。`invalidateQueries` か `setQueryData` で明示的に繋ぐ（既存記事「mutation 後のキャッシュ更新は invalidate を基本にし、楽観的更新は表示箇所の数で方式を選ぶ」）。
- 手書きの `useEffect` + `fetch` で必要だったレース対策（既存記事「fetch のレースコンディションはリクエスト ID 振りではなく AbortController で防ぐ」）や in-flight の重複排除は、TanStack Query ではキー単位で内部的に処理される。

## 参考

- [Quick Start | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/quick-start)
- [Query Functions | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-functions)
- [Mutations | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- [useQuery | TanStack Query React Docs](https://tanstack.com/query/v5/docs/framework/react/reference/useQuery)
- [Migrating to TanStack Query v5](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)
