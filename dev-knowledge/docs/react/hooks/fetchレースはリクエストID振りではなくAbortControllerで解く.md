---
title: "React: fetchのレースコンディションはリクエストID振りではなくAbortControllerで"
tags: [react, typescript, useref, anti-pattern, race-condition, abort-controller, useeffect, cleanup, fetch, tanstack-query, custom-hook]
---

## TL;DR

- 検索バー等で「古い応答が新しい応答を上書きする」レースに対し、リクエストごとにIDを振ってrefで比較する実装は古いリクエストが走り続けるためベスプラではない。
- `AbortController` + `useEffect` cleanup で**古いリクエスト自体を中断**するのが正攻法。
- イベント駆動の場合は唯一refが正当だが、ref中身はカウンタでなく `AbortController` インスタンス。

## 遭遇した問題

検索バーで入力が変わるたびにfetch。タイピング速度より応答が遅いと、古いリクエストの結果が新しいリクエストの結果を上書きしてしまう("Macron" 検索の応答が "Trump" 検索の応答より遅れて到着し、"Trump" で検索したのに "Macron" の情報が表示される)。

AIや既存コードが `useRef` でリクエストIDを振って判定する実装を提案してくる:

```ts
function useUserSearch(query: string) {
  const [results, setResults] = useState([]);
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

「最新じゃないリクエストの結果を捨てる」という事後対処になっており、本質的な解決ではない。問題の本質は「キャンセル可能性」なのに、整数カウンタの比較で間接的に表現しているため:

- 古いリクエストはネットワーク上で完走する
- catchの中で「これは古いから無視」という分岐が増える
- ID = mutable counter は典型的な命令型コードのにおいで、Reactの宣言的モデルと噛み合わない

`AbortController` がブラウザ標準APIとして使えるようになった現代では、自前のID振りで再実装する理由がない。

## 解決

`AbortController` + `useEffect` cleanup で古いリクエスト自体を中断する。Reactは前のeffectのcleanupを実行してから次のeffectを走らせる保証があるので、queryが変わるたびに前回のリクエストが必ずabortされる。

```ts
// useUserSearch.ts ← queryが変わるたびに自動でfetch
export function useUserSearch(query: string) {
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (query === '') {
      setResults([]);
      return;
    }
    const controller = new AbortController();

    searchUsers(query, { signal: controller.signal })
      .then(setResults)
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        throw err;
      });

    return () => controller.abort();
  }, [query]);

  return results;
}
```

イベントハンドラ駆動(検索ボタンクリック等)の場合は、唯一 ref が正当なケース。ただし**refの中身はカウンタではなく `AbortController` インスタンス**:

```ts
// useUserSearchOnDemand.ts ← ボタンクリック等で明示的に発火
export function useUserSearchOnDemand() {
  const [results, setResults] = useState([]);
  const controllerRef = useRef(null);

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

「async contextで唯一正当なref使用 = render中に読まないmutable値を保持する」ケース。AbortControllerインスタンスはまさにそれに該当する。

ID振りと AbortController の対比:

| 観点 | ID振り | AbortController |
|---|---|---|
| 古いリクエスト | 走り続ける | 中断される |
| 表現 | 「最新じゃないので捨てる」 | 「もう要らないので止める」 |
| ref中身 | カウンタ(実装詳細) | 標準APIの意味あるオブジェクト |
| エラー処理 | ID比較で無視 | AbortErrorをcatch |
| TanStack Query | (使ってない) | 内部で使っている |

TanStack Queryもqueryが変わると前のqueryのsignalを自動でabortする仕組みで、内部実装が AbortController になっている。

## まとめ

レースは「古い結果を捨てる」ではなく「古い処理を止める」で解く。標準APIの `AbortController` が答え。

## 参考

- [React docs: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [TanStack Query — Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
