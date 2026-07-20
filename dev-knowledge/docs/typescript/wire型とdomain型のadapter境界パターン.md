---
title: wire 型と domain 型を adapter boundary で分離する（Tauri IPC の実例）
tags: [typescript, ddd, adapter, wire-type, domain-type, brand-type, tauri, boundary]
---

## 問題

Tauri の IPC（`invoke`）から受け取る JSON の形（wire 型）と、フロントエンドで扱いたいドメイン型を分離したい。両者を同じ型で扱うと境界が曖昧になる。

## 原因

wire 型（バックエンドが返す JSON の形状）を**そのまま FE 全体で使う**と、バックエンドのスキーマ変更がフロント全体へ波及する。ドメインの語彙（Brand 型・不変条件）を wire 型に載せられず、`string` 同士の取り違えも防げない。

## 解決

wire とドメインの間に **adapter boundary** を 1 枚挟む。手順は次の 4 つ。

1. **wire 型を `WireXxx` にリネーム**して「これは外部の形」であることを名前で明示する。
2. **adapter 関数 `fromWire` を新設**し、変換をこの 1 箇所に閉じ込める。
3. **fixture JSON で round-trip テスト**を書き、wire → domain → （必要なら wire）の変換を固定する。
4. ドメイン型に **Brand 型**を適用し、素の `string` との混同を型レベルで防ぐ。

```ts
// 1. 外部（バックエンド）の形
type WireLabel = { id: string; name: string };

// 4. ドメイン型（Brand で string と区別）
type LabelId = string & { readonly __brand: "LabelId" };
type Label = { id: LabelId; name: string };

// 2. 変換をここだけに集約
const fromWire = (w: WireLabel): Label => ({
  id: w.id as LabelId,
  name: w.name,
});
```

- テスト時の import は `@fixtures/*` の path alias を張ると、fixture ファイルの参照が簡潔になる。

```ts
// 3. fixture で round-trip を固定
import label from "@fixtures/label.json";
test("fromWire maps wire to domain", () => {
  expect(fromWire(label).name).toBe(label.name);
});
```

## 効果

- バックエンドのスキーマ変更の影響が `fromWire` に局所化される。
- ドメイン層は Brand 型で守られ、`string` の取り違えがコンパイル時に落ちる。

## 環境

- TypeScript + Tauri（IPC）。fixture の import には `@fixtures/*` alias を使用。
