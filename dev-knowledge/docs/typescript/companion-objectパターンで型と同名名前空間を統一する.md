---
title: companion object パターンで型 + 同名名前空間を統一する
tags: [typescript, companion-object, domain-type, naming, design-pattern, declaration-merging]
---

## 遭遇した問題

`LabelSelection` が関数を束ねた companion（名前空間）だけで存在し、**型が定義されていなかった**。

名前がデータを表す名詞（＝そのデータ自体を指す名前）であるにもかかわらず、その名前に対応する型が無い。名詞に型が無いのは、名前と実体が噛み合っていない矛盾した状態だった。

## 原因

ドメイン companion をリネームした際に、名前が「操作の集まり」ではなく「データを表す名詞」に変わった。

リネーム前は名前空間（関数の集合）として成立していたが、名詞化したことで「その名前の型はどれか？」という問いに答えられなくなり、型の不在が問題として表面化した。

## 解決

型と同名の `const` を両方定義し、TypeScript の **declaration merging**（同名の `type` と `const` が併存できる仕組み）を活用して、型 + 同名名前空間を 1 つの名前に統一する。

```typescript
// 1. データを表す型を定義する
type LabelSelection = readonly string[];

// 2. 同名の const（companion）で操作を束ねる
const LabelSelection = {
  empty: (): LabelSelection => [],
  add: (selection: LabelSelection, label: string): LabelSelection =>
    selection.includes(label) ? selection : [...selection, label],
  has: (selection: LabelSelection, label: string): boolean =>
    selection.includes(label),
} as const;
```

これにより、

- `LabelSelection`（型として）→ `readonly string[]` を指す
- `LabelSelection`（値として）→ 操作を束ねた companion を指す

が同じ名前で共存する。companion のシグネチャは型 `LabelSelection` に合わせて再構成することで、型と操作が 1 つの名詞のもとに整合する。

## ポイント

- `type X = ...` と `const X = ...` は名前空間が別（型空間 / 値空間）なので衝突せず併存できる。これが declaration merging。
- 「名前がデータを表す名詞なら、その名前の型が存在すべき」という原則を満たすためのパターン。
- 操作（companion）のシグネチャは後付けではなく、先に定義した型に合わせて組み直す。
