---
title: Brand 型を unique symbol + Mapped Type で実装し companion で生成境界を閉じる
tags: [typescript, brand-type, unique-symbol, nominal-typing, companion-pattern, type-safety]
---

## 問題

同じ構造（例: `string`）を持つ**異なるドメイン型**を区別したい。TypeScript は構造的型付けで
nominal typing が無いため、`UserId` と `OrderId` が両方 `string` だと相互代入できてしまう。
Brand（幽霊型）で区別する必要がある。

## 原因

よくある `__brand: string` 形式は不十分。

```ts
type UserId = string & { __brand: "UserId" };
type OrderId = string & { __brand: "OrderId" };
```

一見区別できそうだが、`__brand` の**値の型がどちらも `string`** なので、条件次第で
構造的に互換とみなされ cross-assign を防ぎきれないケースがある。ブランドのキーが同じ名前
（`__brand`）で衝突する点も弱い。

## 解決

**`unique symbol` をキーに使い、値を Mapped Type にする。** ブランドごとに一意な symbol キーを
持つため、異なる `Name` の Brand 型間で代入不可を型レベルで保証できる。生成（cast）は
**companion の `from()` に集約**し、ドメイン外に `as` が漏れないようにする。

```ts
declare const brand: unique symbol;

// Name ごとに一意なキーを持つ Brand。B が違えば互いに代入不可
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type UserId = Brand<string, "UserId">;
export type OrderId = Brand<string, "OrderId">;

// 生成境界を companion に閉じ込める（cast はここだけ）
export const UserId = {
  from: (raw: string): UserId => raw as UserId,
};

const u: UserId = UserId.from("u_1");
// const bad: OrderId = u; // ✗ 型エラー：ブランドが異なり代入不可
```

- `unique symbol` キーにより、`Name` が異なる Brand は構造的に非互換になる。
- `as` を使うのは `from()` の内部だけ。呼び出し側は cast を書かず、**生成の境界が 1 箇所に閉じる**。

## まとめ

- `__brand: string` 形式は cross-assign を防ぎきれない。`unique symbol` キー + Mapped Type にする。
- Brand の cast は companion の `from()` に集約し、ドメイン外へ `as` を漏らさない。
- 「同じ構造だが別物」を型レベルで分離でき、`string` 同士の取り違えをコンパイル時に検出できる。
