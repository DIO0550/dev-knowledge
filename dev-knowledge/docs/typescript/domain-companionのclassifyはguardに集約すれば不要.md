---
title: domain companion の classify/Decision 型は guard (canCreate) に集約すれば不要
tags: [typescript, domain-design, simplification, guard-pattern]
---

## 問題

`LabelAddRule.classify()` が `LabelAddDecision`（`{ kind: "empty" | "duplicate" | "added" }`）を返していた。しかし統合後のフィールドでは、結局 `canCreate` が `true` のときだけ作成が走るだけだった。

```ts
// classify が 3 分岐の Decision を返し、呼び出し側で switch させていた
const decision = LabelAddRule.classify(selection, query);
switch (decision.kind) {
  case "empty": /* 何もしない */ break;
  case "duplicate": /* 何もしない */ break;
  case "added": onChange([...selection, query.trim()]); break;
}
```

## 原因

`classify` は元々 3 分岐を「呼び出し側に判定させる」設計だった。しかし実際に必要なのは **`canCreate` という boolean と、直接の `onChange` だけ**。`empty` / `duplicate` の区別は呼び出し側の分岐でしか使われておらず、判定の内部（3 分岐）を外に漏らしていた。

## 解決

`classify` / `LabelAddDecision` を廃止し、**guard（`canCreate`）に集約**する。新規作成はワンライナーで済む。

```ts
// guard に集約
const canCreate = LabelAddRule.canCreate(selection, query);

// 呼び出し側
if (canCreate) onChange([...selection, query.trim()]);
```

- 判定はすべて **case-insensitive**（`normalize` を単一のソースに）で行い、重複判定と作成判定で正規化がぶれないようにする。
- 教訓: discriminated union の Decision を返す前に「呼び出し側はその分岐を本当に使い分けているか」を確認する。使い分けが 1 つ（作れる/作れない）なら boolean guard で足りる。

## 環境

- TypeScript（ドメイン companion パターン）
