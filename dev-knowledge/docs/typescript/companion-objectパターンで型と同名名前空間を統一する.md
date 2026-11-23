---
title: companion object パターンで型 + 同名名前空間を統一する
tags: [typescript, companion-object, domain-type, naming, design-pattern, declaration-merging]
---

## TL;DR

- データを表す名詞で companion（関数群のオブジェクト）を作るなら、同名の `type` も定義して型と操作を 1 つの名前に統一する。
- TypeScript は型空間と値空間が別のため、同名の `type X` と `const X` は衝突せず共存できる（companion object パターン）。

## 遭遇した問題

`LabelSelection` のようなデータ名詞が関数を束ねた companion（名前空間）だけで存在し、**対応する型が定義されていなかった**。名前がデータを指す名詞であるにもかかわらず型が無いと、「その名前の型はどれか」が曖昧になり、名前と実体が噛み合わなくなる。

## 原因

操作の集合をリファクタリングやリネームで「データを表す名詞」へ変えた際、値（関数の束）だけを残して型定義を揃えないと、型の不在が問題として表面化する。

## 解決

型と同名の `const` を両方定義し、TypeScript の**型空間と値空間が独立している仕様**を活かして、型 + 同名名前空間を 1 つの名前に統一する（companion object パターン）。

```ts
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

## まとめ

- `type X = ...` と `const X = ...` は名前空間（型空間 / 値空間）が別のため衝突せず併存できる。
- 「名前がデータを表す名詞なら、その名前の型が存在すべき」という原則を満たすためのパターン。
- 操作（companion）のシグネチャは後付けではなく、先に定義した型に合わせて組み直す。
