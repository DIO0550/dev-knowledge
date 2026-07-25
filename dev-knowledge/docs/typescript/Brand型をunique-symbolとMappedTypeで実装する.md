---
title: Brand 型を unique symbol + Mapped Type で実装し companion で生成境界を閉じる
tags: [typescript, brand-type, unique-symbol, nominal-typing, companion-pattern, type-safety]
---

## TL;DR

- TypeScript は**構造的型付け**なので、同じ構造（例: `string`）を持つ `UserId` と `LabelId` は互換になり、取り違えても気付けない。**Brand（opaque）型**で名前的な区別を後付けする。
- ブランドのキーは `__brand` のような**文字列プロパティではなく `unique symbol`** にする。文字列キーだと (1) 実行時の実プロパティと衝突しうる、(2) IDE の補完に `__brand` が出てノイズになる。`unique symbol` はこの 2 つを回避できる。
- ブランド値を **Mapped Type（`{ [K in Name]: true }`）**にしておくと、複数ブランドを重ねても交差型がきれいに合成でき、単なる文字列リテラルより composable になる。
- Brand は**コンパイル時だけの存在**（実行時にプロパティは増えず、コスト 0）。生成に必要な `as` cast は **companion の `from()`（または assertion 関数）に集約**し、ドメイン外へ生の cast を漏らさない。

---

## 1. 問題: 構造的型付けは同型の別ドメインを区別しない

TypeScript の型システムは**構造的（structural / duck typing）**で、「形が同じなら同じ型」とみなす。名前的（nominal）な区別は無い。

```ts
type UserId = string;
type LabelId = string;

declare function loadUser(id: UserId): void;
const label: LabelId = "label-1";
loadUser(label); // ✅ 通ってしまう（どちらも string なので互換）
```

`UserId` と `LabelId` は別ドメインの ID なのに、素の `string` では取り違えがコンパイルを通過する。

---

## 2. Brand（opaque）型で名前的区別を後付けする

交差型でブランドを足すと、構造が同じでも別型として扱える。まずよくある**文字列リテラルキー**版:

```ts
type UserId = string & { readonly __brand: "UserId" };
type LabelId = string & { readonly __brand: "LabelId" };
// __brand のリテラルが異なるので UserId ⇄ LabelId の代入は不可
```

補足: 文字列リテラル（`"UserId"`）を使えば cross-assign は防げる（リテラル型が異なるため）。ただし文字列キーには次の弱点がある。

- **実行時プロパティとの衝突リスク**: サードパーティのオブジェクトがたまたま `__brand` を持つと、意図せず型が合致しうる。
- **IDE 補完の汚染**: `value.` と打つと `__brand` が候補に出る。

---

## 3. 解決: キーを `unique symbol` にする

`unique symbol` は「唯一の特定のシンボル」を表す型で、他のプロパティキーと**衝突し得ない**。補完にも出ない。

```ts
declare const brand: unique symbol;

type Brand<T, Name extends string> = T & {
  readonly [brand]: { [K in Name]: true };
};

type UserId = Brand<string, "UserId">;
type LabelId = Brand<string, "LabelId">;

declare const u: UserId;
const x: LabelId = u; // ❌ エラー（brand の中身が異なるので代入不可）
```

### なぜ値を Mapped Type にするのか

ブランド値を単なるリテラル（`{ [brand]: Name }`）にすると、複数ブランドを重ねたときに交差型が壊れる。`{ [brand]: "A" } & { [brand]: "B" }` は `[brand]: "A" & "B"` = `never` になってしまう。

`{ [K in Name]: true }`（＝レコード）にしておくと、`{ A: true } & { B: true }` = `{ A: true; B: true }` と**きれいに合成**でき、「A かつ B のブランド」を素直に表現できる。単一ブランドしか使わないなら `{ readonly [brand]: Name }` でも足りるが、composable にしたいなら Mapped Type 版が安全。

---

## 4. 生成境界を companion に閉じる

Brand は実行時には存在しない（`{ [brand]: ... }` は型だけ）。値を作るには `as` cast か assertion 関数が要る。`as` は危険なので、**生成を 1 箇所（companion の `from()`）に集約**し、それ以外の場所で生の cast を書かない。

```ts
export const UserId = {
  // cast はここだけ。検証が必要ならここで throw する
  from: (s: string): UserId => s as UserId,
};

// 呼び出し側は from() 経由でしか作れない
const id = UserId.from(row.user_id);
```

より安全にするなら、**assertion 関数**で検証してからブランドを付ける。

```ts
function assertUserId(s: string): asserts s is UserId {
  if (!/^user-/.test(s)) throw new Error(`invalid UserId: ${s}`);
}
```

---

## まとめ

1. TypeScript は構造的型付けなので、同型の別ドメイン（`UserId` / `LabelId`）は素の型では区別できない。
2. Brand（opaque）型で名前的区別を後付けする。キーは `unique symbol` にして、実行時プロパティ衝突と補完ノイズを避ける。
3. ブランド値を Mapped Type（`{ [K in Name]: true }`）にすると複数ブランドが composable になる。
4. Brand はコンパイル時のみ（コスト 0）。生成の `as` は companion の `from()` か assertion 関数に集約し、ドメイン外へ漏らさない。

> 参考:
> - [Branded Types | Learning TypeScript（Josh Goldberg）](https://www.learningtypescript.com/articles/branded-types)
> - [TypeScript: Playground Example - Nominal Typing（公式）](https://www.typescriptlang.org/play/typescript/language-extensions/nominal-typing.ts.html)
> - [Branded Types | Effect Documentation](https://effect.website/docs/code-style/branded-types/)
