---
title: Rust の matches! マクロ — match 式への糖衣で bool を返すパターン判定
tags: [rust, macro, matches, pattern-matching, macro_rules, std]
---

## TL;DR

- `matches!(expr, pattern)` は「式がパターンにマッチするか」を **`bool` で返す** std マクロ（Rust 1.42 から prelude 入り、import 不要）。
- 実体は match 式への薄い糖衣。マッチしたら `true`、それ以外（`_`）は `false` に展開される。
- パターン構文は match アームと完全に同じ。`|` による or パターン、範囲パターン、`if` ガード（パターンで束縛した名前を参照可能）が使える。
- 値の取り出しはできない（bool のみ）。値が欲しいなら `if let` / `match` を使う。
- テストでの検証には `assert_matches!` が望ましいとされるが nightly 限定（#82775）のため、stable では `assert!(matches!(...))` で代用。

## このドキュメントの射程

- `matches!` マクロの定義・展開結果・返り値・使いどころの整理。
- 前提知識として、マクロ呼び出しの `!` と `macro_rules!` の基本（matcher / transcriber、メタ変数、繰り返し）にも触れる。
- 環境: Rust 1.42+（stable）。`assert_matches!` の節のみ nightly。

## 前提: `!` と macro_rules! の基本

- `println!` や `matches!` の `!` は「関数ではなくマクロ呼び出し」のマーカー。マクロはコンパイル時にコードへ展開される。
- マクロ自体に「戻り値」の概念はなく、**展開された構文がその場に置かれるだけ**。式に展開されるマクロなら、その式の評価結果が実質の返り値になる（`vec![1, 2]` → `Vec` を作る式、`matches!` → `bool` を返す match 式）。
- `macro_rules!` の各ルールは matcher（マッチする構文）と transcriber（置き換え後の構文）の組。ルールは上から順に試され、最初に成功したものが転写される。
- メタ変数はフラグメント指定子付きで書く（`$x:expr`、`$p:pat_param` など）。繰り返しは `$(…)` + `*` / `+` / `?`（例: `$( $i:ident ),*` はカンマ区切りの識別子列）。

## matches! の定義と展開

std での定義（matcher 部分）:

```rust
macro_rules! matches {
    ($expression:expr, $(|)? $($pattern:pat_param)|+ $(if $guard:expr)? $(,)?) => { ... };
}
```

読み方:

- `$expression:expr` — 判定対象の式。
- `$(|)?` — 先頭の `|` を任意で許容（match アームで先頭 `|` が書けるのと同じ）。
- `$($pattern:pat_param)|+` — `|` 区切りで 1 個以上のパターン。`pat_param` は top-level の `|` を含まないパターン（`|` はマクロ側の区切りとして扱うため）。
- `$(if $guard:expr)?` — 任意の if ガード。
- `$(,)?` — 末尾カンマ許容。

展開結果のイメージ:

```rust
match $expression {
    $( $pattern )|+ $( if $guard )? => true,
    _ => false,
}
```

つまり **返り値は常に `bool`**。

## 使用例

```rust
// or パターン + 範囲パターン
let foo = 'f';
assert!(matches!(foo, 'A'..='Z' | 'a'..='z'));

// if ガード（パターンで束縛した x を参照できる）
let bar = Some(4);
assert!(matches!(bar, Some(x) if x > 2));

// enum の is_xxx メソッドの定番実装
enum Foo { A, B(T) }

impl Foo {
    fn is_b(&self) -> bool {
        matches!(self, Foo::B(_))
    }
}

// イテレータの filter とも相性が良い
let evens_or_none: Vec<_> = vec![Some(1), None, Some(2)]
    .into_iter()
    .filter(|v| matches!(v, Some(n) if n % 2 == 0) || matches!(v, None))
    .collect();
```

できないこと:

```rust
// NG: matches! は bool を返すだけで、束縛した値を外に出せない
// let x = matches!(bar, Some(x)); // x は外で使えない

// 値を取り出したいなら if let / let else / match を使う
if let Some(x) = bar {
    println!("{x}");
}
```

## テストでの使い分け

- マッチの検証には、失敗時に値の Debug 表現を出力してくれる `assert_matches!` が一般に望ましいとされる。
- ただし `assert_matches!` は nightly 限定の実験的 API（tracking issue #82775, `#![feature(assert_matches)]` が必要）。
- stable では `assert!(matches!(value, pattern))` で代用する（失敗時に値は表示されない点だけ劣る）。

## まとめ

- `matches!` は match 式への糖衣で、返り値は常に `bool`。判定だけなら `matches!`、値の取り出しは `if let` / `match`、と使い分ける。

## 参考

- [matches in std - Rust](https://doc.rust-lang.org/std/macro.matches.html)
- [assert_matches in std - Rust](https://doc.rust-lang.org/std/macro.assert_matches.html)
- [Macros by example - The Rust Reference](https://doc.rust-lang.org/reference/macros-by-example.html)
