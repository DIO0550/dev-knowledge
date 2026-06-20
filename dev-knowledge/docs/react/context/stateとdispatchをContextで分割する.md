---
title: state と dispatch を別 Context に分割する
tags: [react, context, useContext, useReducer, dispatch, performance, rerender]
---

## TL;DR

- `state` と更新関数（`dispatch` / setter）を**同じ Context の value にまとめて**載せると、state が変わるたびに「dispatch しか使っていないコンシューマ」まで再レンダーされる。
- `dispatch` は安定（useReducer/useState の dispatch・setter は再レンダー間で同一参照）なので、**state 用 Context と dispatch 用 Context に分ける**と、更新だけしたいコンポーネントは state 変更で再レンダーされなくなる。
- Kent C. Dodds「How to use React Context effectively」で紹介されている分割パターン。

---

## 1. 問題: state と dispatch を 1 つの Context に入れる

```tsx
const CountContext = createContext(null);

function CountProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { count: 0 });
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <CountContext.Provider value={value}>{children}</CountContext.Provider>;
}
```

この構成だと、`state` が変わるたびに value 参照が変わり、`CountContext` を読む**全コンシューマ**が再レンダーされる。

```tsx
// count を表示する（state を読む）→ 再レンダーされて当然
function CountDisplay() {
  const { state } = useContext(CountContext);
  return <div>{state.count}</div>;
}

// ボタン（dispatch しか使わない）→ count が変わるたびに巻き込まれて再レンダーされる ❌
function IncrementButton() {
  const { dispatch } = useContext(CountContext);
  return <button onClick={() => dispatch({ type: "inc" })}>+</button>;
}
```

`IncrementButton` は表示が `state` に依存していないのに、`state` 更新で再レンダーされる。これが無駄。

---

## 2. 解決: Context を 2 つに分ける

```tsx
const CountStateContext = createContext(null);
const CountDispatchContext = createContext(null);

function CountProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { count: 0 });

  return (
    // dispatch は安定参照なので、こちらの Provider の value は実質変化しない
    <CountStateContext.Provider value={state}>
      <CountDispatchContext.Provider value={dispatch}>
        {children}
      </CountDispatchContext.Provider>
    </CountStateContext.Provider>
  );
}
```

ポイント:

- `dispatch`（useReducer の dispatch、useState の setter も同様）は **再レンダー間で同一参照が保証**される。よって `CountDispatchContext` の value は変わらず、これだけを読むコンシューマは state 更新で再レンダーされない。
- `CountStateContext` を読むコンシューマだけが state 更新で再レンダーされる。

```tsx
function IncrementButton() {
  const dispatch = useContext(CountDispatchContext);
  // state が変わっても再レンダーされない ✅
  return <button onClick={() => dispatch({ type: "inc" })}>+</button>;
}
```

---

## 3. throw パターンと組み合わせる

Provider 必須なら、各 Context に Provider 外アクセスを throw するカスタムフックを用意すると安全（→ 「useContext で Provider 外アクセス時に throw するパターン」参照）。

```tsx
function useCountState() {
  const ctx = useContext(CountStateContext);
  if (ctx === null) throw new Error("useCountState must be used within CountProvider");
  return ctx;
}

function useCountDispatch() {
  const ctx = useContext(CountDispatchContext);
  if (ctx === null) throw new Error("useCountDispatch must be used within CountProvider");
  return ctx;
}
```

---

## 4. いつ分割すべきか

- **分割する**: dispatch だけ使うコンポーネントが多い／state が頻繁に変わる／再レンダーコストが見えてきた、というとき効く。
- **やりすぎない**: コンシューマが少なく再レンダーが問題になっていないなら、1 つの Context のままで十分。分割は Context が 2 つになり Provider のネストも増えるので、必要になってから入れる。

`state` が変わってもいないのに再レンダーされる無駄を消すのが目的。問題が無いうちは素朴な 1 Context で構わない。

---

## まとめ

1. state と dispatch を 1 Context にまとめると、dispatch だけ使うコンシューマも state 更新で再レンダーされる。
2. dispatch/setter は安定参照なので、state 用と dispatch 用に Context を分けると更新専用コンポーネントの巻き込みが消える。
3. 各 Context に throw 付きカスタムフックを添えると Provider 必須化も両立できる。
4. 再レンダーが実際に問題になってから入れる（早すぎる分割は不要）。

> 参考: Kent C. Dodds "How to use React Context effectively"
