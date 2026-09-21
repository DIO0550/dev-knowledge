---
title: ジェネリクスとenumの使い分け — 判断軸は「型が似ている」ではなく「誰が型を決めるか」
tags:
  [
    rust,
    typescript,
    generics,
    enum,
    discriminated-union,
    type-design,
    polymorphism,
    expression-problem,
    api-design,
  ]
---

## TL;DR

- 「型が似ているからジェネリクスでまとめる」は誤用。ジェネリクスが抽象化するのは**型の形**ではなく**振る舞い**（Rustではトレイト境界）。
- 判断軸は「**誰が型を決めるか**」。自分が選択肢を列挙できるなら enum（TSなら判別可能ユニオン）、呼び出し側が型を差し込むならジェネリクス。
- ジェネリクスが軽く済む条件は2つ：**固定構造の中に穴が1つ**（`body: T`）、かつ **`T` の中身を見ない**。中を見て分岐したくなった時点で列挙の仕事。
- アプリケーションコードでは「今すぐ差し替える必要がある」ときだけジェネリック化する。後からジェネリックにするのは易しく、剥がすのは難しい。
- Rust / TypeScript で結論は同じ。

## このドキュメントの射程

- 「共通部分＋固有部分」を持つ型が数種類ある（例：3種類）とき、ジェネリクス／enum／判別可能ユニオンのどれで表現するかの判断基準。
- Rust の `enum` と TypeScript の判別可能ユニオン（`type X = A | B | C` with `kind` タグ）を同じものとして扱う。
- 対象外：`dyn Trait` の性能特性、GAT、TSの条件型の詳細。

## 原因

**ジェネリクスの `T` は「似た型」ではなく「ある振る舞いを持つ、それ以外は何でもいい型」を表す。**

Rust公式Bookの定義では、ジェネリクスは型を抽象化し、トレイト境界でその型が提供すべきものを制約する「有界パラメトリック多相」である。したがって、フィールド構成が似ている型を「関数定義を減らすため」に `T` で括るのは、データの選択肢を型パラメータで表そうとする誤用になる。

このとき起きること：

- **型パラメータが伝播する**。`Entity<T>` を受け取る関数は共通部分しか触らなくても `fn f<T>(e: &Entity<T>)` になる。
- **型推論が弱くなる**。ターボフィッシュ `::<>` が呼び出しごとに必要になったら抽象化が過剰なサイン。
- **単相化のコスト**。`T` ごと・クレートごとに再コンパイルされ、バイナリと compile time が増える。
- **認知コスト**。具体的なコードのほうが理解しやすい（matklad）。TSでは型レベルに論理を詰めすぎると tsc が遅くなり保守性も落ちる。

一方、選択肢を列挙する問題は enum の領分：

- 閉じた集合（自分が全バリアントを管理する）なら enum が高速・明示的・網羅性チェック付き。
- 開いた集合（ライブラリ利用者が型を足す）なら trait／ジェネリクス。

## 解決

### 判断フロー

```
固有部分の種類を自分で列挙できる？
  ├─ Yes → enum（Rust）/ 判別可能ユニオン（TS）
  │        共通部分は struct のフィールド / `Base &` で一度だけ書く
  └─ No（呼び出し側が型を渡す）
       └─ 固有部分を1つのスロット（body: T）に寄せられる？
            ├─ Yes、かつ関数は T を素通し → ジェネリクス
            └─ No（複数プロパティに散る / T の中身で分岐したい）→ 列挙に戻す
```

### Rust

```rust
// ❌ 「似ているから」で T にまとめる → 型パラメータが全関数に伝播する
struct Entity<T> { id: Id, at: Timestamp, body: T }
fn touch<T>(e: &mut Entity<T>) { /* id と at しか使わないのに T が必要 */ }

// ✅ 列挙できるなら enum。共通部分は struct に一度だけ書く
struct Event {
    id: Id,
    at: Timestamp,
    payload: Payload,
}
enum Payload {
    Text(String),
    Count(u64),
    Coords { x: f64, y: f64 },
}
impl Event {
    // 振る舞いは impl に置く → 呼び出し側はバリアント追加の影響を受けない
    fn describe(&self) -> String {
        match &self.payload {
            Payload::Text(s) => s.clone(),
            Payload::Count(n) => n.to_string(),
            Payload::Coords { x, y } => format!("({x}, {y})"),
        }
    }
}

// ✅ ジェネリクスが正しい形：穴が1つ、中を見ない
fn unwrap_body<T>(e: Entity<T>) -> T { e.body }   // Option<T> / Result<T, E> と同じ構造
```

### TypeScript

```ts
// ✅ 列挙できるなら Base & 判別可能ユニオン（& はユニオンに分配される）
type Base = { id: string; at: Date };
type Event = Base & (
  | { kind: 'text';   body: string }
  | { kind: 'count';  n: number }
  | { kind: 'coords'; x: number; y: number }
);
function handle(e: Event) {
  e.id;                     // Base 側は narrowing なしで触れる
  switch (e.kind) {         // 固有部分だけ絞り込む（_ / default は書かない）
    case 'text':   return e.body;
    case 'count':  return String(e.n);
    case 'coords': return `${e.x},${e.y}`;
  }
}

// ✅ ジェネリクスが正しい形：穴が1つ、中を見ない
type ApiResponse<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

// ❌ T の中身を見て分岐したい → ジェネリック文脈では narrowing が効きにくい。列挙に戻す
function bad<T extends { kind: string }>(r: { body: T }) {
  if (r.body.kind === 'text') { /* 絞り込めない */ }
}
```

### enum を選んだときの代償（受け入れる前提）

- バリアント追加時、`impl`（`switch`）内の全メソッドを直す。呼び出し側に `match` を散らさず `impl` に閉じ込めれば影響範囲は局所化できるが、消えはしない（式の問題）。
- 呼び出し側で `match` するなら `_ =>` を書かない。網羅性チェックがバリアント追加時の修正箇所を全部教えてくれる（Clippy `wildcard_enum_match_arm`）。
- 公開APIの enum へのバリアント追加は破壊的変更。ライブラリ境界では `#[non_exhaustive]`。
- サイズは最大バリアントに引きずられる（Clippy `large_enum_variant`）。

## まとめ

- 「型が似ている」は判断材料にならない。「自分が列挙するか、呼び出し側が差し込むか」で決める。
- ジェネリクスは「穴が1つ・中を見ない」ときだけ軽い。それ以外は enum / 判別可能ユニオン。
- Rust も TypeScript も同じ結論。

## 参考

- The Rust Programming Language, ch10 Generic Types / ch18-01 Characteristics of OO Languages（bounded parametric polymorphism）
- Rust API Guidelines, Flexibility（C-GENERIC, C-OBJECT）
- Effective Rust, Item 12: Understand the trade-offs between generics and trait objects
- matklad, "Code Smell: Concrete Abstraction" (2020) — https://matklad.github.io/2020/08/15/concrete-abstraction.html
- Matthias Endler (corrode), "Be Simple" (2025) — https://corrode.dev/blog/simple/
- purplesyringa, "The expression problem and Rust" (2025) — https://purplesyringa.moe/blog/the-expression-problem-and-rust/
- Brandon's Website, "Three Kinds of Polymorphism in Rust" — https://www.brandons.me/blog/polymorphism-in-rust
- Total TypeScript, "Generics aren't always the answer" — https://www.totaltypescript.com/workshops/advanced-react-with-typescript/using-generics-with-components/generics-arent-always-the-answer
- microsoft/TypeScript Wiki, Performance — Preferring Interfaces Over Intersections — https://github.com/microsoft/TypeScript/wiki/Performance
- mkosir/typescript-style-guide, Discriminated Union — https://mkosir.github.io/typescript-style-guide
