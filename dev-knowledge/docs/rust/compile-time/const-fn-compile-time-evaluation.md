---
title: const fn でコンパイル時に評価可能な関数を定義する
tags: [rust, const-fn, const, compile-time, ctfe, performance]
---

## TL;DR

- `const fn` は「**コンパイル時にも実行できる**」関数。**常にコンパイル時に走るわけではない**
- `const` / `static` の初期化式や配列長など、**const コンテキストで呼び出されたときだけ**コンパイル時評価される
- 通常コンテキストで呼ぶと普通の関数として実行時に走る
- 通常関数 → `const fn` への変更は**後方互換**。書ける範囲なら基本付けて困らない
- 制約はある: トレイトメソッド呼び出し、ヒープ確保、`for` の一部、`?` などはまだ不可（バージョンで段階的に解禁中）

## このドキュメントの射程

`const fn` とは何か、通常の関数とどう違うか、何ができて何ができないか、いつ使うべきかを整理する。

環境: Rust 1.65 以降を想定（match や trait メソッド経由の一部が安定化済み）

## const fn とは何か

`fn` の前に `const` を付けた関数。これだけ。

```rust
const fn square(x: i32) -> i32 {
    x * x
}
```

普通の `fn` と違うのは「**const コンテキストでも呼び出せる**」点。

```rust
// const コンテキスト = コンパイル時に値が確定している必要がある場所
const SQUARED: i32 = square(5);     // ✓ const fn だからOK
static TABLE: [i32; square(3) as usize] = [0; 9];  // ✓ 配列長にも使える

// 通常コンテキストでも普通に呼べる
fn main() {
    let x = square(10);  // ✓ ランタイムで実行
}
```

## const fn と通常関数の違い

| | 通常の `fn` | `const fn` |
|---|---|---|
| ランタイムで呼べる | ✓ | ✓ |
| `const`/`static` の初期化式で呼べる | ✗ | ✓ |
| 配列長 `[T; N]` の `N` に使える | ✗ | ✓ |
| `const` ジェネリック引数に使える | ✗ | ✓ |
| 関数本体の制約 | 自由 | 限られた操作のみ |

つまり `const fn` は通常関数の**上位互換**で、使える場所が増える代わりに書ける処理が制限される。

## いつコンパイル時に評価されるか

ここがハマりやすいポイント。`const fn` だからといって自動的にコンパイル時に走るわけではない。

```rust
const fn square(x: i32) -> i32 { x * x }

const A: i32 = square(5);   // ✓ コンパイル時評価される（const コンテキスト）

fn main() {
    let b = square(5);      // ✗ コンパイル時評価は保証されない（普通の関数呼び出し）
                            //   ※ ただし最適化で結果的に消えることはある

    // 強制したいなら const ブロック or const 宣言で囲む
    let c = const { square(5) };  // ✓ コンパイル時評価される
}
```

つまり「**コンパイル時に評価したい側のコンテキストで呼ぶ**」必要がある。`const fn` 側はあくまで「呼べる」という能力を提供しているだけ。

## 何が書けるか / 書けないか

書ける（安定化済み・抜粋）:

- 基本的な算術・論理・比較・ビット演算
- `if` / `else` / `match`
- `while` ループ、`for i in 0..N`（range 限定）
- `let` バインディング、ブロック式
- 構造体・タプル・配列の構築とアクセス
- 他の `const fn` の呼び出し
- `panic!`（文字列リテラルのみ）

書けない（執筆時点）:

- トレイトメソッド呼び出し全般（`+` などの演算子オーバーロードは型ごとに別途対応中）
- ヒープ確保（`Vec::new` などは const にできるが要素追加は不可）
- `for` でユーザー定義イテレータを回す
- `?` 演算子（nightly のみ）
- 動的ディスパッチ

`const fn` でできる範囲は**バージョンごとに段階的に拡大**している。詰まったらまず最新の Rust リファレンスを見るのが確実。

## 後方互換性

**通常関数を `const fn` に変えるのは後方互換な変更**。既存の呼び出し側コードはそのまま動き、加えて const コンテキストでも使えるようになる。逆向き（`const fn` → 通常 `fn`）は破壊的変更になる。

ライブラリのコンストラクタや純粋計算関数は、書ける範囲で最初から `const fn` にしておくとユーザー側の選択肢が広がる。

```rust
// よくあるパターン: コンストラクタは const fn
pub struct YearMonth { year: u16, month: u8 }

impl YearMonth {
    pub const fn new(year: u16, month: u8) -> Self {
        Self { year, month }
    }
}

// これで const 文脈で使える
const EPOCH: YearMonth = YearMonth::new(1970, 1);
```

## マクロとの違い（どちらを選ぶか）

`const fn` もマクロも「コンパイル時に何かする」点では似ているが、役割が違う。

| | `const fn` | 宣言マクロ |
|---|---|---|
| 何を生成するか | **値**（コンパイル時に計算した結果） | **コード**（関数定義・式・パターン） |
| 型システム | 通常の関数と同じ | トークン操作。型は展開後に解決 |
| デバッグ | 普通の関数として追える | 展開後を見ないと分かりにくい |
| 使いどころ | 純粋計算をコンパイル時に済ませたい | 似た定義を量産したい、型/識別子を引数にしたい |

「**値が欲しい → `const fn`**、**コードが欲しい → マクロ**」と覚えるとよい。

## 実用例

### コンパイル時テーブル生成

```rust
const fn build_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        table[i] = (i * i) as u32;
        i += 1;
    }
    table
}

static SQUARES: [u32; 256] = build_table();  // 起動時に計算済み
```

### バージョン情報の文字列リテラル化

```rust
const fn version_string() -> &'static str {
    concat!(env!("CARGO_PKG_VERSION"), "-release")
}
```

### const ジェネリックと組み合わせる

```rust
const fn buffer_size(n: usize) -> usize {
    n * 4 + 16
}

struct Buffer<const N: usize> {
    data: [u8; buffer_size(N)],  // const fn だから配列長に使える
}
```

## まとめ

`const fn` は「コンパイル時にも呼べる関数」。const コンテキストで呼ばれたときだけコンパイル時に評価され、それ以外は普通の関数として動く。後方互換なので、書ける範囲のコンストラクタや純粋計算は最初から `const fn` にしておくと選択肢が広がる。マクロが「コードを生成」するのに対し、`const fn` は「値を生成」する道具。

## 参考

- [The Rust Reference - Constant evaluation](https://doc.rust-lang.org/reference/const_eval.html)
- [std::keyword::const](https://doc.rust-lang.org/std/keyword.const.html)
- [RFC 0911 - const fn](https://rust-lang.github.io/rfcs/0911-const-fn.html)
- [When are Rust's const fns executed? (felixwrt.dev)](https://felixwrt.dev/posts/const-fn/)
