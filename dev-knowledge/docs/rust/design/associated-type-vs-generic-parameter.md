---
title: トレイト内の type は「関連型」 — ジェネリクス引数との使い分けは「1 つの型に impl が何個必要か」
tags: [rust, type, associated-type, trait, generics, iterator, gat, operator-overloading, api-design, type-system]
---

## TL;DR

- トレイトの中の `type Item;` は **関連型（associated type）**。Rust Reference の定義では「他の型に関連付けられた型エイリアス」。トレイトが「型の枠」を宣言し、各 `impl` が具体型を **1 つだけ** 決める。
- ジェネリクス引数版（`trait Foo<T>`）との違いは **impl の個数**。
  - ジェネリクス引数: 同じ型に `T` を変えて **何度でも** impl できる → 呼び出し側で型注釈が要ることがある（E0283）。
  - 関連型: 同じ型への impl は **1 つだけ** → 型注釈が要らない。
- 判断軸は「誰が型を決めるか」。**実装する型が決まれば一意に決まる型 → 関連型**（`Iterator::Item`, `Deref::Target`, `FromStr::Err`）/ **呼び出し側が差し込める入力の型 → ジェネリクス引数**（`From<T>`, `AsRef<T>`）。
- 併用は普通にある: `Add<Rhs = Self>` の `Rhs` は引数、結果の `Output` は関連型。`TryFrom<T>` の `T` は引数、`Error` は関連型。
- 関連型には境界を付けられ（`type Item: Display;`）、使う側は `C: Container<Item = String>` で縛れる。Rust 1.65 からは GAT（`type Item<'a>`）も stable。

## このドキュメントの射程

- **対象**: トレイト定義 / トレイト impl の中に書く `type`（関連型）。書き方・ルール・ジェネリクス引数との使い分け。
- **対象外**: モジュール直下の `type X = Y;`（型エイリアス）→ 別記事 `rust-type-alias`。inherent impl の関連型・関連型のデフォルト値・`impl Trait` を関連型に置く機能は stable ではないので扱わない。
- **確認方法**: 仕様は Rust Reference / The Rust Programming Language / Rust Blog で確認。コード例は rustc 1.75.0（edition 2021）で実際にコンパイルして確認（エラーメッセージの文言は新しい rustc では多少異なる）。

## 原因

### 関連型は「トレイトに付いた型エイリアス」

- Rust Reference は関連型を「他の型に関連付けられた型エイリアス」と定義している。文法上も型エイリアスと同じ `TypeAlias` の規則で書かれ、置き場所によって書ける形が変わる。
  - トレイト内: `= 型` を **書いてはいけない**。境界（`: Display` など）は書ける。
  - トレイト impl 内: `= 型` を **必ず書く**。境界は書けない。
- GAT 安定化の公式ブログも「トレイト内の型エイリアスを、私たちは関連型と呼んでいる」と説明している。
- つまりトレイトの `type Item;` は「実装側が後で埋める型の穴」であり、トレイトの契約の一部（The Book: 実装者はプレースホルダーに入る型を必ず提供しなければならない）。

### なぜジェネリクス引数ではダメなのか

The Book の説明をそのまま再現すると分かりやすい。`Iterator` をジェネリクスで書いたとすると、同じ型に `Iterator<u32>` も `Iterator<String>` も impl できてしまい、`next()` を呼ぶたびにどの impl かを型注釈で指定する必要が出る。関連型なら impl は 1 つしか書けないので注釈は要らない。

```rust
// ジェネリクス引数: 同じ型に複数 impl できる
trait ConvertTo<T> { fn convert(&self) -> T; }

struct Celsius(f64);
impl ConvertTo<f64> for Celsius { fn convert(&self) -> f64 { self.0 } }
impl ConvertTo<String> for Celsius { fn convert(&self) -> String { format!("{}°C", self.0) } }

fn main() {
    let c = Celsius(20.0);
    // let x = c.convert();        // NG: E0283 type annotations needed（multiple impls）
    let a: f64 = c.convert();      // 型注釈で impl を選ぶ
    let b: String = c.convert();
}
```

```rust
// 関連型: 同じ型への impl は 1 つだけ
trait Container { type Item; }

struct S;
impl Container for S { type Item = u32; }
impl Container for S { type Item = String; } // NG: E0119 conflicting implementations
```

「複数 impl できない」ことは制約ではなく **性質** であり、「この型の `Item` は何か」が一意に決まるから呼び出し側が楽になる。

## 解決

### 書き方: 宣言・定義・利用

```rust
use std::fmt::Display;

trait Container {
    type Item: Display;                                  // 宣言: 型は書かない、境界は書ける
    fn get(&self, i: usize) -> Option<&Self::Item>;
    fn first(&self) -> Option<&Self::Item> { self.get(0) }
}

struct Names(Vec<String>);

impl Container for Names {
    type Item = String;                                  // 定義: 具体型を 1 つ決める
    fn get(&self, i: usize) -> Option<&String> { self.0.get(i) }
}

// 使う側 1: Item を意識しなくてよい（境界 Display はトレイト側で保証済み）
fn show<C: Container>(c: &C) {
    if let Some(x) = c.first() { println!("{x}"); }
}

// 使う側 2: 関連型を特定の型に縛る
fn first_len<C: Container<Item = String>>(c: &C) -> usize {
    c.first().map_or(0, |s| s.len())
}
```

- 参照の仕方は `Self::Item`（トレイト / impl 内）、`C::Item`、曖昧なときは `<C as Container>::Item`。
- 関連型には暗黙の `Sized` 境界が付く。外したいときは `type Item: ?Sized;`（`Deref::Target` がこの形）。

### 使い分け表

| 観点 | 関連型 `type Output;` | ジェネリクス引数 `trait Tr<T>` |
|---|---|---|
| 1 つの型への impl 数 | 1 つだけ | `T` ごとに複数 |
| 呼び出し側の型注釈 | 不要 | impl が複数あると必要（E0283） |
| 誰が型を決めるか | 実装する型が決まれば一意 | 呼び出し側・実装側が選んで差し込める |
| std の例 | `Iterator::Item`, `Deref::Target`, `FromStr::Err`, `IntoIterator::IntoIter` | `From<T>`, `AsRef<T>`, `PartialEq<Rhs>` |

### 併用パターン: 入力は引数、出力は関連型

演算子トレイトが典型。`Add<Rhs = Self>` は「右辺に何を取るか」は複数あり得るので引数、「足した結果の型」は `(Self, Rhs)` が決まれば一意なので関連型にしている。

```rust
use std::ops::Add;

struct Millimeters(u32);
struct Meters(u32);

impl Add<Meters> for Millimeters {      // Rhs = Meters（引数: 複数の右辺型を選べる）
    type Output = Millimeters;          // Output（関連型: この組み合わせなら一意）
    fn add(self, other: Meters) -> Millimeters {
        Millimeters(self.0 + other.0 * 1000)
    }
}
```

`TryFrom<T>` も同じ構造で、「何から変換するか」の `T` は引数、「失敗したときのエラー型」の `Error` は関連型。

### GAT（Generic Associated Types, Rust 1.65+）

関連型自体にライフタイム・型・const のジェネリクスを付けられる。代表例は「`self` から借用した値を返すイテレータ」。

```rust
trait LendingIterator {
    type Item<'a> where Self: 'a;
    fn next<'a>(&'a mut self) -> Option<Self::Item<'a>>;
}

struct Windows { buf: Vec<i32>, pos: usize }

impl LendingIterator for Windows {
    type Item<'a> = &'a mut [i32] where Self: 'a;
    fn next<'a>(&'a mut self) -> Option<&'a mut [i32]> {
        if self.pos + 2 > self.buf.len() { return None; }
        let s = &mut self.buf[self.pos..self.pos + 2];
        self.pos += 1;
        Some(s)
    }
}
```

- 通常の `Iterator` では `Item` が `self` の借用に依存できないので、これは書けない。
- 公式ブログは初期安定化時点での制限（コンパイルが通るべきコードが通らないケースがある等）も明記しているので、ハマったら GAT 固有の制限を疑う。

### 判断フロー

1. トレイトのメソッドが扱う型が、**実装する型を決めれば一意に決まる** → 関連型
2. 同じ型に対して **複数の型パラメータで実装したい**（`From<A>` と `From<B>` など） → ジェネリクス引数
3. 入力は複数あり得るが、入力が決まれば出力は一意 → 入力を引数、出力を関連型（`Add`, `TryFrom` 型）
4. 関連型が `self` の借用などライフタイムに依存する → GAT

## まとめ

- トレイト内の `type` は「impl ごとに 1 つ埋める型エイリアス」。一意に決まる型は関連型、複数差し込みたい型はジェネリクス引数にする。

## 参考

- The Rust Reference — Associated Items（Associated types）: https://doc.rust-lang.org/reference/items/associated-items.html
- The Rust Reference — Type aliases（関連型として使う場合の規則）: https://doc.rust-lang.org/reference/items/type-aliases.html
- The Rust Programming Language — Advanced Traits（Associated Types / Default Generic Type Parameters and Operator Overloading）: https://doc.rust-lang.org/book/ch20-02-advanced-traits.html
- std — Keyword `type`（associated type declaration / definition の例）: https://doc.rust-lang.org/std/keyword.type.html
- std::ops::Add: https://doc.rust-lang.org/std/ops/trait.Add.html
- std::convert::TryFrom: https://doc.rust-lang.org/std/convert/trait.TryFrom.html
- Rust Blog — Generic associated types to be stable in Rust 1.65: https://blog.rust-lang.org/2022/10/28/gats-stabilization.html
