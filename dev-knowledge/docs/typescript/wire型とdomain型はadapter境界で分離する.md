---
title: wire 型と domain 型の adapter boundary パターン（Tauri IPC の実例）
tags: [typescript, ddd, adapter, wire-type, domain-type, brand-type, tauri]
---

## TL;DR

- バックエンド IPC（`invoke`）が返す JSON 形状（**wire 型**）をそのままフロントエンド全体で使わず、**domain 型**と分離する。
- 境界に `fromWire` adapter 関数を置き、Brand 型への変換もここに閉じ込めることで、バックエンド構造変更の影響を局所化できる。

## 遭遇した問題

Tauri の IPC（`invoke`）から受け取る **wire 型**（バックエンドが返す JSON の形）と、フロントエンドの**ドメイン型**を分離したい。

## 原因

wire 型（バックエンドが返す JSON 形状）を**そのままフロントエンド全体で使う**と、バックエンドの構造変更がフロント全体に波及する。IPC の戻り値の型が UI やドメインロジックに直結してしまい、境界（backend ↔ frontend）が型の上で消える。

## 解決

**wire 型と domain 型を分け、その間を変換する adapter 関数を境界に置く。** 手順は次の通り。

1. **wire 型を `WireXxx` にリネーム**して「これは受信生データ」と名前で明示する。
2. **adapter 関数 `fromWire` を新設**し、wire → domain の変換を 1 箇所に集約する。
3. **fixture JSON で adapter の変換テスト**（実際の IPC 応答形状で `fromWire` や往復変換を検証）。
4. domain 型に **Brand 型**を適用し、`string` などとの取り違えを型レベルで防止する（実装詳細は [Brand 型を unique symbol + Mapped Type で実装](./Brand型はunique-symbolとMappedTypeで代入不可を保証する.md) を参照）。

```ts
// 1. 受信生データ（バックエンドの JSON 形状）
type WireCard = { id: string; title: string; order: number };

// 4. ドメイン型（Brand で string との混同を防ぐ）
type CardId = Brand<string, "CardId">;
type Card = { id: CardId; title: string; order: number };

// 2. 変換を境界に閉じ込める
export function fromWire(w: WireCard): Card {
  return { id: CardId.from(w.id), title: w.title, order: w.order };
}
```

```ts
// 3. fixture で adapter 変換テスト（@fixtures/* alias で import を簡潔に）
import cardJson from "@fixtures/card.json";
test("fromWire maps wire shape to domain", () => {
  const card = fromWire(cardJson);
  expect(card.title).toBe("Sample");
});
```

- `@fixtures/*` alias（tsconfig `paths` / bundler 設定）を張ると fixture の import が簡潔になる。
- バックエンドが JSON 形状を変えても、影響は `WireCard` と `fromWire` に**局所化**される。

## まとめ

- IPC の戻り値をそのまま使わず、`WireXxx`（受信生データ）と domain 型を分離する。
- 変換は `fromWire` adapter に集約し、backend の変更を境界に閉じ込める。
- fixture JSON のテストで adapter を守り、domain 型は Brand で取り違えを防ぐ。
