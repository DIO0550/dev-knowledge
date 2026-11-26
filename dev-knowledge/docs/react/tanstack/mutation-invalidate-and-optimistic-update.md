---
title: mutation 後のキャッシュ更新は invalidate を基本にし、楽観的更新は表示箇所の数で方式を選ぶ
tags: [react, tanstack-query, optimistic-update, cache, race-condition]
---

## TL;DR

- mutation の結果はキャッシュに自動反映されない。基本は `invalidateQueries` で関連クエリを stale にして取り直す。レスポンスに更新後のエンティティが返るなら `setQueryData` で直接書き込めば通信を 1 回省ける。
- 楽観的更新は 2 方式ある。表示箇所が 1 つなら `useMutation` の `variables` を UI に直接描く方式（ロールバック不要）、複数箇所に反映したいなら `onMutate` でキャッシュを書き換えてロールバックする方式。
- キャッシュ書き換え方式では、`onMutate` の最初に `cancelQueries` で進行中の取得を止める。止めないと古いレスポンスが楽観値を上書きする。
- 成功・失敗どちらでも `onSettled` で `invalidateQueries` し、その Promise を return する（mutation が再取得完了まで `pending` のまま保たれる）。
- 同じデータへの mutation が並行するときは、`isMutating` で他の mutation が残っていないか確認してから invalidate する。

## 背景・射程

- 対象：`@tanstack/react-query` v5（確認時点の最新は 5.108.x、確認日 2026-11）。コールバックの第 2 引数以降の `context`（`context.client` など）は 2025 年 9 月にマージされた変更によるもので、それ以前の v5 では `onMutate` の戻り値が `context` と呼ばれていた。
- TanStack Query で mutation 後にキャッシュをどう同期するか、楽観的更新をどの方式で行うかを扱う。
- 楽観更新のロールバックそのものの設計（snapshot 全体復元が外部変更を消してしまう問題と、逆操作で戻す方式）は既存記事「楽観更新の rollback は snapshot 全体復元ではなく inverse operations 方式で戻す」で扱った。本記事は TanStack Query の API でどう組むかに絞る。TanStack Query の公式例は snapshot 復元だが、ロールバック後に `onSettled` で invalidate してサーバー状態に収束させるため、snapshot 復元の弱点（並行して入った変更が一時的に消える）は再取得で回復する、という位置づけになる。

## 判断軸・比較

### mutation 後の同期：invalidate と setQueryData

| 方式 | 通信 | 正確さ | 向いている場面 |
|---|---|---|---|
| `invalidateQueries` | 再取得が 1 回走る | サーバーの最新状態に揃う | 基本形。一覧の並び・件数・集計など、クライアントで再現しにくい影響があるとき |
| `setQueryData`（レスポンスで書き込み） | 追加通信なし | レスポンスが返した範囲だけ正確 | 詳細データの更新で、レスポンスが更新後のエンティティを返すとき |

```ts
const queryClient = useQueryClient();

useMutation({
  mutationFn: editTodo,
  onSuccess: async (data, variables) => {
    // 詳細はレスポンスで直接更新
    queryClient.setQueryData(['todos', 'detail', variables.id], data);
    // 一覧は取り直す（return / await すると完了まで isPending が続く）
    await queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
  },
});
```

- `invalidateQueries` は一致したクエリを `staleTime` に関係なく stale にし、表示中（active）のものだけをバックグラウンドで再取得する。inactive なものは次にマウントされたときに取り直される。
- `setQueryData` の更新関数ではキャッシュを直接書き換えず、必ず新しいオブジェクトを返す（`old.title = ...; return old` は NG）。
- キー設計を階層化しておくと、`['todos', 'list']` のような前方一致で関連クエリをまとめて無効化できる（既存記事「queryKey は依存値をすべて含む階層配列にして queryOptions のファクトリで共有する」）。

### 楽観的更新：variables 方式とキャッシュ書き換え方式

| 観点 | variables を UI に描く方式 | onMutate でキャッシュを書き換える方式 |
|---|---|---|
| キャッシュ | 触らない | 直接書き換える |
| ロールバック | 不要（失敗すると仮表示が消えるだけ） | 必要（`onMutate` の戻り値で戻す） |
| 反映範囲 | 描画したコンポーネントだけ | 同じキーを使う全コンポーネント |
| 別コンポーネントで使う | `mutationKey` ＋ `useMutationState` | 自動 |
| コード量 | 少ない | 多い（cancel / snapshot / rollback / invalidate） |

#### 方式 1：variables を UI に使う

```tsx
const addTodo = useMutation({
  mutationKey: ['addTodo'],
  mutationFn: (text: string) => postTodo({ text }),
  // Promise を return して、再取得完了まで pending を保つ
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
});

<ul>
  {todos.map((t) => <li key={t.id}>{t.text}</li>)}
  {addTodo.isPending && <li style={{ opacity: 0.5 }}>{addTodo.variables}</li>}
  {addTodo.isError && (
    <li>
      {addTodo.variables}
      <button onClick={() => addTodo.mutate(addTodo.variables)}>再試行</button>
    </li>
  )}
</ul>;
```

- `variables` はエラー時もクリアされないので、失敗した入力をそのまま再試行 UI に使える。
- mutation と一覧が別コンポーネントにあるときは、`useMutationState({ filters: { mutationKey: ['addTodo'], status: 'pending' }, select: (m) => m.state.variables })` で進行中の `variables` を配列で取れる。並行実行に対応でき、key には `m.state.submittedAt` が使える。

#### 方式 2：onMutate でキャッシュを書き換えてロールバック

```ts
useMutation({
  mutationFn: updateTodo,
  onMutate: async (newTodo, context) => {
    // 1. 進行中の取得を止める（古いレスポンスによる上書きを防ぐ）
    await context.client.cancelQueries({ queryKey: ['todos'] });
    // 2. ロールバック用に現在値を退避
    const previousTodos = context.client.getQueryData<Todo[]>(['todos']);
    // 3. 楽観値を書き込む
    context.client.setQueryData<Todo[]>(['todos'], (old = []) =>
      old.map((t) => (t.id === newTodo.id ? newTodo : t)),
    );
    // 4. 戻り値は onError / onSettled に onMutateResult として渡る
    return { previousTodos };
  },
  onError: (_err, _newTodo, onMutateResult, context) => {
    context.client.setQueryData(['todos'], onMutateResult?.previousTodos);
  },
  onSettled: (_data, _error, _vars, _onMutateResult, context) =>
    context.client.invalidateQueries({ queryKey: ['todos'] }),
});
```

### cancelQueries が必要な理由

`onMutate` の時点で `['todos']` の取得（フォーカス復帰による再取得など）が進行中だと、その古いレスポンスが楽観値を書き込んだ後に届き、キャッシュを mutation 前の状態に戻してしまう。`cancelQueries` はそのクエリの取得を中断し、結果をキャッシュに反映させない。`queryFn` で `signal` を `fetch` に渡していれば、HTTP リクエスト自体も中断される。

### 並行 mutation での過剰な invalidate

同じエンティティに対する mutation A・B を連続で投げると、A の `onSettled` の invalidate による再取得が B の完了前に返り、B の楽観値が一瞬消えてちらつく。この場合は `cancelQueries` では防げない（A の完了時点では取得が走っていないため）。対策は、同系統の mutation に共通の `mutationKey` を付け、最後の 1 つだけが invalidate することである。

```ts
onSettled: () => {
  // onSettled 時点では自分自身もまだカウントされるので 1 と比較する
  if (queryClient.isMutating({ mutationKey: ['todos'] }) === 1) {
    return queryClient.invalidateQueries({ queryKey: ['todos'] });
  }
},
```

`useIsMutating()` フックだと古いクロージャの値を読むおそれがあるので、`queryClient.isMutating()` を命令的に呼ぶ。

## 指針

- 基本は「mutation 後に関連クエリを `invalidateQueries`」。レスポンスで更新後のエンティティが取れるなら、詳細は `setQueryData` で書き込み、一覧など影響範囲が広いものは invalidate する。
- 楽観的更新が必要なとき、表示箇所が 1 つ（同一コンポーネントか `useMutationState` で届く範囲）なら variables 方式を選ぶ。ロールバックの設計が不要になる。
- 複数箇所に一斉に反映したいときだけキャッシュ書き換え方式にし、`cancelQueries` → snapshot → `setQueryData` → `onError` で復元 → `onSettled` で invalidate の 5 点をセットで書く。
- invalidate の Promise は `onSuccess` / `onSettled` で return して、再取得完了まで `isPending` を保つ（ボタンの多重押し防止や「保存中」表示がそのまま使える）。
- 同じデータへの mutation が並行しうるなら、`mutationKey` と `isMutating` で invalidate を最後の 1 つに絞る。

## 参考

- [Optimistic Updates | TanStack Query React Docs](https://tanstack.com/query/v5/docs/react/guides/optimistic-updates)
- [Invalidations from Mutations | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
- [Updates from Mutation Responses | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses)
- [Query Invalidation | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [Mutations | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- [feat(query-core): add context to mutationFn & mutation callbacks · TanStack/query PR #9615](https://github.com/TanStack/query/pull/9615)
- [Concurrent Optimistic Updates in React Query | TkDodo's blog](https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query)
