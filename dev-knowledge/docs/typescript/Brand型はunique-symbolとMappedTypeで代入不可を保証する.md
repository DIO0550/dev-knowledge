---
title: Brand 型を unique symbol + Mapped Type で実装し companion で生成境界を閉じる
tags: [typescript, brand-type, unique-symbol, nominal-typing, companion-pattern, type-safety]
---

## TL;DR

- TypeScript で同じ構造（`string` 等）の別ドメイン型を区別するには、非公開の `unique symbol` キー ＋ Mapped Type の Brand 型を使う。
- 文字列キーの `__brand` 形式と違い、外部プロパティ衝突や補完汚染を避けられる。`as` キャストは companion の `from()` に集約して生成境界を閉じる。

## 遭遇した問題

同じ構造（例: `string`）を持つ**異なるドメイン型**を区別したい。TypeScript は構造的型付けで nominal typing が無いため、`UserId` と `OrderId` が両方 `string` だと相互代入できてしまう。Brand（幽霊型）で区別する必要がある。

## 原因

よくある文字列キーの `__brand` 形式には弱点がある。

```ts
// NG 例1: 値型が string だと互いに代入できてしまう
type UserIdLoose = string & { __brand: string };
type OrderIdLoose = string & { __brand: string };

// 例2: リテラル型にすれば一応区別できるが、文字列キーは衝突・補完汚染が起きる
type UserId = string & { readonly __brand: "UserId" };
type OrderId = string & { readonly __brand: "OrderId" };
```

値型を `string` にすると構造的に互換となり cross-assign を防げない。リテラル型にしても、文字列プロパティ `__brand` は別モジュールの同名プロパティと衝突しうるうえ、エディタ補完にもノイズとして露出する。

## 解決

**非公開の `unique symbol` をキーに使い、値を Mapped Type（`{ readonly [K in Name]: true }`）にする。** モジュール外から参照できない `unique symbol` キーにブランド名ごとのプロパティを持たせるため、異なる `Name` の Brand 型間で代入不可を型レベルで保証でき、複数ブランドを重ねることもできる。生成（cast）は **companion の `from()` に集約**し、ドメイン外に `as` が漏れないようにする。

```ts
declare const brand: unique symbol;

// Name ごとに独立したキーを持つ Mapped Type。Name が違えば互いに代入不可
type Brand<T, Name extends string> = T & {
  readonly [brand]: { readonly [K in Name]: true };
};

export type UserId = Brand<string, "UserId">;
export type OrderId = Brand<string, "OrderId">;

// 生成境界を companion に閉じ込める（cast はここだけ）
export const UserId = {
  from: (raw: string): UserId => raw as UserId,
};

const u: UserId = UserId.from("u_1");
// const bad: OrderId = u; // ✗ 型エラー：ブランドが異なり代入不可
```

- `unique symbol` キーにより外部プロパティと衝突せず、補完も汚れにくい。Mapped Type により `Name` が異なる Brand は構造的に非互換になる。
- `as` を使うのは `from()` の内部だけ。呼び出し側は cast を書かず、**生成の境界が 1 箇所に閉じる**。

## まとめ

- 文字列キーの `__brand` 形式は衝突や補完汚染が起きる（値型を `string` にすると cross-assign も防げない）。`unique symbol` キー + Mapped Type にする。
- Brand の cast は companion の `from()` に集約し、ドメイン外へ `as` を漏らさない。
- 「同じ構造だが別物」を型レベルで分離でき、`string` 同士の取り違えをコンパイル時に検出できる。
