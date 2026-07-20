---
title: useReducer + useRef ミラーを useSyncExternalStore で置き換える
tags: [react, useSyncExternalStore, state-management, external-store, async, useReducer, useRef]
---

## TL;DR

- async command（`await` 後）や外部 callback（Tauri listen など）から「今の state」を同期的に読みたい場面では、`useReducer` の state は closure に閉じて古くなる。
- 回避策として `latestStateRef.current` に手動ミラーし `dispatchSync` で二重更新するやり方は、真実が 2 箇所に分裂し、規律でしか整合が保てない。
- state の本体を React の外の素の TS オブジェクト（store）として持ち、`useSyncExternalStore` で購読するだけにすると、ref ミラー・`dispatchSync`・二重 reducer がすべて不要になる。

## 遭遇した問題

async command（Tauri `invoke` の `await` 後）や Tauri の `listen` callback が「今の state」を同期的に読みたい。React の `useReducer` の state は closure に閉じるので、`await` を跨ぐと古い値を掴んでしまう。

そこで `latestStateRef.current` に手動でミラーし、`dispatchSync` で「reducer 更新」と「ref 更新」を二重に走らせて同期を取っていた。

```tsx
// dispatch と ref ミラーを二重更新する dispatchSync
function dispatchSync(action: Action) {
  dispatch(action);
  latestStateRef.current = reducer(latestStateRef.current, action);
}
```

> 補足: 「`useReducer` は reducer が常に最新 state を第 1 引数で受け取るのでスタれない」とよく言われるが、それは **更新（dispatch）側** の話。ここで困っているのは **読み取り側**で、`await` を跨いだ後に「今の state を読んで分岐したい」ケース。この読み取りはコンポーネント関数の closure に閉じた `state` を参照するため古くなる。更新のスタレスと読み取りのスタレスは別問題である（[stale closure の解説](https://dev.to/wildboar_developer/understanding-stale-closure-in-react-a-common-pitfall-and-how-to-avoid-it-5dih)）。

## 原因

真実が 2 箇所（React の state と `latestStateRef`）にあり、「全 dispatch は必ず `dispatchSync` を通す」という規律でしか同期が守られない。

- 1 箇所でも生の `dispatch` を呼んだら、ref が更新されず黙って壊れる。
- reducer が 1 アクションあたり 2 回走る（React 側と ref 側）。

規律依存の設計は、破ったときに型でもテストでも気づけないのが本質的な弱点。

## 解決

state の本体を React の外に素の TypeScript オブジェクト（store）として置き、`createProjectStore` で `getState` / `dispatch` / `subscribe` を提供する。React 側は `useSyncExternalStore` で購読するだけにする。

```tsx
function createProjectStore(initial: ProjectState) {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: (action: Action) => {
      state = reducer(state, action); // 真実は 1 箇所
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
```

```tsx
// React 側は購読するだけ
const state = useSyncExternalStore(store.subscribe, store.getState);
```

- async command や listen callback は `store.getState()` を直接呼べば常に最新を得られる（closure に閉じない）。store 内の `state` 変数を読むだけで、コンポーネント関数の closure を経由しないため。
- 真実は store の `state` 1 箇所だけ。ref ミラー・`dispatchSync`・二重 reducer がすべて消える。
- `useSyncExternalStore` は React 18 の公式 API で、まさに「React の外にある store を購読する」ための hook。`subscribe` と `getSnapshot`（現在値を返す関数）を渡す形で、concurrent 描画中でも全コンポーネントが同一スナップショットを見る（tearing を防ぐ）ことが保証される。

### getSnapshot は安定したスナップショットを返す

`getSnapshot`（ここでは `store.getState`）は、**store が変わっていなければ毎回同じ参照を返す**必要がある（React は `Object.is` で比較し、違えば再レンダーする）。reducer は「変更時のみ新しいオブジェクトを返し、無変更なら同じ参照を返す」純関数として書くのが定石なので、この要件は自然に満たせる。逆に `dispatch` のたびに毎回新しいオブジェクトを無条件生成すると、無変更でも再レンダーが走る点だけ注意する。

## まとめ

- 「`await` を跨いで最新 state を読みたい」は React state の closure 特性と本質的に相性が悪い。ref ミラーで対症療法するより、state の在り処を React の外に出すのが構造的な解。
- state の本体を素の store に置き `useSyncExternalStore` で購読すれば、真実が 1 箇所に集約され、ref ミラー・`dispatchSync`・二重 reducer がまとめて消える。
- reducer ロジックはそのまま流用できる（store の `dispatch` 内で呼ぶだけ）。React への依存だけが外れる。

## 参考

- React 公式: [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — 「外部 store を購読する」ための hook。`subscribe` / `getSnapshot` の契約、snapshot を immutable に保つ要件、tearing 防止の仕組み。
- [Understanding Stale Closure in React](https://dev.to/wildboar_developer/understanding-stale-closure-in-react-a-common-pitfall-and-how-to-avoid-it-5dih) — `await` を跨ぐと closure が古い値を掴む問題と、ref を使う対処。本記事はその ref 対処のさらに先（store 外出し）へ進めたもの。
- [useSyncExternalStore Demystified (Kent C. Dodds / Epic React)](https://www.epicreact.dev/use-sync-external-store-demystified-for-practical-react-development-w5ac0) — 素の store（`getState` / `subscribe`）を自作して購読する実践例。Zustand / Redux など既存の状態管理ライブラリも内部で同型の「React 外 store + 購読」構造を採る。
