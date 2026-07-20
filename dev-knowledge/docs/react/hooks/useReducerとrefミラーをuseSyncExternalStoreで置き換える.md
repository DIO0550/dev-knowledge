---
title: useReducer + useRef ミラーを useSyncExternalStore で置き換える
tags: [react, useSyncExternalStore, state-management, external-store, async, useReducer, useRef]
---

## TL;DR

- async command（`await` 後）や外部イベント callback が「今の state」を**同期的に**読みたいとき、`useReducer` の state は closure に閉じるので `await` を跨ぐと古い。
- 回避策として `latestStateRef.current` に手動ミラーし、`dispatchSync` で「reducer 更新 + ref 更新」を二重に行うパターンがあるが、**真実が 2 箇所**にあり規律頼みで壊れやすい。
- state 本体を React の外に**素の TS オブジェクト（store）**として置き、`useSyncExternalStore` で購読すれば、ref ミラー・`dispatchSync`・二重 reducer がすべて不要になる。

---

## 問題

async command（例: Tauri `invoke` の `await` 後）や、外部イベントの listen callback（例: Tauri `listen`）が「今の state」を同期的に読みたい。

しかし React の `useReducer` が返す `state` は**その時点の closure に閉じる**ため、`await` を跨ぐと古い値になる。

```tsx
// ❌ await を跨ぐと state は古い（closure に閉じているため）
async function runCommand() {
  await invoke("do_something");
  console.log(state); // ← await 前の古い state
}
```

そこで `latestStateRef.current` に「今の state」を手動でミラーし、更新は `dispatchSync` を通して「reducer で更新 + ref にも書く」を二重に行っていた。

```tsx
// ❌ 真実が 2 箇所: React state と ref。dispatchSync 規律でしか同期されない
const latestStateRef = useRef(initialState);
function dispatchSync(action) {
  const next = reducer(latestStateRef.current, action);
  latestStateRef.current = next; // ref を更新
  dispatch(action);              // React state も更新（reducer が二重に走る）
}
```

## 原因

真実が **2 箇所**（React の state と `latestStateRef`）にある。

- 両者の同期は「**全ての dispatch が `dispatchSync` を通る**」という規律でしか守られない。1 箇所でも生の `dispatch` を呼んだら、黙って ref がずれて壊れる。
- `dispatchSync` の中で reducer を呼び、さらに `dispatch` 経由でも reducer が走るため、**reducer が毎 action 2 回走る**。

## 解決

state の**本体を React の外**に、素の TS オブジェクト（store）として置く。`createProjectStore` のようなファクトリで `getState` / `dispatch` / `subscribe` を提供し、React 側は `useSyncExternalStore` で購読するだけにする。

```tsx
// ✅ state 本体は React の外。単一の真実。
function createProjectStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  return {
    getState: () => state,
    dispatch: (action) => {
      state = reducer(state, action); // reducer は 1 回だけ
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
```

```tsx
// React 側は購読するだけ
const state = useSyncExternalStore(store.subscribe, store.getState);

// async command からは store.getState() で常に最新を同期的に読める
async function runCommand() {
  await invoke("do_something");
  const now = store.getState(); // ← 常に最新
}
```

これで以下がすべて不要になる。

- `latestStateRef` の手動ミラー
- `dispatchSync`（真実が 1 箇所なので二重更新が消える）
- reducer の二重実行

## 教訓

- 「await / 外部 callback から最新 state を同期的に読みたい」は、**state を React の外に置く**動機。React state は render 用のスナップショット、store は真実、と役割を分ける。
- ref ミラー + 独自 `dispatchSync` は「規律が守られている限り正しい」実装で、1 箇所の抜けで黙って壊れる。`useSyncExternalStore` は**真実を 1 箇所**に集約し、この規律依存を消す標準 API。
