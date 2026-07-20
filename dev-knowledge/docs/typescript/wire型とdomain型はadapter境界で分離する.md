---
title: wire 型と domain 型の adapter boundary パターン（Tauri IPC の実例）
tags: [typescript, ddd, adapter, wire-type, domain-type, brand-type, tauri]
---

## 問題

Tauri の IPC（`invoke`）から受け取る **wire 型**（バックエンドが返す JSON の形）と、
フロントエンドの**ドメイン型**を分離したい。

## 原因

wire 型（バックエンドが返す JSON 形状）を**そのまま FE 全体で使う**と、バックエンドの構造変更が
フロント全体に波及する。IPC の戻り値の型が UI やドメインロジックに直結してしまい、
境界（backend ↔ frontend）が型の上で消える。

## 解決

**wire 型と domain 型を分け、その間を変換する adapter 関数を境界に置く。** 手順は次の通り。

1. **wire 型を `WireXxx` にリネーム**して「これは受信生データ」と名前で明示する。
2. **adapter 関数 `fromWire` を新設**し、wire → domain の変換を 1 箇所に集約する。
3. **fixture JSON で round-trip テスト**（実際の IPC 応答形状で `fromWire` を検証）。
4. domain 型に **Brand 型**を適用し、`string` などとの取り違えを型レベルで防止する。

```ts
// 1. 受信生データ（バックエンドの JSON 形状）
type WireCard = { id: string; title: string; order: number };

// 4. ドメイン型（Brand で string との混同を防ぐ）
type CardId = string & { readonly __brand: "CardId" };
type Card = { id: CardId; title: string; order: number };

// 2. 変換を境界に閉じ込める
export function fromWire(w: WireCard): Card {
  return { id: w.id as CardId, title: w.title, order: w.order };
}
```

```ts
// 3. fixture で round-trip テスト（@fixtures/* alias で import を簡潔に）
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
- fixture JSON の round-trip テストで adapter を守り、domain 型は Brand で取り違えを防ぐ。
