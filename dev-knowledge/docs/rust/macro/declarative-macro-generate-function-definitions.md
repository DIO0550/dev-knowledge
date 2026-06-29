---
title: 宣言マクロで似た関数定義そのものを共通化する
tags: [rust, macro, declarative-macro, macro-rules, dry, code-generation]
---

## TL;DR

- 関数を切り出すと「関数の中身」の重複は消せるが、「関数の宣言（シグネチャ含む）」の重複は残る
- ジェネリクスでも吸収できないケース（型・関数名・フィールド名そのものが違う）がある
- 宣言マクロ（`macro_rules!`）は**コンパイル時にコードを生成する**ので、関数定義ごと生成して重複を消せる
- 関数では渡せない「型」「識別子」を引数に取れるのがマクロの本質

## このドキュメントの射程

「触る型やフィールド名だけが違う、ほぼ同じ形の関数」が複数並んでしまう状況で、宣言マクロを使って関数定義そのものを生成する手段を整理する。

環境: Rust（edition 2021 以降）

## 問題の構造

ロジックは同一だが、扱う型やフィールド名が違うだけの関数が複数並ぶ。

```rust
pub fn update_a(mut x: ContainerA) {
    let v = x.value.field_a1;
    x.value.field_a2 = v;
}

pub fn update_b(mut x: ContainerB) {
    let v = x.value.field_b1;
    x.value.field_b2 = v;
}

pub fn update_c(mut x: ContainerC) {
    let v = x.value.field_c1;
    x.value.field_c2 = v;
}
```

「共通関数に切り出せばいい」と考えがちだが、それで消えるのは中身だけで、`update_a` / `update_b` / `update_c` という**関数の宣言自体**は3つ書く必要がある。呼び出し側がそれぞれの関数名で参照しているなら特に。

## 原因

関数では以下を引数として受け取れない。

- 型（`ContainerA` という型そのもの）
- 識別子（`update_a` という関数名、`field_a1` というフィールド名）

これらは**コンパイル時に決まっていなければならない情報**なので、実行時に動く関数では渡せない。ジェネリクス（`fn update(...)`）で吸収できるのは「型」だけで、関数名やフィールド名は依然として固定。

そして「関数名・フィールド名まで含めて変えたい」と思った瞬間、関数では届かない領域に入る。

## 解決

宣言マクロで関数定義そのものを生成する。マクロは**コンパイル時にコードを展開する**ので、型や識別子を引数として扱える。

```rust
macro_rules! define_update_fn {
    (
        $fn_name:ident,       // 関数名
        $container:ty,        // 型
        $src_field:ident,     // 読むフィールド名
        $dst_field:ident      // 書くフィールド名
    ) => {
        pub fn $fn_name(mut x: $container) {
            let v = x.value.$src_field;
            x.value.$dst_field = v;
        }
    };
}

define_update_fn!(update_a, ContainerA, field_a1, field_a2);
define_update_fn!(update_b, ContainerB, field_b1, field_b2);
define_update_fn!(update_c, ContainerC, field_c1, field_c2);
```

展開後はこうなる（手で書いたのと同じ）。

```rust
pub fn update_a(mut x: ContainerA) { let v = x.value.field_a1; x.value.field_a2 = v; }
pub fn update_b(mut x: ContainerB) { let v = x.value.field_b1; x.value.field_b2 = v; }
pub fn update_c(mut x: ContainerC) { let v = x.value.field_c1; x.value.field_c2 = v; }
```

### 宣言マクロと関数の違い

| | 関数 | 宣言マクロ |
|---|---|---|
| 実行タイミング | 実行時 | コンパイル時 |
| 型を引数に取れる | ✗ | ✓ (`$x:ty`) |
| 識別子を引数に取れる | ✗ | ✓ (`$x:ident`) |
| 可変長引数 | 制限あり | 自由 (`$($x:_),*`) |
| 生成されるもの | 1つの実体 | 任意のコード片 |

### 主な指定子

| 指定子 | 受け取れるもの | 用途 |
|---|---|---|
| `ident` | 識別子 | 関数名・変数名・フィールド名 |
| `ty` | 型 | `i32` / `MyStruct` / `Vec` など |
| `expr` | 式 | `1 + 2` / `foo()` など |
| `pat` | パターン | match のパターン部分 |
| `tt` | トークン木 | 何でも（最後の手段） |
| `$($x:_),*` | 繰り返し | 可変長引数 |

### トレードオフ

メリット:

- 同じ形の関数を増やすコストがほぼゼロ
- 「うっかり1箇所だけ修正し忘れる」事故が起きない（全部マクロから生成されるので）

デメリット:

- IDE の補完・go-to-definition が効きにくい
- ビルドエラーが起きると行情報がマクロ呼び出し側に出るので原因特定がやや手間
- マクロを知らない人にとっては読むコストが上がる

目安としては、**2つ程度ならコピペで十分**、3つ以上で「またこれ書くのか」と感じたらマクロ化を検討するくらいがちょうどよい。

## まとめ

ジェネリクスで吸収できない（型だけでなく関数名・フィールド名まで変わる）似た関数定義の繰り返しは、宣言マクロで関数ごと生成して消す。マクロの本質は「コンパイル時に、関数では渡せない型や識別子を引数として受け取れる」こと。

## 参考

- [The Rust Reference - Macros By Example](https://doc.rust-lang.org/reference/macros-by-example.html)
- [The Little Book of Rust Macros](https://veykril.github.io/tlborm/)
- [Rust by Example - macro_rules!](https://doc.rust-lang.org/rust-by-example/macros.html)
