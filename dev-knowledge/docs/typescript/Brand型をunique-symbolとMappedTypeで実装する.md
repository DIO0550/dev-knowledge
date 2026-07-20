---
title: Brand 型を unique symbol + Mapped Type で実装し companion で生成境界を閉じる
tags: [typescript, brand-type, unique-symbol, nominal-typing, companion-pattern, type-safety]
---

## 問題

同じ構造（例: `string`）を持つ異なるドメイン型を区別したい。TypeScript は構造的型付けで **nominal typing（名前による型の区別）を持たない**ため、`UserId` と `LabelId` がどちらも `string` だと取り違えても気付けない。Brand 型で区別する必要がある。

## 原因

よくある `__brand: string` 形式には穴がある。

```ts
type UserId = string & { __brand: "UserId" };
type LabelId = string & { __brand: "LabelId" };
// __brand の型はどちらも string に統一されるため、構造的には同一とみなされ
// cross-assign を防げないケースがある
```

`__brand` の値の型を `string` にすると、異なる Brand 名でも「`string` を持つ」という一点で互換になりうる。

## 解決

キーに **`unique symbol`** を使い、値を **Mapped Type** にすることで、異なる `Name` の Brand 型どうしの代入を型レベルで不可能にする。

```ts
declare const brand: unique symbol;

type Brand<T, Name extends string> = T & {
  readonly [brand]: { [K in Name]: true };
};

type UserId = Brand<string, "UserId">;
type LabelId = Brand<string, "LabelId">;

declare const u: UserId;
declare const l: LabelId;
// const x: LabelId = u; // ← エラー（Name が異なるので代入不可）
```

生成境界は **companion pattern の `from()` に cast を集約**し、ドメイン外に生の cast を漏らさない。

```ts
export const UserId = {
  from: (s: string): UserId => s as UserId, // cast はここだけ
};
```

- `as` はこの `from()` の中だけに閉じ込め、他の場所では絶対に生成しない。これで「Brand 値の作られ方」が 1 箇所に固定される。

## 環境

- TypeScript（`unique symbol` と Mapped Type を利用）
