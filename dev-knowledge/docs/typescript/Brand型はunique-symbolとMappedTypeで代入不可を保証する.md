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

- `unique symbol` キーにより外部プロパティと衝突せず、補完も汚れにくい。Brand はコンパイル時だけの存在で、実行時プロパティは増えずコスト 0 で扱える。
- `as` を使うのは `from()` の内部だけ。呼び出し側は cast を書かず、**生成の境界が 1 箇所に閉じる**。

### なぜ値を Mapped Type にするのか

ブランド値を単なるリテラル（`{ readonly [brand]: Name }`）にすると、複数ブランドを重ねたときに交差型が壊れる。`{ readonly [brand]: "A" } & { readonly [brand]: "B" }` は `[brand]: "A" & "B"` となり `never` に潰れてしまう。

`{ readonly [K in Name]: true }` にしておくと、`{ readonly A: true } & { readonly B: true }` と合成でき、「A かつ B のブランド」をそのまま表現できる。単一ブランドしか使わないならリテラル版でも足りるが、合成可能性を残すなら Mapped Type 版が安全。

### 検証を伴う生成（assertion 関数）

形式チェックとブランド付与を同時に行いたい場合は、TypeScript の assertion 関数に閉じ込める手もある。

```ts
function assertUserId(raw: string): asserts raw is UserId {
  if (!/^u_/.test(raw)) {
    throw new Error(`invalid UserId: ${raw}`);
  }
}
```

## まとめ

- 文字列キーの `__brand` 形式は衝突や補完汚染が起きる（値型を `string` にすると cross-assign も防げない）。`unique symbol` キー ＋ Mapped Type にする。
- Mapped Type（`{ readonly [K in Name]: true }`）にしておくと、複数のブランドを交差型で合成しても `never` に潰れない。
- Brand はコンパイル時のみ（実行時コスト 0）。生成の `as` は companion の `from()` か assertion 関数に集約し、ドメイン外へ漏らさない。

## 参考

- [Branded Types | Learning TypeScript](https://www.learningtypescript.com/articles/branded-types)
- [TypeScript: Playground Example - Nominal Typing](https://www.typescriptlang.org/play/typescript/language-extensions/nominal-typing.ts.html)
- [Branded Types | Effect Documentation](https://effect.website/docs/code-style/branded-types/)
