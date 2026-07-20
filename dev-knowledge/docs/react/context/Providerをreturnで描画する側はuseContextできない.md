---
title: Provider を return で描画する側は useContext できない — hoist で中間コンポーネントを消す
tags: [react, context, provider, useContext, architecture, hoist]
---

## TL;DR

- Provider を **自分の `return` の中で描画している**コンポーネントは、その Provider の**子孫ではない**ので `useContext` できない。
- そのために「Context を消費するだけの中間コンポーネント」を切り出す羽目になりがち。
- Provider を**上位（App 直下など）に hoist** すれば、元のコンポーネントが Provider の子孫になり、直接 `useContext` できる。中間コンポーネントは丸ごと不要になる。

---

## 問題

`AppShell` が `<XxxProvider>` を `return` 内で描画していたため、`AppShell` 自身は `useAppView()`（= Provider の Context を読む hook）を呼べなかった。

そのため、Context を消費させるためだけに `AppShellBody` という中間コンポーネントを切り出していた。

```tsx
// ❌ AppShell 自身は Provider の子孫ではないので useContext できない
function AppShell() {
  // ここで useAppView() を呼びたいが、Provider はこの return の中にある → 読めない
  return (
    <AppViewProvider>
      <AppShellBody /> {/* Context を読むためだけの中間コンポーネント */}
    </AppViewProvider>
  );
}

function AppShellBody() {
  const view = useAppView(); // ここでは読める（Provider の子孫だから）
  // ...
}
```

## 原因

React の Context の規則上、`useContext(SomeContext)` は**その Context の Provider の子孫**でのみ有効。

「Provider を return で描画している」コンポーネントは、Provider を**レンダーしている**だけで、自身は Provider の**外側（親）**にいる。よって子孫ではなく、`useContext` は Provider の値ではなくデフォルト値を返す（＝読めていない）。

## 解決

Provider を**上位に hoist** する。App 直下など、`AppShell` より外側に Provider を置けば、`AppShell` は Provider の子孫になり、直接 `useContext` できる。

```tsx
// ✅ Provider を App 直下に hoist
function App() {
  return (
    <AppViewProvider>
      <AppShell />
    </AppViewProvider>
  );
}

function AppShell() {
  const view = useAppView(); // Provider の子孫になったので直接読める
  // ...AppShellBody は完全に不要
}
```

結果、Context を読むためだけの `AppShellBody` が完全に不要になり、`+358 / -657` の簡素化につながった。

## 教訓

- 「Context が読めないから中間コンポーネントを切る」は、多くの場合**設計のにおい**。まず Provider の位置を疑う。
- Provider は「それを読みたいコンポーネントより上」に置く。同じコンポーネントで**描画も消費も**しようとした時点で構造が破綻する。
