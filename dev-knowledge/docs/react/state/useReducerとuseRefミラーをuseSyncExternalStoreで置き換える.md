---
title: useReducer + useRef ミラーを useSyncExternalStore で置き換える
tags: [react, useSyncExternalStore, state-management, external-store, async]
---

## TL;DR

- async command（await 後）や外部の listen callback が「今の state」を同期的に読みたいとき、`useReducer` の state は closure に閉じて await を跨ぐと古くなる。
- 対策として `latestStateRef.current` に手動ミラーして `dispatchSync` で二重更新する運用は、真実が 2 箇所に分かれて規律頼みになり脆い。
- state の本体を **React の外**に素の TS オブジェクト（store）として置き、`getState` / `dispatch` / `subscribe` を提供、React 側は `useSyncExternalStore` で購読するだけにすると、ref ミラーも dispatchSync も二重 reducer も不要になる。

---

## 1. 問題

async command（例: Tauri `invoke` の `await` 後）や Tauri の `listen` callback が「今の state」を同期的に読みたい。

React の `useReducer` が返す `state` は closure に閉じるので、`await` を跨ぐと**古い値**になる。

```tsx
async function runCommand() {
  await invoke("do_something");
  // ここの state は await 前の closure に閉じた古い state
}
```

そこで `latestStateRef.current` に最新 state を手動でミラーし、`dispatchSync` で「reducer 更新 + ref 更新」を二重に走らせて凌いでいた。

## 2. 原因

真実が **2 箇所**（React state と `latestStateRef`）に存在し、両者の同期は「全 dispatch が必ず `dispatchSync` を通る」という**規律**でしか守られない。

- どこか 1 箇所でも生の `dispatch` を呼ぶと、ref が更新されず**黙って壊れる**。
- `dispatchSync` は reducer を呼んで新 state を得て ref にも書くため、reducer が毎 action **2 回**走る。

規律に依存する設計は、レビューや将来の変更で簡単に破れる。

## 3. 解決

state の本体を React の外に、素の TS オブジェクト（store）として置く。

```ts
function createProjectStore(initial) {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: (action) => {
      state = reducer(state, action);
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
```

React 側は `useSyncExternalStore` で購読するだけ。

```tsx
const state = useSyncExternalStore(store.subscribe, store.getState);
```

- async command や listen callback は `store.getState()` を呼べば**常に最新**を同期的に読める（closure に閉じない）。
- 真実は store の `state` 1 箇所だけ。ref ミラーは不要。
- `dispatch` は 1 回だけ reducer を呼ぶ。二重更新も消える。
- `dispatchSync` という特別な dispatch を通す規律そのものが不要になる。

## 4. 判断のポイント

- 「await や外部 callback から最新 state を同期的に読みたい」という要求が出たら、それは state が React の closure に閉じていることが本質的なミスマッチのサイン。
- ref ミラー + 専用 dispatch で凌ぐと「真実が 2 箇所 + 規律頼み」になる。真実を React の外の store 1 箇所に集約し、`useSyncExternalStore` で React に流し込む方が壊れにくい。
- store は React 非依存の素の TS なので、テストも React 抜きで書ける副産物がある。
