---
title: Expression Problem — 「種類の追加」と「操作の追加」はトレードオフになる
tags: [TypeScript, expression-problem, discriminated-union, interface, polymorphism, domain-modeling, design, OOP, FP, object-algebra, visitor-pattern]
---

## TL;DR

- **Expression Problem** は Philip Wadler が 1998 年に Java Genericity メーリングリストで命名した問題。問題自体は Reynolds（1975）まで遡る古いもの。
- 定義: 「ケース（種類）」と「関数（操作）」の**両方を**、既存コードを変更・再コンパイルせず、型安全（キャスト無し）のまま追加できるか。
- ケース × 操作の**表**で考えると分かりやすい。
  - **選択型（判別共用体 / ADT）**: 行（ケース）が固定。**操作の追加に強い**、種類の追加に弱い。
  - **インターフェース（サブタイプ多相）**: 列（メソッド）が固定。**種類の追加に強い**、操作の追加に弱い。
- 両立させる解法（Visitor の拡張、Object Algebras、Tagless Final、型クラス等）はあるが、どれも複雑さを払う。実務では「**どちらの軸が将来増えるか**」で選ぶのが基本。

## このドキュメントの射程

- TypeScript でドメインをモデリングするとき、「判別共用体で書くか、interface + 実装クラスで書くか」の判断根拠を整理する。
- 最小例は Wadler の原典に倣い「式（数値リテラル・加算）」と「操作（評価・文字列化）」を使う。

## 原因（なぜトレードオフになるのか）

ケースを行、操作を列にした表を考える。

|            | eval | show | ← 操作（列） |
|------------|------|------|------|
| Lit        | ✓    | ✓    |      |
| Add        | ✓    | ✓    |      |
| ↑ ケース（行） |  |  |      |

コードを**どちらの軸で束ねるか**で、追加が局所的に済む方向が決まる。

- **選択型**: コードを「操作ごと」に束ねる（1 関数の中に全ケースの `switch`）。
  - 列（操作）の追加 → 新しい関数を 1 つ書くだけ。既存コード無変更。
  - 行（ケース）の追加 → 型定義 + **全操作関数**の `switch` を修正。
- **インターフェース**: コードを「ケースごと」に束ねる（1 クラスの中に全操作のメソッド）。
  - 行（ケース）の追加 → 新しいクラスを 1 つ書くだけ。既存コード無変更。
  - 列（操作）の追加 → interface + **全実装クラス**を修正。

片方の軸で束ねれば、もう片方の軸の追加は必ず「散らばった修正」になる。これが構造的なトレードオフの正体。

### コードで見る「束ね方」の違い

同じ 2×2 の表を、それぞれの書き方で並べると、コードの塊が表のどちらの向きに対応しているかが見える。

```ts
// ── 選択型: 1 関数 = 表の「列」1 本 ────────────────────
const evaluate = (e: Expr) => {   // eval 列
  switch (e.kind) {
    case "lit": /* Lit × eval */
    case "add": /* Add × eval */
  }
};
const show = (e: Expr) => {       // show 列
  switch (e.kind) {
    case "lit": /* Lit × show */
    case "add": /* Add × show */
  }
};

// ── インターフェース: 1 クラス = 表の「行」1 本 ──────────
class Lit implements Expr {       // Lit 行
  evaluate() { /* Lit × eval */ }
  show()     { /* Lit × show */ }
}
class Add implements Expr {       // Add 行
  evaluate() { /* Add × eval */ }
  show()     { /* Add × show */ }
}
```

### 弱い方向に追加すると修正が散らばる

**選択型に「種類（Mul）」を足す** → 型定義と、**すべての操作関数**に手が入る。

```diff
 type Expr =
   | { kind: "lit"; value: number }
   | { kind: "add"; left: Expr; right: Expr }
+  | { kind: "mul"; left: Expr; right: Expr };

 const evaluate = (e: Expr): number => {
   switch (e.kind) {
     case "lit": return e.value;
     case "add": return evaluate(e.left) + evaluate(e.right);
+    case "mul": return evaluate(e.left) * evaluate(e.right);
     default: { const _: never = e; return _; } // ← 追加しないとここでエラー
   }
 };

 const show = (e: Expr): string => {
   switch (e.kind) {
     case "lit": return String(e.value);
     case "add": return `(${show(e.left)} + ${show(e.right)})`;
+    case "mul": return `(${show(e.left)} * ${show(e.right)})`;
     default: { const _: never = e; return _; } // ← ここでもエラー
   }
 };
 // 操作関数が N 個あれば N 箇所の修正
```

**インターフェースに「操作（simplify）」を足す** → interface と、**すべての実装クラス**に手が入る。

```diff
 interface Expr {
   evaluate(): number;
   show(): string;
+  simplify(): Expr;
 }

 class Lit implements Expr {  // ← 実装しないと implements でエラー
   ...
+  simplify() { return this; }
 }

 class Add implements Expr {  // ← ここでもエラー
   ...
+  simplify() { /* 0 + x → x など */ }
 }
 // 実装クラスが N 個あれば N 箇所の修正
 // しかも実装が別パッケージにあると、そもそも修正できない
```

逆向き（選択型に操作を足す／インターフェースに種類を足す）は、新しい関数 or 新しいクラスを **1 つ足すだけ**で済む（下の「解決」参照）。

## 解決（どう設計するか）

### 選択型（判別共用体）: 操作の追加に強い

```ts
type Expr =
  | { kind: "lit"; value: number }
  | { kind: "add"; left: Expr; right: Expr };

const evaluate = (e: Expr): number => {
  switch (e.kind) {
    case "lit": return e.value;
    case "add": return evaluate(e.left) + evaluate(e.right);
    default: { const _: never = e; return _; } // 網羅性チェック
  }
};

// ✅ 操作の追加: 新しい関数を書くだけ。既存コードは触らない
const show = (e: Expr): string => {
  switch (e.kind) {
    case "lit": return String(e.value);
    case "add": return `(${show(e.left)} + ${show(e.right)})`;
    default: { const _: never = e; return _; }
  }
};

// ❌ ケースの追加（mul）: Expr を変更 → evaluate / show の両方が修正対象
//    ただし never チェックがコンパイルエラーで漏れを全部教えてくれる
```

### インターフェース: 種類の追加に強い

```ts
interface Expr {
  evaluate(): number;
  show(): string;
}

class Lit implements Expr {
  constructor(private value: number) {}
  evaluate() { return this.value; }
  show() { return String(this.value); }
}

class Add implements Expr {
  constructor(private left: Expr, private right: Expr) {}
  evaluate() { return this.left.evaluate() + this.right.evaluate(); }
  show() { return `(${this.left.show()} + ${this.right.show()})`; }
}

// ✅ ケースの追加: 新しいクラスを書くだけ。既存コードは触らない
class Mul implements Expr {
  constructor(private left: Expr, private right: Expr) {}
  evaluate() { return this.left.evaluate() * this.right.evaluate(); }
  show() { return `(${this.left.show()} * ${this.right.show()})`; }
}

// ❌ 操作の追加（simplify など）: interface を変更 → Lit / Add / Mul 全部修正
```

### 両方の拡張を許す例: Object Algebras（TypeScript 版）

Oliveira & Cook（ECOOP 2012）の手法。「ケースの集合」をジェネリックな interface にし、「操作」をその実装にする。

```ts
// ケースの集合 = 代数のシグネチャ
interface ExpAlg<E> {
  lit(n: number): E;
  add(l: E, r: E): E;
}

// 操作 = 代数の実装
const evalAlg: ExpAlg<number> = { lit: n => n, add: (l, r) => l + r };

// ✅ 操作の追加: 新しい実装を書くだけ
const showAlg: ExpAlg<string> = { lit: n => `${n}`, add: (l, r) => `(${l} + ${r})` };

// ✅ ケースの追加: interface を継承し、既存実装はスプレッドで再利用
interface MulAlg<E> extends ExpAlg<E> { mul(l: E, r: E): E; }
const evalMul: MulAlg<number> = { ...evalAlg, mul: (l, r) => l * r };

// 式は「代数に対して多相な関数」として構築する
const expr = <E>(a: MulAlg<E>) => a.mul(a.lit(2), a.add(a.lit(3), a.lit(4)));
expr(evalMul); // 14
```

- 両軸の拡張が既存コード無変更で可能になる代わりに、「式が値（データ）ではなく関数になる」ためパターンマッチ・シリアライズ・デバッグがしにくい。
- FP 側の同系統の解法が Tagless Final、Haskell では型クラスや Data types à la carte（Swierstra 2008）。

### 実務での選び方

| 将来増えるのは？ | 選ぶもの | 典型例 |
|---|---|---|
| **操作**（ケースは閉じている） | 選択型（判別共用体） | ドメイン状態（`Draft \| Published \| Archived`）、通信状態、コマンド/イベント、AST |
| **種類**（操作は安定している） | インターフェース | プラグイン、ストレージアダプタ、決済手段プロバイダ、外部から実装が差し込まれる拡張点 |
| 両方 | Object Algebras 等を検討（まずは本当に両方必要か疑う） | DSL・言語処理系 |

判断の手がかり:

- **閉じた世界（closed world）か開いた世界（open world）か**。ケースを自分が全部知っていて、業務ルール上有限なら選択型。第三者が種類を追加する前提ならインターフェース。
- 選択型の「種類の追加に弱い」は、TypeScript では `never` による網羅性チェックで**コンパイラが修正箇所を全部列挙してくれる**ため、自分のコードベース内なら実害は小さい。弱いのは「追加できない」ことではなく「既存コードの変更が必要」な点。
- 逆にインターフェースの「操作の追加に弱い」は、実装が別パッケージ・別チームにあると変更自体ができない（公開 API の破壊的変更）。

## まとめ

- ケース × 操作の表を「どちらの軸で束ねるか」の選択。束ねた軸の反対側の追加が散らばる。
- 選択型 = 操作の追加に強い（閉じた世界向き）、インターフェース = 種類の追加に強い（開いた世界向き）。
- 両立の解法はあるがコストが高い。まず「将来どちらが増えるか」を問う。

## 参考

- Philip Wadler, "The Expression Problem"（1998-11-12, Java Genericity メーリングリスト） https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt
- Wikipedia, "Expression problem" https://en.wikipedia.org/wiki/Expression_problem
- Eli Bendersky, "The Expression Problem and its solutions"（2016） https://eli.thegreenplace.net/2016/the-expression-problem-and-its-solutions/
- J. C. Reynolds, "User-defined types and procedural data structures as complementary approaches to type abstraction"（1975）
- S. Krishnamurthi, M. Felleisen, D. P. Friedman, "Synthesizing Object-Oriented and Functional Design to Promote Re-Use"（ECOOP '98）
- B. C. d. S. Oliveira, W. R. Cook, "Extensibility for the Masses: Practical Extensibility with Object Algebras"（ECOOP 2012） / 解説ページ http://ropas.snu.ac.kr/~bruno/oa/
- Y. Wang, B. C. d. S. Oliveira, "The Expression Problem, Trivially!"（Modularity 2016） https://dl.acm.org/doi/10.1145/2889443.2889448
- W. Swierstra, "Data types à la carte"（JFP 2008）
- Scott Wlaschin『関数型ドメインモデリング』— 「選択型（choice type）」の用語
