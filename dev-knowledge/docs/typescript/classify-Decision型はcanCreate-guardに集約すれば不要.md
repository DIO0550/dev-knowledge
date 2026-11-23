---
title: classify/Decision 型は guard (canCreate) に集約すれば不要
tags: [typescript, domain-design, simplification, guard-pattern]
---

## TL;DR

- 「分類結果を表す型（`Decision`）を返す companion」は、呼び出し側が結局その分岐を再解釈するなら過剰設計になりやすい
- 実際に必要な判定が「作ってよいか（真偽）」だけなら、`classify(): Decision` ではなく `canCreate: boolean` の guard に集約する
- 判定の中身（重複・空・追加可否）を型として外へ漏らさず、呼び出しは `if (canCreate) onChange(...)` のワンライナーで済む

## 問題

`LabelAddRule.classify()` が `LabelAddDecision`（`{ kind: "empty" | "duplicate" | "added" }`）を返していた。

呼び出し側では、この 3 分岐を受け取ってから「`added` のときだけ実際に追加する」という判定を再度書いていた。つまり companion が返した分類を、呼び出し側でもう一度解釈し直していた。

## 原因

`classify` は元々「3 分岐を呼び出し側で判定させる」ための設計だった。

しかし統合後の field では、実際に走る処理は「作成できるときだけ作成する」の 1 パターンだけ。`empty` / `duplicate` は「作成しない」に畳まれ、`added` だけが「作成する」に対応する。

結局 boolean 1 個で足りるのに、分岐の中身（3 つの `kind`）を型として呼び出し側に漏らしていた。分類のための型と、その型を解釈するコードが両側に重複する。

## 解決

`classify` / `LabelAddDecision` を廃止し、「作成してよいか」を表す `canCreate: boolean` の guard に集約する。新規作成は `if (canCreate) onChange([...selection, query.trim()])` のワンライナーにする。

判定は全て case-insensitive で、正規化は `normalize` 単一ソースに寄せる（重複判定と canCreate が同じ正規化を使う）。

### Before（Decision 型を返して呼び出し側で再解釈）

```ts
type LabelAddDecision =
  | { kind: "empty" }
  | { kind: "duplicate" }
  | { kind: "added" };

const LabelAddRule = {
  classify(query: string, selection: string[]): LabelAddDecision {
    const q = query.trim();
    if (q === "") return { kind: "empty" };
    if (selection.some((s) => s.toLowerCase() === q.toLowerCase())) {
      return { kind: "duplicate" };
    }
    return { kind: "added" };
  },
};

// 呼び出し側：分類をもう一度解釈している
const decision = LabelAddRule.classify(query, selection);
if (decision.kind === "added") {
  onChange([...selection, query.trim()]);
}
```

### After（canCreate guard に集約）

```ts
const normalize = (s: string) => s.trim().toLowerCase();

const LabelAddRule = {
  canCreate(query: string, selection: string[]): boolean {
    const q = query.trim();
    if (q === "") return false;
    return !selection.some((s) => normalize(s) === normalize(q));
  },
};

// 呼び出し側：ワンライナー
if (LabelAddRule.canCreate(query, selection)) {
  onChange([...selection, query.trim()]);
}
```

判定の中身（空・重複）は guard の内側に閉じ、呼び出し側には「作れるか否か」だけが見える。分類用の型と、その解釈コードの重複が消える。

## 補足

- 判断軸：**分類結果を呼び出し側が「別々の処理」に振り分けるなら `Decision` 型は有効**。1 パターンにしか畳まれないなら guard (boolean) で足りる。
- 「後で `empty` と `duplicate` で別メッセージを出すかも」という理由で `Decision` を残すのは早すぎる一般化。表示分岐が実際に必要になってから型を戻せばよい（雑多に蓄積 → 必要時に整理の原則と同じ）。
- 正規化（`normalize`）を単一ソースにしておくと、重複判定と canCreate 判定が同じルール（case-insensitive）で揃い、片方だけ大文字小文字を無視し忘れる不整合を防げる。
