---
title: Provider を return で描画する側は useContext できない — hoist で中間コンポーネントを消す
tags: [react, context, provider, architecture, useContext]
---

## TL;DR

- Provider を **自分の return 内で描画している**コンポーネントは、その Provider の子孫ではないので `useContext` できない。
- そのために「Context を消費するだけの中間コンポーネント」を切り出す羽目になりがち。
- Provider を 1 段上（App 直下など）に **hoist** すれば、元のコンポーネントが Provider の子孫になり直接 `useContext` できる。中間コンポーネントは不要になる。

---

## 1. 問題

`AppShell` が `<AppViewProvider>` を **return 内で描画**していた。

```tsx
function AppShell() {
  // ここで useAppView() を呼びたいが呼べない
  return (
    <AppViewProvider>
      {/* ... */}
    </AppViewProvider>
  );
}
```

`AppShell` 自身は `useAppView()` を呼べない。そのため `AppShellBody` という中間コンポーネントを切り出し、そちらで Context を消費させていた。

```tsx
function AppShell() {
  return (
    <AppViewProvider>
      <AppShellBody /> {/* ここでなら useAppView() できる */}
    </AppViewProvider>
  );
}
```

## 2. 原因

React の Context 規則上、`useContext` が値を拾えるのは **その Provider の子孫として描画されたコンポーネント**だけ。

Provider を return で描画しているコンポーネントは、Provider の**親**であって子孫ではない。よって同じコンポーネント内で `useContext` してもデフォルト値しか取れない。これは JSX の親子関係がそのまま Context の到達範囲になるという仕様どおりの挙動。

## 3. 解決

Provider を **App 直下に hoist** する。

```tsx
function App() {
  return (
    <AppViewProvider>
      <AppShell /> {/* AppShell は Provider の子孫になった */}
    </AppViewProvider>
  );
}

function AppShell() {
  const view = useAppView(); // 直接 useContext できる
  return <>{/* ... */}</>;
}
```

こうすると `AppShell` は Provider の子孫になるため、`AppShellBody` を切り出す理由が消える。結果として中間コンポーネントは完全に不要になった（+358 / −657 の簡素化）。

## 4. 判断のポイント

- 「Context を消費したいコンポーネント」と「その Provider を置く場所」は**別々に考える**。消費側で Provider を描画すると必ずこのねじれが起きる。
- Provider は**消費者より必ず上**に置く。App 直下やレイアウトの最外周に集約すると、中間ラッパーが増えない。
- 「Context を読むためだけの Body コンポーネント」が生まれていたら、それは Provider の配置が一段低いサインであることが多い。
