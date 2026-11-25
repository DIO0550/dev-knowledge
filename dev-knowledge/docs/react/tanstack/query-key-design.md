---
title: queryKey は依存値をすべて含む階層配列にして queryOptions のファクトリで共有する
tags: [react, tanstack-query, query-key, typescript, design-pattern]
---

## TL;DR

- `queryKey` はトップレベルが配列で、`queryFn` が依存する値をすべて含める。含め忘れるとキャッシュが混ざり、値が変わっても再取得されない。
- キーは「汎用 → 具体」の順に並べる（`['todos', 'list', { filters }]`、`['todos', 'detail', id]`）。`invalidateQueries` は前方一致なので、階層の途中で切ると関連クエリをまとめて無効化できる。
- キーを手書きで散らばらせず、機能ごとに Query Key Factory を 1 つ置いてそこからだけ生成する。
- v5 では `queryOptions` でキーと `queryFn` をセットにしたファクトリにすると、`getQueryData` / `setQueryData` の戻り値型まで推論される。

## 背景・射程

- 対象：`@tanstack/react-query` v5（確認時点の最新は 5.108.x、確認日 2026-11）
- `queryKey` はキャッシュの識別子であり、同時に「何が変わったら取り直すか」の依存配列でもある。さらに `invalidateQueries` などのフィルタの対象にもなるため、設計次第で後からの無効化のしやすさが大きく変わる。
- ここでは「キーに何を入れるか」「どう並べるか」「どこで定義するか」の 3 点を判断軸として整理する。

## 判断軸・比較

### 1. 何を入れるか：queryFn の依存値をすべて

```ts
// NG: todoId がキーに無い。別の todo でも同じキャッシュを共有し、todoId が変わっても再取得されない
useQuery({ queryKey: ['todo'], queryFn: () => getTodo(todoId) });

// OK
useQuery({ queryKey: ['todo', todoId], queryFn: () => getTodo(todoId) });
```

- `useEffect` の依存配列と同じ発想で、キーが変わると別クエリとして扱われ、必要に応じて取得される。
- 公式の ESLint プラグイン（`@tanstack/eslint-plugin-query`）の `exhaustive-deps` ルールで含め忘れを検出できる。
- キーは `JSON.stringify` 可能な値で構成する。ハッシュは決定的で、オブジェクトのプロパティ順は無視されるが、配列の要素順は区別される。

| キー A | キー B | 同一か |
|---|---|---|
| `['todos', { status, page }]` | `['todos', { page, status }]` | 同一（オブジェクトの順序は無関係） |
| `['todos', { page, other: undefined }]` | `['todos', { page }]` | 同一（`undefined` のプロパティは無視） |
| `['todos', status, page]` | `['todos', page, status]` | 別物（配列の順序は区別） |

### 2. どう並べるか：汎用 → 具体の階層

`invalidateQueries` / `removeQueries` / `cancelQueries` などのフィルタは、デフォルトでキーの前方一致で対象を選ぶ。

```ts
// ['todos'] で始まるもの全部（一覧・詳細すべて）
queryClient.invalidateQueries({ queryKey: ['todos'] });
// 一覧だけ
queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
// 完全一致のみ
queryClient.invalidateQueries({ queryKey: ['todos'], exact: true });
// 任意条件
queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'todos' });
```

フィルタ用の値（`filters`）は末尾のオブジェクトにまとめると、「一覧系すべて」と「特定の絞り込み」を両方指定できる。並びが `['todos', { filters }, 'list']` のように具体値が先に来ると、一覧だけをまとめて無効化できなくなる。

### 3. どこで定義するか：手書き vs ファクトリ vs queryOptions ファクトリ

| 方式 | キーの整合性 | 型安全 | 備考 |
|---|---|---|---|
| 呼び出し箇所で手書き | タイポ・並び違いが起きやすい | `getQueryData` は `unknown` | 小規模なら可 |
| Query Key Factory | 生成元が 1 つなので揃う | キーのみ | TkDodo 推奨の定番 |
| `queryOptions` ファクトリ | 揃う | キーから data 型まで推論 | v5 で推奨される形 |

Query Key Factory はキーを返す関数群を機能ごとに置く形である。

```ts
export const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (filters: string) => [...todoKeys.lists(), { filters }] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail: (id: number) => [...todoKeys.details(), id] as const,
};
```

v5 の `queryOptions` は実行時には引数をそのまま返すだけのヘルパだが、型の面で 2 つの効果がある。

- `stallTime` のようなオプション名のタイポが、オブジェクトを定数に切り出しても型エラーになる。
- 返された `queryKey` に `queryFn` の戻り値型がタグ付けされ、`getQueryData` / `setQueryData` が型引数なしで推論される。

```ts
import { queryOptions } from '@tanstack/react-query';

export const todoQueries = {
  all: () => ['todos'] as const,
  lists: () => [...todoQueries.all(), 'list'] as const,
  list: (filters: string) =>
    queryOptions({
      queryKey: [...todoQueries.lists(), filters],
      queryFn: () => fetchTodos(filters),
    }),
  details: () => [...todoQueries.all(), 'detail'] as const,
  detail: (id: number) =>
    queryOptions({
      queryKey: [...todoQueries.details(), id],
      queryFn: () => fetchTodo(id),
      staleTime: 5000,
    }),
};

useQuery(todoQueries.detail(1));
useSuspenseQuery(todoQueries.detail(1));
void queryClient.query(todoQueries.list('done')); // 先読み（旧 prefetchQuery 相当）

const todo = queryClient.getQueryData(todoQueries.detail(1).queryKey);
//    ^? Todo | undefined
queryClient.invalidateQueries({ queryKey: todoQueries.lists() });
```

- 階層の「途中」（`all` / `lists` / `details`）は無効化用なのでキーだけを返し、末端だけを `queryOptions` にする。
- コンポーネントごとに表示形を変えたいときは `useQuery({ ...todoQueries.detail(1), select: (t) => t.title })` のように `select` を足す。`data` の型は `select` の戻り値に推論される。
- `useInfiniteQuery` 用には `infiniteQueryOptions` を使う。
- `@tanstack/query-core` 5.102.0 で `queryClient.query()` が追加され、公式ガイドでは `prefetchQuery` / `ensureQueryData` が deprecated（次のメジャーで削除予定）とされている。古い記事の `prefetchQuery(options)` は `query(options)` に読み替える。どちらも同じ options オブジェクトを受け取るので、`queryOptions` ファクトリはそのまま使える。
- `getQueriesData`（複数一致）は型が混在しうるため推論されない。

## 指針

- キーには `queryFn` の依存値をすべて入れ、ESLint の `exhaustive-deps` で機械的に担保する。
- キーは「機能名 → 種別（list / detail）→ 具体値」の順に並べ、無効化したい単位が前方一致で切り出せる形にする。
- キーと `queryFn` は分けずに、機能フォルダ内で `queryOptions` ファクトリとして同居させる（全機能のキーを 1 ファイルに集約するより、機能ごとに置く方が変更が局所化する）。
- コンポーネントからは生のキー配列を書かず、必ずファクトリ経由で参照する。

## 参考

- [Query Keys | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- [Query Options | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-options)
- [Prefetching & Router Integration | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [TypeScript | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/typescript)
- [Query Invalidation | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [exhaustive-deps | TanStack Query ESLint Plugin](https://tanstack.com/query/latest/docs/eslint/exhaustive-deps)
- [Effective React Query Keys | TkDodo's blog](https://tkdodo.eu/blog/effective-react-query-keys)
- [The Query Options API | TkDodo's blog](https://tkdodo.eu/blog/the-query-options-api)
