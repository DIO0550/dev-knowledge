---
title: companion object パターンで型 + 同名名前空間を統一する
tags: [typescript, companion-object, domain-type, naming, design-pattern, declaration-merging]
---

## 問題

`LabelSelection` は関数を束ねた companion（名前空間としての `const`）だけで、**型が存在しなかった**。名前がデータを表す名詞なのに、その名詞を指す型がないのは矛盾している。

```ts
// companion（振る舞い）だけがあり、データ型がない
export const LabelSelection = {
  isEmpty: (s: readonly string[]) => s.length === 0,
  add: (s: readonly string[], v: string) => [...s, v],
};
// LabelSelection という「型」が使えない → 引数の型は毎回 readonly string[] と手書き
```

## 原因

ドメイン companion を、より意味の伝わる名前へリネームした際に、名前が「データを表す名詞」に変わった。名詞になったことで、**同名の型が無いこと自体が設計上の欠陥**として表面化した。振る舞い（companion）とデータ（型）が同じ名前で揃っていないと、呼び出し側は型注釈を手書きし続けることになる。

## 解決

`type` を定義し、companion のシグネチャをその型に合わせて再構成する。TypeScript の **declaration merging**（同名の `type` と `const` が共存できる性質）を活用すると、値と型が 1 つの名前に統一される。

```ts
// データ型
export type LabelSelection = readonly string[];

// 同名の companion（振る舞い）。型に合わせてシグネチャを揃える
export const LabelSelection = {
  isEmpty: (s: LabelSelection): boolean => s.length === 0,
  add: (s: LabelSelection, v: string): LabelSelection => [...s, v],
};
```

- 呼び出し側は `LabelSelection`（型）と `LabelSelection.add(...)`（振る舞い）を同じ名前で使える。
- 「名詞（データ）には型を、その操作には同名 companion を」を原則にすると、ドメインの語彙が型・値の両方で一貫する。

## 環境

- TypeScript（`type` と `const` の同名 declaration merging を利用）
