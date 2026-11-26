---
title: staleTime は再取得の要否を決め gcTime は未使用キャッシュの寿命を決める
tags: [react, tanstack-query, cache, performance]
---

## TL;DR

- `staleTime`（デフォルト `0`）は「データを fresh とみなす時間」で、fresh の間は自動再取得のトリガーが来ても取りに行かない。
- `gcTime`（デフォルト 5 分、v4 までの `cacheTime`）は「どこからも使われなくなった（inactive）キャッシュを捨てるまでの時間」。使われている間は一切効かない。
- 自動再取得のトリガーは `refetchOnMount` / `refetchOnWindowFocus` / `refetchOnReconnect`（いずれもデフォルト `true`）で、すべて「stale なら取りに行く」。`refetchInterval` だけは `staleTime` と無関係に定期実行される。
- `invalidateQueries` は `staleTime` を無視して stale にする。`staleTime: Infinity` でも無効化は効くが、`staleTime: 'static'` だと効かない。
- 「`gcTime` を延ばせば通信が減る」は誤解。通信を減らすのは `staleTime` で、`gcTime` は画面を離れて戻ったときに即表示できるかどうかに効く。

## 概要・対象

- 対象：`@tanstack/react-query` v5（確認時点の最新は 5.108.x、確認日 2026-11）
- キャッシュ鮮度に関わる 2 つのオプションと、自動再取得のトリガーとの関係を整理する。

## 仕組み・仕様

### 2 つの時間が扱う状態

```text
fetch 成功
  │
  ├─ [fresh] ── staleTime 経過 ──> [stale]   ← 再取得の要否（staleTime）
  │
  └─ 使っているコンポーネントが 0 になる
       └─ [inactive] ── gcTime 経過 ──> キャッシュから削除   ← 寿命（gcTime）
```

- fresh / stale と active / inactive は独立した軸である。「stale だが active」（表示中だが次のトリガーで取り直す）も「fresh だが inactive」もありうる。
- v5 で `cacheTime` が `gcTime` に改名された理由は、公式の移行ガイドの通り「クエリが使われている間は何もしない」ため。キャッシュ期間ではなく GC までの猶予である。

### デフォルト値

| オプション | デフォルト | 取りうる値 |
|---|---|---|
| `staleTime` | `0` | ミリ秒、`Infinity`、`'static'`、またはそれを返す関数 |
| `gcTime` | 5 分（SSR 時は `Infinity`） | ミリ秒、`Infinity`（GC しない）。上限は約 24 日 |
| `refetchOnMount` | `true` | `true` / `false` / `'always'` / 関数 |
| `refetchOnWindowFocus` | `true` | 同上 |
| `refetchOnReconnect` | `true`（`networkMode: 'always'` のときを除く） | 同上 |
| `refetchInterval` | `false` | ミリ秒、`false`、関数 |
| `refetchIntervalInBackground` | `false` | `true` でタブが裏にあっても定期取得を続ける |

### トリガーと staleTime の関係

| トリガー | `true` のとき | `'always'` のとき |
|---|---|---|
| `refetchOnMount` | 新しい observer がマウントされ、データが stale なら取得 | fresh でも毎回取得 |
| `refetchOnWindowFocus` | ウィンドウにフォーカスが戻り、stale なら取得 | fresh でも毎回取得 |
| `refetchOnReconnect` | ネットワーク再接続時、stale なら取得 | fresh でも毎回取得 |
| `refetchInterval` | `staleTime` に関係なく指定間隔で取得 | ― |

- `'always'` でも `staleTime: 'static'` のクエリは再取得されない。
- 手動の `refetch()` は `staleTime` に関係なく実行される。
- フォーカス検知は `visibilitychange` イベントを使う。Chrome DevTools の「Emulate a focused page」を有効にしているとイベントが来ず、フォーカス復帰で再取得されないように見える。

### staleTime: Infinity と 'static' の違い

| 値 | 自動トリガーでの再取得 | `invalidateQueries` | 用途 |
|---|---|---|---|
| `Infinity` | しない | 効く（stale になり再取得） | 変更は自分の mutation 経由のみ、などのデータ |
| `'static'` | しない（`'always'` 指定でもしない） | 効かない | 起動時のフィーチャーフラグ、参照テーブルなど実行中に変わらないデータ |

### 具体的な流れ（デフォルト設定）

1. `['todos']` の `useQuery` が初めてマウント → 取得してキャッシュ。`staleTime: 0` なので即 stale。
2. 別コンポーネントで同じキーがマウント → キャッシュを即返しつつ、stale なのでバックグラウンドで再取得（`refetchOnMount`）。
3. 両方アンマウント → inactive になり、5 分の GC タイマー開始。
4. 5 分以内に再マウント → キャッシュを即表示しつつ再取得。
5. 5 分間マウントされなければ → キャッシュ削除。次回は `isPending` から始まる。

## 使いどころ・注意点

- よくある誤解 1：「`gcTime` を長くすれば API 呼び出しが減る」。減らない。再取得の要否は `staleTime` で決まり、`gcTime` は inactive 後の保持期間でしかない。
- よくある誤解 2：「`staleTime` を `gcTime` より長くすると意味がない」。`staleTime` は active 中も効くので、両者に大小関係の制約はない。ただし inactive の間に GC されたキャッシュは `staleTime` に関係なく消えるので、再訪時の即表示を狙うなら `gcTime` も考える。
- よくある誤解 3：「フォーカスのたびに通信が走るのはバグ」。`staleTime: 0` と `refetchOnWindowFocus: true` のデフォルトどおりの挙動である。止めたいなら `refetchOnWindowFocus: false` より先に、データに合った `staleTime` を設定することを検討する。
- `staleTime` は `new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })` で全体のデフォルトを上げ、クエリ単位で上書きするのが扱いやすい。
- SSR で取得したデータをクライアントで即再取得させないためにも、`staleTime` を 0 より大きくしておくのが定石である。
- query のリトライ（デフォルト 3 回、指数バックオフ）はこれらのトリガーとは別の仕組みで、失敗時にのみ働く。

## 参考

- [Important Defaults | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [Caching Examples | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/caching)
- [useQuery | TanStack Query React Docs](https://tanstack.com/query/v5/docs/framework/react/reference/useQuery)
- [Window Focus Refetching | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching)
- [Migrating to TanStack Query v5](https://tanstack.com/query/latest/docs/framework/react/guides/migrating-to-v5)
- [staleTime vs cacheTime · TanStack/query Discussion #1685](https://github.com/TanStack/query/discussions/1685)
