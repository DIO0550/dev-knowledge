---
title: enumの振る舞いは`impl`に閉じ込める — バリアント追加の影響範囲と式の問題
tags:
  [
    rust,
    enum,
    match,
    impl,
    expression-problem,
    exhaustiveness,
    non-exhaustive,
    clippy,
    api-design,
  ]
---

## TL;DR

- enumの振る舞いは `impl Enum { fn ... { match self { ... } } }` に置く。呼び出し側はメソッドを呼ぶだけにして `match` を散らさない。
- これでバリアント追加時の修正は `impl` の中に**局所化**される。ただし**消えはしない**：`impl` 内のメソッド数だけ `match` を直す（式の問題）。
- 呼び出し側でどうしても `match` するなら `_ =>` を書かない。網羅性チェックがバリアント追加時の修正箇所を全部教えてくれる。
- 公開APIのenumにバリアントを足すのは破壊的変更。ライブラリ境界では `#[non_exhaustive]`。

## このドキュメントの射程

- 閉じた集合をenumで表現したあと、「バリアントを足すたびに全 `match` を直す」というコストをどこまで減らせるか。
- 対象外：`dyn Trait` との性能比較、`enum_dispatch` 等のマクロの使い方。

## 原因

enumは閉じた集合であり、バリアントは型ではない。そのため「このバリアントだけを受け取る関数」は書けず、振る舞いは必ず `match` を通る。`match` を書く場所が呼び出し側に散っていると、バリアント追加のたびにコードベース全体を触ることになる。

背後にあるのは**式の問題（expression problem）**で、これは言語機能で消せないトレードオフ：

|       | バリアント（型）追加               | 操作（メソッド）追加     |
| ----- | ---------------------------------- | ------------------------ |
| enum  | 全メソッドを直す（`impl` に局所化できる） | メソッドを1つ足すだけ    |
| trait | implを1つ足すだけ                  | 全型のimplを直す         |

enumは「操作を足すのが安く、種類を足すのが高い」。3種類固定で操作が増えていくアプリケーションコードなら、enumが有利な側。

また `match` に `_ =>` を書くと、新バリアントが黙って `_` に吸い込まれてコンパイルが通ってしまい、網羅性チェックという enum 最大の武器を自分で捨てることになる。

## 解決

```rust
enum Shape {
    Circle(f64),
    Rect(f64, f64),
}

// ✅ 振る舞いは impl に置く
impl Shape {
    fn area(&self) -> f64 {
        match self {
            Shape::Circle(r) => std::f64::consts::PI * r * r,
            Shape::Rect(w, h) => w * h,
        }
    }
}

// ✅ 呼び出し側はメソッドを呼ぶだけ → Triangle を足しても無傷
fn total(shapes: &[Shape]) -> f64 {
    shapes.iter().map(|s| s.area()).sum()
}

// ❌ 呼び出し側で match + ワイルドカード → 新バリアントが黙って通る
fn label(s: &Shape) -> &'static str {
    match s {
        Shape::Circle(_) => "circle",
        _ => "other",   // Triangle 追加時にここに落ちて気づけない
    }
}

// ✅ 呼び出し側で match するなら網羅的に書く（Clippy: wildcard_enum_match_arm）
fn label_ok(s: &Shape) -> &'static str {
    match s {
        Shape::Circle(_) => "circle",
        Shape::Rect(..)  => "rect",
    }
}

// ✅ ライブラリ境界：利用側に `_ =>` を強制し、バリアント追加を非破壊にする
#[non_exhaustive]
pub enum PublicShape {
    Circle(f64),
    Rect(f64, f64),
}
```

バリアントごとにstructを持ち、各structが同じtraitを実装している場合も、言語機能としては `match` なしにtraitメソッドへ委譲する手段はない。`impl Trait for Enum` の中に委譲の `match` を1つ書けば呼び出し側からは隠せる（手書きが辛ければ `enum_dispatch` 等のマクロ）。

## まとめ

- 振る舞いは `impl` に、呼び出し側はメソッド呼び出しだけ。修正は `impl` 内に閉じる。
- 式の問題は消えない。enumは「操作追加が安い」側を選んだということ。
- `_ =>` を書かない。`#[non_exhaustive]` は公開enumにだけ。

## 参考

- purplesyringa, "The expression problem and Rust" (2025) — https://purplesyringa.moe/blog/the-expression-problem-and-rust/
- Clippy lints: `wildcard_enum_match_arm`, `large_enum_variant`
- Rust Reference, `#[non_exhaustive]` attribute
- users.rust-lang.org, "Accessing enum variant trait method without matching" — https://users.rust-lang.org/t/accessing-enum-variant-trait-method-without-matching/59505
- rust-lang/lang-team #122, Enum Variant Types（バリアントは型ではない） — https://github.com/rust-lang/lang-team/issues/122
