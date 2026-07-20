---
title: Context 循環参照回避 — context.ts 切り出しパターン
tags: [react, context, circular-dependency, module-structure, architecture]
---

## 問題

`ToastProvider` が `ToastContainer` を内蔵して描画したい。しかし `ToastContainer` は `ToastContext` を import する必要があり、次の循環参照が生まれた。

```
ToastContainer → import ToastContext（Provider ファイル内で定義）
ToastProvider  → import ToastContainer
= Provider ファイル ⇄ Container ファイル の循環参照
```

## 原因

Provider ファイルに **Context 定義と Provider コンポーネントを同居**させると、Container が Context を使うために Provider ファイルを import し、Provider が Container を import する経路で循環が発生する。

## 解決

`context.ts` に **`ToastContext` + `useToasts` フックを切り出し**、Provider と Container の**両方がこの共通モジュールを import** する構造にする。これで Provider ⇄ Container の直接依存が切れる。

```
context.ts      : ToastContext, useToasts()   ← 依存の底
ToastProvider   → import { ToastContext } from "./context"
ToastContainer  → import { useToasts } from "./context"
ToastProvider   → import ToastContainer   （一方向のみ・循環なし）
```

```ts
// context.ts
export const ToastContext = createContext<ToastCtx | null>(null);
export const useToasts = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used within ToastProvider");
  return ctx;
};
```

- 原則: Context 定義（`createContext` と `useXxx` フック）は Provider/Container のどちらでもない**中立なモジュール**に置く。UI コンポーネント間の相互 import を避けられる。

## 環境

- React（Context / モジュール構成）
