---
title: 手動発火hookを呼び出し側で順番に繋ぐとuseEffect連鎖（地獄）になる
tags: [react, hooks, useEffect, data-fetching, anti-pattern, event-handler, promise-all, async-await, design]
---

## TL;DR

- 「useEffectを持たないhook（コール関数 + loading/error + 結果を保持、発火は呼び出し側が手動）」を複数用意し、呼び出し側で「Aの結果が来たらBを呼ぶ」と順番に繋ごうとすると、その「結果が来たら次」を表現する手段が呼び出し側のuseEffect連鎖になる。これがいわゆる「useEffect地獄」。
- React公式はこの「Effectの連鎖（chain of Effects）」を明確にアンチパターンとしている。理由は (1) 連鎖の各setの間に再レンダリングが挟まり非効率、(2) 要件が変わると連鎖が破綻する。
- 「イベントハンドラがstateフラグをセット → useEffectがそれを監視 → 次のリクエストを発火」も同型のアンチパターンとして名指しされている。
- 正しい代替は、一連の処理を1つのトリガー（イベントハンドラ／1つのhook関数）の中にまとめ、`const a = await callA(); const b = await callB(a);` と素直に直列で書くこと。状態(loading/error/result)もその関数内で更新する。
- よって「複数の手動発火hookを呼び出し側のuseEffect連鎖で繋ぐくらいなら、1つのhookの中で順序と状態をまとめて管理する方がいい」という判断は、React公式の指針と一致する。

## このドキュメントの射程

- データフェッチライブラリ（TanStack Query / SWR 等）を使わない前提での、複数API呼び出しの取り回し方の設計判断。
- 検討対象のhook設計: hook自体はuseEffectを持たず、「API呼び出し関数」「呼び出し状態(loading/error)」「取得結果」だけを保持する。発火タイミングは呼び出し側が制御する（マウント時の自動fetchはしない）。
- この設計のhookを「1 API = 1 hook」で複数用意し、呼び出し側でAPIを順番に呼びたい、というシナリオ。

## 原因

呼び出し側で「Aを呼ぶ → Aの結果が来たらBを呼ぶ → Bの結果が来たらCを呼ぶ」を繋ぐとき、各hookの結果は state として返ってくる。「結果が来た」というタイミングを呼び出し側で捕まえる手段は、その state を依存配列に入れた useEffect になる。結果、API数だけ useEffect が並び、しかも互いの結果に依存して連鎖する構造（chain of Effects）が呼び出し側に生まれる。

React公式はこの連鎖を2つの理由で問題視している。

1. 非効率: 連鎖の各 set 呼び出しの間にコンポーネント（と子）が再レンダリングされる。`setCard → render → setGoldCardCount → render → setRound → render → setIsGameOver → render` のように、最悪の場合ツリーに複数回の不要な再レンダリングが発生する。
2. 脆さ: たとえ速度が問題なくても、コードが進化すると書いた「連鎖」が新しい要件に合わなくなるケースに必ず遭遇する。

また「手動発火hookを呼び出し側で繋ぐ」具体的な形 ——「イベントハンドラがstateフラグをセットし、それをuseEffectの依存配列が監視し、Effectがフラグをチェックしてリクエストを発火する」—— は、コンポーネントの複雑さを不必要に増やす大きな元凶として名指しされている。「Aの結果が来たことをstateで表し、それをuseEffectが拾ってBを発火する」がまさにこれに当たる。

なお前提として、データフェッチをuseEffectで手書きすること自体、React公式は推奨していない（useEffectは「Reactの外の世界と対話するための避難ハッチ」であり、外部システムが関与しないなら不要）。連鎖はその避難ハッチを依存関係付きで積み増す形なので、より悪い。

## 解決

一連の処理を「1つのトリガー」の中にまとめる。React公式の指針は「画面に表示されたから実行されるコードはEffectに、それ以外（特定の操作に起因する処理）はイベントに置く」「複数の状態を更新する必要があるなら単一のイベントの中でやる」。順次API呼び出しは「1つの操作（あるいは初回ロードという1つのトリガー）に起因する一連の処理」なので、その中で直列に書き切るのが正しい。

具体的には、1つのhook（または1つの関数）の中で「呼び出し順序 + loading/error + 結果」をまとめて管理する。

```ts
// ❌ アンチパターン: 手動発火hookを呼び出し側のuseEffect連鎖で繋ぐ
function Component() {
  const { call: callA, result: a } = useApiA(); // hook自体はuseEffectなし
  const { call: callB, result: b } = useApiB();

  useEffect(() => {
    callA();
  }, []);

  // aが来たらBを呼ぶ ... これが連鎖の入口
  useEffect(() => {
    if (a) callB(a.id);
  }, [a]);

  // bが来たら... さらにC、D...と連鎖が伸びる
}

// ✅ 1つのトリガー内で直列に書く。stateも関数内で更新
function useSequentialFlow() {
  const [state, setState] = useState({ loading: false, error: null, data: null });

  const run = async () => {
    setState({ loading: true, error: null, data: null });
    try {
      const a = await callApiA();          // 依存があるので直列
      const b = await callApiB(a.id);
      const c = await callApiC(b.token);
      setState({ loading: false, error: null, data: c });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  };

  return { ...state, run };
}
```

補足の判断軸（前提の使い分け）:

- 呼び出し間に依存があるなら直列（`await` を順番に）。
- 独立しているなら `Promise.all`（ウォーターフォール回避のため）。一部失敗を許容したいなら `Promise.allSettled`。
- いずれの場合も、発火は1つのトリガー内。state を介して次を発火する形（＝useEffect連鎖）にはしない。

注意: 「1 hookにまとめる」と言っても、その中身を「useEffectでstateを介して次を発火する」形にしては意味がない。hookが公開する関数の中で `await` を素直に直列で並べ、状態はその関数内で更新する。そうすれば呼び出し側にもhook内にもEffect連鎖が生まれない。

## まとめ

「結果が来たら次を呼ぶ」をstate + useEffectで表現するのが連鎖の正体。一連の処理は1つのトリガー内で `await` 直列に書き、状態もそこで更新すれば、useEffect地獄を回避できる。

## 参考

- React公式「You Might Not Need an Effect」: Effectの連鎖の2つの問題、ロジックはイベント／単一イベント内にまとめる指針。 https://react.dev/learn/you-might-not-need-an-effect
- React anti-patterns that lead to unnecessary complexity: 相互依存する連鎖Effectが「complexity hell」を生む具体例。 https://letsbuild.cloud/2024-02-22-react-anti-patterns.html
- An Ode to React Effects (Alex Kondov): 「イベントハンドラがフラグをセット→useEffectが監視→リクエスト発火」がコンポーネント複雑化の元凶という指摘。 https://alexkondov.com/an-ode-to-effects/
