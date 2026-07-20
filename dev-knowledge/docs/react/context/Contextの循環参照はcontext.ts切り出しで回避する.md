---
title: Context の循環参照は context.ts への切り出しで回避する
tags: [react, context, circular-dependency, module-structure, architecture]
---

## TL;DR

- Provider ファイルに **Context 定義と Provider コンポーネントを同居**させると、Provider が描画する Container が Context を import した瞬間に循環参照になる。
- `context.ts` に **Context オブジェクト + `useXxx` hook だけ**を切り出し、Provider と Container の両方がその共通モジュールを import する構造にすれば循環が切れる。
- ポイントは「**Context 定義（データ）**」と「**Provider コンポーネント（描画）**」を別ファイルに分けること。

---

## 1. 問題

`ToastProvider` が `ToastContainer` を内蔵描画したい。だが以下の import 経路で循環参照が起きる。

```
ToastProvider.tsx  ──import──▶  ToastContainer.tsx
      ▲                                │
      └──────────import───────────────┘
   (Container が ToastContext を import するため)
```

- `ToastContainer` は通知を読むため `ToastContext`（= `ToastProvider.tsx` に定義）を import する。
- `ToastProvider` は Container を内蔵描画するため `ToastContainer` を import する。
- 結果、`ToastProvider.tsx` ⇄ `ToastContainer.tsx` の**相互 import** で循環参照になる。

循環参照は、バンドラやモジュール評価順によって **import が `undefined` になる**などの実行時バグを招く。

## 2. 原因

`ToastProvider.tsx` の中に、

- `ToastContext`（`createContext` の結果）と
- `ToastProvider`（それを描画するコンポーネント）

が**同居**していること。Container が欲しいのは前者（Context だけ）なのに、import すると後者を含むファイル全体（= Container を import している Provider ファイル）に依存してしまう。**データ定義と描画コンポーネントが同じファイルにある**のが循環の根本原因。

## 3. 解決

Context 定義と hook を `context.ts` に切り出し、Provider・Container の両方がそこを import する。

```ts
// context.ts — 定義だけ。誰も Container/Provider を import しない
import { createContext, useContext } from "react";

export const ToastContext = createContext<ToastValue | null>(null);

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (ctx == null) throw new Error("useToasts must be used within ToastProvider");
  return ctx;
}
```

```tsx
// ToastProvider.tsx — Container を描画し、context.ts の Context を提供
import { ToastContext } from "./context";
import { ToastContainer } from "./ToastContainer";
```

```tsx
// ToastContainer.tsx — 通知を読むだけ。Provider は import しない
import { useToasts } from "./context";
```

この構造では import の向きが `Provider → context ← Container` の **一方向（共通の下位モジュールへ集約）** になり、Provider ⇄ Container の相互依存が消える。

## 4. 判断のポイント

- **循環の見分け方**: 「A が B を描画するために import」かつ「B が A の定義した Context を import」なら循環候補。
- 切り出す単位は「**その Context を使う側が本当に必要とするもの**」= Context オブジェクトと hook だけ。Provider コンポーネント（描画・state）は持ち込まない。
- `context.ts` は「**誰にも依存しない葉**」にするのが理想。ここが他のコンポーネントを import し始めると、また循環の芽になる。
- 一般化すると **「データ定義」と「それを描画するコンポーネント」を同居させない**。Provider が子（Container）を内蔵描画するパターンでは特に踏みやすい。
