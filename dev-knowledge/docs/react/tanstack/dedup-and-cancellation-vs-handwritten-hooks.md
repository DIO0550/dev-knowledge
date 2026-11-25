---
title: 自前の fetch hooks の重複排除とキャンセルは TanStack Query ではキーごとの Query が引き受ける
tags: [react, tanstack-query, request-deduplication, abort-controller, race-condition, custom-hooks]
---

## TL;DR

- 自前 hooks で書いていた「in-flight dedup」「AbortController によるレース対策」「ローディング状態管理」は、TanStack Query では queryKey ごとに 1 つ作られる `Query` オブジェクトがまとめて受け持つ。
- 同じキーで同時に fetch しようとすると、`Query.fetch()` は進行中の Promise をそのまま返す。dedup の所有者は `QueryClient` 配下の `QueryCache`（`Map`）で、既存記事と同じ「モジュール / アプリレベル」の設計である。
- `queryFn` には `{ signal }` が渡るが、自動キャンセルされるのは signal を読んだ（fetch に渡した）ときだけ。読まなければアンマウントやキー変更後もリクエストは完走し、結果はキャッシュに入る。
- キー変更時は observer が新しい `Query` に付け替わるため、古い応答が画面を上書きするレースは signal を使わなくても構造的に起きない。signal はあくまで帯域の節約のためにある。

## 背景・射程

対象は TanStack Query v5（`@tanstack/react-query` / `@tanstack/query-core` 5.108.4、確認日 2026-11）。

既存記事「同一 API リクエストの重複排除（in-flight dedup）は useRef ではなくモジュールスコープの Map で管理する」と「fetch のレースコンディションはリクエスト ID 振りではなく AbortController で防ぐ」では、自前 hooks での正しい書き方を整理した。本記事では、その 2 つの仕組みが TanStack Query 内部でどう実現されているかをソースで確認し、自前実装から移行するときの判断材料にする。

## 判断軸・比較

### 対比表

| 関心事 | 自前 hooks（既存記事の正攻法） | TanStack Query v5 |
| --- | --- | --- |
| dedup の所有者 | モジュールスコープの `Map<key, Promise>` | `QueryClient` が持つ `QueryCache`（`Map<queryHash, Query>`） |
| dedup の単位 | 自分で決めた文字列キー | `queryKey` を安定ハッシュした `queryHash` |
| 進行中 Promise の共有 | `inflight.get(key)` があれば返す | `Query.fetch()` が `fetchStatus !== 'idle'` なら既存の Promise を返す |
| 完了後の扱い | `finally` で `Map` から削除 | Promise は破棄、結果は `Query.state.data` にキャッシュとして残る |
| レース対策 | `useEffect` の cleanup で `abort()` | キーごとに別 `Query` なので古い応答は別キャッシュに入るだけ |
| キャンセル | 常に `abort()` する | `signal` を読んだときだけ、最後の observer が外れたら abort |
| ローディング状態 | `useState` で自前管理 | `status` / `fetchStatus` を `Query.state` が持つ |
| キャッシュ・再検証 | なし（足すと再発明） | `staleTime` / `gcTime` / フォーカス時再取得など |

### dedup はキーごとの Query が担う

`useQuery` は内部で `QueryObserver` を作り、`QueryCache.build()` で `queryHash` に対応する `Query` を取得する。なければ作って `Map` に登録するので、同じキーを使う全コンポーネントは同じ `Query` インスタンスを観測する。

`Query.fetch()` の冒頭は次のようになっている（抜粋）。

```ts
if (this.state.fetchStatus !== 'idle' && this.#retryer?.status() !== 'rejected') {
  if (this.state.data !== undefined && fetchOptions?.cancelRefetch) {
    this.cancel({ silent: true })
  } else if (this.#retryer && this.#fetchPromise) {
    this.#retryer.continueRetry()
    return this.#fetchPromise
  }
}
```

つまり既存記事の `inflight.get(userId)` と同じ発想を `Query` 単位で持っている。なお `refetch()` や `invalidateQueries()` は既定で `cancelRefetch: true` なので、データがある状態で明示的に再取得すると進行中のリクエストは捨てて取り直す。共有されるのはマウント時の自動 fetch 同士など、`cancelRefetch` を指定しない呼び出しである。

### signal は「読んだら」キャンセル対象になる

`queryFn` に渡すコンテキストの `signal` は getter で定義されており、アクセスした瞬間に内部フラグ `#abortSignalConsumed` が立つ。最後の observer が外れたとき（アンマウントやキー変更）の処理は次のとおり。

```ts
if (this.#abortSignalConsumed || (this.state.fetchStatus === 'paused' && this.state.status === 'pending')) {
  this.#retryer.cancel({ revert: true })
} else {
  this.#retryer.cancelRetry()
}
```

signal を読んでいなければリトライだけ止めて、リクエスト自体は完走させてキャッシュに入れる。公式ドキュメントも「既定ではアンマウントされたクエリはキャンセルしない。再マウント時にデータが使えるから」と説明している。キャンセルされた場合、状態は fetch 前に巻き戻る（`revert`）。

```ts
useQuery({
  queryKey: ['users', query],
  queryFn: ({ signal }) => searchUsers(query, { signal }), // signal を渡したときだけ自動 abort
})
```

### キー変更時の挙動

検索語が変わって `queryKey` が `['users', 'a']` から `['users', 'ab']` になると、observer は `#updateQuery()` で古い `Query` から `removeObserver` され、新しい `Query` に付く。

- 古い `Query` に他の observer がおらず signal を読んでいれば、そのリクエストは abort される
- signal を読んでいなくても、古い応答は `['users', 'a']` のキャッシュに入るだけで、今表示している `['users', 'ab']` の `data` は上書きされない

既存記事でリクエスト ID や AbortController で防いでいた「古い応答が新しい応答を上書きする」問題は、キャッシュをキーで分けた時点で消える。AbortController は不要なリクエストを止めて帯域とサーバ負荷を減らすための最適化という位置づけになる。

## 指針

- サーバ状態の取得は、自前の dedup / レース対策 hooks を書く前に TanStack Query に寄せる。既存記事の実装はライブラリを使えない環境や仕組みの理解のためのものと割り切る。
- `queryFn` では `signal` を受け取り `fetch` や axios に渡す。追加コストはほぼなく、キー変更・アンマウント時の無駄なリクエストが止まる。
- 逆に「途中で離脱しても結果はキャッシュしておきたい」重い取得では、あえて signal を使わない選択もある。
- 外部 SDK が signal を受け付けない場合は、signal を読まないこと。読んだのに実際は止まらないと、キャンセル扱いで状態が巻き戻るのに通信は続く中途半端な状態になる。
- `useSuspenseQuery` 系の hook ではキャンセルが効かない（公式ドキュメントの Limitations）。

## 参考

- [Query Cancellation — TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [Queries — TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/queries)
- [TanStack/query packages/query-core/src/query.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/query.ts)
- [TanStack/query packages/query-core/src/queryObserver.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryObserver.ts)
