---
title: fetch のレースコンディションはリクエスト ID 振りではなく AbortController で防ぐ
tags: [react, typescript, use-ref, anti-pattern, race-condition, abort-controller, use-effect, cleanup, fetch, tanstack-query, custom-hooks]
---

## TL;DR

- 検索バー等で「古い応答が新しい応答を上書きする」レースコンディションに対し、リクエストごとに ID を振って `ref` で比較する実装は、古いリクエストが走り続けるためベストプラクティスではない。
- `AbortController` + `useEffect` の cleanup で**古いリクエスト自体を中断**するのが正攻法。
- イベント駆動の場合は例外的に `ref` が正当だが、`ref` に持つのはカウンタではなく `AbortController` インスタンス。

## 遭遇した問題

入力が変わるたびに fetch する検索バーを考える。タイピング速度より応答が遅いと、古いリクエストの結果が新しいリクエストの結果を上書きしてしまう（"Macron" 検索の応答が "Trump" 検索の応答より遅れて到着し、"Trump" で検索したのに "Macron" の情報が表示される）。

AI や既存コードが `useRef` でリクエスト ID を振って判定する実装を提案してくる:

```ts
function useUserSearch(query: string) {
  const [results, setResults] = useState<User[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const myId = ++requestIdRef.current;
    searchUsers(query).then((data) => {
      if (myId === requestIdRef.current) setResults(data);
    });
  }, [query]);

  return results;
}
```

これでも上書きは防げるが、**古いリクエストは走り続けて帯域とサーバリソースを浪費**する。

## 原因

「最新でないリクエストの結果を捨てる」という事後対処になっており、本質的な解決ではない。問題の本質は「キャンセル可能性」なのに、整数カウンタの比較で間接的に表現しているため、次の問題が残る:

- 古いリクエストはネットワーク上で完走する
- `catch` の中で「これは古いから無視」という分岐が増える
- 可変カウンタで順序を管理するのは命令型の発想であり、React の宣言的モデルと噛み合わない

`AbortController` がブラウザ標準 API として使える現代では、自前の ID 振りで再実装する理由がない。

## 解決

`AbortController` + `useEffect` の cleanup で古いリクエスト自体を中断する。React は前の Effect の cleanup を実行してから次の Effect を走らせる保証があるので、`query` が変わるたびに前回のリクエストが必ず中断される。

```ts
// useUserSearch.ts ← query が変わるたびに自動で fetch
export function useUserSearch(query: string) {
  const [results, setResults] = useState<User[]>([]);

  useEffect(() => {
    if (query === '') return;
    const controller = new AbortController();

    searchUsers(query, { signal: controller.signal })
      .then(setResults)
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        throw err;
      });

    return () => controller.abort();
  }, [query]);

  return query === '' ? [] : results;
}
```

イベントハンドラ駆動（検索ボタンクリック等）の場合は、`ref` を使うのが正当なケース。ただし **`ref` に持つのはカウンタではなく `AbortController` インスタンス**:

```ts
// useUserSearchOnDemand.ts ← ボタンクリック等で明示的に発火
export function useUserSearchOnDemand() {
  const [results, setResults] = useState<User[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const search = useCallback(async (query: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const data = await searchUsers(query, { signal: controller.signal });
      setResults(data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      throw err;
    }
  }, []);

  return { results, search };
}
```

非同期処理で `ref` を使うのが正当になるのは「レンダー中に読まない可変値を保持するとき」に限られる。`AbortController` インスタンスはまさにそれに該当する。

ID 振りと `AbortController` の対比:

| 観点 | ID 振り | AbortController |
|---|---|---|
| 古いリクエスト | 走り続ける | 中断される |
| 意図の表現 | 「最新でないので捨てる」 | 「もう不要なので止める」 |
| `ref` の中身 | カウンタ（実装詳細） | 標準 API の意味あるオブジェクト |
| エラー処理 | ID 比較で無視 | `AbortError` を catch |
| TanStack Query | （使っていない） | 内部で使っている |

TanStack Query も `query` が変わると前の `query` の `signal` を自動で中断する仕組みで、内部実装に `AbortController` を使っている。

## まとめ

レースコンディションは「古い結果を捨てる」ではなく「古い処理を止める」で解く。標準 API の `AbortController` が答え。

## 参考

- [React docs: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [TanStack Query — Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)