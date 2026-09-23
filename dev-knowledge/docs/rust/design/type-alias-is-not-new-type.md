---
title: Rust の type は新しい型ではなく「別名」 — 型エイリアスの正体と使う場面・使わない場面
tags: [rust, type, type-alias, newtype, result-alias, type-complexity, clippy, type-alias-bounds, generics, type-system, api-design]
---

## TL;DR

- モジュール直下や関数内に書く `type Name = 既存の型;` は **型エイリアス**。既存の型に別名を付けるだけで、**新しい型は作らない**（`type Kilometers = i32;` の `Kilometers` と `i32` は完全に同じ型）。
- 使う場面は主に 2 つ。
  1. **長い型の繰り返しを減らす**（`type Thunk = Box<dyn Fn() + Send + 'static>;`）。Clippy の `type_complexity` もエイリアスへの切り出しを勧めてくる。
  2. **ジェネリクスの一部を固定する**（`std::io::Result<T>` = `Result<T, io::Error>`）。
- **型安全（取り違え防止）が欲しいならエイリアスではなく newtype**（`struct Meters(u32);`）。エイリアス同士は取り違えてもコンパイルが通る。
- 落とし穴: ① タプル構造体のコンストラクタとしては使えない ② ジェネリクス引数の境界（`T: Send`）は**検査されない** ③ 外部クレートの型への別名に inherent `impl` は書けない。
- トレイトの中の `type Item;` は同じキーワードでも「関連型」で役割が違う → 別記事 `rust-associated-type`。

## このドキュメントの射程

- **対象**: アイテムとしての `type`（モジュール直下・ブロック内の `type X = ...;`）。何者なのか、いつ使うか、いつ使わないか。
- **対象外**: トレイト / impl 内の `type`（関連型・GAT）→ 別記事 `rust-associated-type`。`type X = impl Trait;`（TAIT）は 2026-09 時点で unstable（`#![feature(type_alias_impl_trait)]`）なので扱わない。
- **確認方法**: 仕様は Rust Reference / The Rust Programming Language / Rust By Example / std ドキュメントで確認。コード例は rustc 1.75.0（edition 2021）で実際にコンパイルして確認（エラーメッセージの文言は新しい rustc では多少異なる）。

## 原因

### `type` は「名前を 1 つ増やす」だけ

- Rust Reference の定義: 型エイリアスは、それが置かれたモジュールやブロックの **型名前空間** に、既存の型の新しい名前を定義するもの。
- The Book も「`Kilometers` は `i32` の **シノニム（同義語）** であり、別の新しい型ではない」と明言している。
- つまりコンパイラから見ればエイリアスは「書き換え前の型そのもの」。エイリアス独自のアイデンティティは無い。

### だから以下がすべて「元の型」で決まる

| 何が | どうなる |
|---|---|
| 型検査 | 同じ型扱い。`Meters` と `Seconds`（どちらも `u32`）を取り違えても通る |
| メソッド・演算子・`?` | 元の型のものがそのまま使える（`io::Result` は単なる `Result` なので `?` も `map` も使える） |
| トレイト実装・orphan rule | 元の型で判定される。Reference の用語集でも「型エイリアスはローカル性に影響しない」 |
| 実行時 | 何も残らない（コストゼロ） |

```rust
type Meters = u32;
type Seconds = u32;

fn speed(m: Meters, s: Seconds) -> u32 { m / s }

fn main() {
    let m: Meters = 10;
    let s: Seconds = 2;
    let _ = speed(s, m); // 引数を取り違えてもコンパイルが通る（どちらも u32 だから）
}
```

## 解決

### 使う場面 1: 長い型の繰り返しを減らす

The Book の例。同じ長い型が関数シグネチャや型注釈に何度も出るなら、意味のある名前でまとめる（*thunk* = 後で評価されるコード、なので保存されるクロージャに合う名前）。

```rust
type Thunk = Box<dyn Fn() + Send + 'static>;

fn takes_long_type(f: Thunk) { f() }
fn returns_long_type() -> Thunk { Box::new(|| ()) }
```

ジェネリクス付きのエイリアスも書ける（std の `keyword.type` ドキュメントの例と同形）。

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

type Cache<V> = Arc<Mutex<HashMap<String, V>>>;

fn new_cache() -> Cache<u32> {
    Arc::new(Mutex::new(HashMap::new()))
}
```

Clippy の `type_complexity`（既定で warn、しきい値 `type-complexity-threshold` の既定値 250）は、複雑すぎる型に対して「`type` 定義に切り出せ」と警告する。この警告が出たら型エイリアスの出番。

### 使う場面 2: ジェネリクスの一部を固定する（モジュール専用 `Result`）

`std::io` の多くの関数は `Result<T, io::Error>` を返すので、`std::io` は `type Result<T> = std::result::Result<T, std::io::Error>;` を定義している（`std::fmt::Result` も同じ発想で `Result<(), fmt::Error>`）。自分のクレートでも同じことができる。

```rust
#[derive(Debug)]
pub enum AppError { NotFound }

pub type Result<T> = std::result::Result<T, AppError>;

fn find(key: &str) -> Result<u32> {
    if key == "a" { Ok(1) } else { Err(AppError::NotFound) }
}
```

注意: 上のように引数 1 個で定義すると、そのモジュール内で `Result<u32, ParseIntError>` と 2 引数で書けなくなる（E0107: type alias takes 1 generic argument but 2 generic arguments were supplied）。**デフォルト型引数**を付けると両方書ける。`anyhow::Result` がこの形（`pub type Result<T, E = Error> = Result<T, E>;`）。

```rust
use std::num::ParseIntError;

#[derive(Debug)]
pub enum AppError { NotFound }

type Result<T, E = AppError> = std::result::Result<T, E>;

fn find(key: &str) -> Result<u32> { /* ... */ Ok(1) }                 // E = AppError
fn parse(s: &str) -> Result<u32, ParseIntError> { s.parse() }         // E を上書き
```

### おまけ: enum のバリアントはエイリアス経由で使える（Rust 1.37+）

```rust
type ByteOption = Option<u8>;

fn increment_or_zero(x: ByteOption) -> u8 {
    match x {
        ByteOption::Some(y) => y + 1,
        ByteOption::None => 0,
    }
}
```

impl ブロック内の `Self` もエイリアスのように振る舞うので、`Self::Variant` と書けるのはこの仕組みによる。

### 使わない場面: 型安全が欲しいとき → newtype

「単位を取り違えたくない」「不変条件を持たせたい」「外部トレイトを外部型に実装したい」ならエイリアスでは実現できない。newtype を使う。

| 観点 | 型エイリアス `type Meters = u32;` | newtype `struct Meters(u32);` |
|---|---|---|
| 新しい型か | いいえ（`u32` と同一） | はい |
| 取り違えの検出 | できない | できる（コンパイルエラー） |
| 元の型のメソッド | そのまま使える | 自分で委譲が必要 |
| 外部トレイトの実装（orphan rule） | 元の型で判定されるので回避できない | ローカル型なので実装できる |
| 実行時コスト | なし | なし（The Book: ラッパーはコンパイル時に消える） |

### 落とし穴

**1. タプル構造体・ユニット構造体のコンストラクタとしては使えない**（Reference に明記）。名前付きフィールドの struct と enum バリアントは OK。`use ... as ...` の別名なら OK。

```rust
struct MyStruct(u32);
type TypeAlias = MyStruct;

fn main() {
    let _ = TypeAlias(5); // NG: E0423 expected function, tuple struct or tuple variant, found type alias
}
```

**2. ジェネリクス引数の境界は検査されない**（`type_alias_bounds` lint、既定で warn）。rustc のドキュメントは「使用箇所で検査されず、定義箇所でも十分に検査されない。誤解を招くので強く非推奨」としている。境界は関数や `impl` 側に書く。

```rust
use std::rc::Rc;

type SendVec<T: Send> = Vec<T>; // warning: bounds on generic parameters are not enforced in type aliases

fn main() {
    let mut v: SendVec<Rc<i32>> = Vec::new(); // Rc は Send ではないのに通ってしまう
    v.push(Rc::new(1));
}
```

**3. 外部クレートの型への別名に inherent `impl` は書けない**。エイリアスは元の型なので、`Vec<String>` にメソッドを足そうとしているのと同じになる。自クレートの型への別名なら `impl Alias { ... }` は書けるが、実体は元の型への `impl`。

```rust
type Names = Vec<String>;
impl Names { fn first_name(&self) -> &str { &self[0] } }
// NG: E0116 cannot define inherent `impl` for a type outside of the crate where the type is defined
```

### 判断フロー

1. 取り違えを防ぎたい / 不変条件を持たせたい / 外部トレイトを実装したい → **newtype**
2. 同じ長い型を何度も書いている / Clippy `type_complexity` が出た → **型エイリアス**
3. 型引数の一部がモジュール全体で常に同じ（エラー型など） → **型エイリアス**（必要ならデフォルト型引数付き）
4. どれでもない（1 回しか出てこない型） → そのまま書く。Rust By Example が言うとおりエイリアスの主目的はボイラープレート削減なので、繰り返しが無いなら付ける動機が薄い。

## まとめ

- `type X = Y;` は「`Y` に `X` という名前を足す」だけ。型は増えない。繰り返し削減とジェネリクスの部分固定に使い、型安全が欲しいときは newtype を使う。

## 参考

- The Rust Reference — Type aliases: https://doc.rust-lang.org/reference/items/type-aliases.html
- The Rust Reference — Glossary（Local type: "Type aliases do not affect locality"）: https://doc.rust-lang.org/reference/glossary.html
- The Rust Programming Language — Advanced Types（Type Synonyms and Type Aliases / Newtype）: https://doc.rust-lang.org/book/ch20-03-advanced-types.html
- The Rust Programming Language — Advanced Traits（Newtype で外部トレイトを実装）: https://doc.rust-lang.org/book/ch20-02-advanced-traits.html
- Rust By Example — Aliasing: https://doc.rust-lang.org/rust-by-example/types/alias.html
- std — Keyword `type`: https://doc.rust-lang.org/std/keyword.type.html
- rustc lint `type_alias_bounds`: https://doc.rust-lang.org/nightly/nightly-rustc/rustc_lint/builtin/static.TYPE_ALIAS_BOUNDS.html
- Clippy `type_complexity`: https://rust-lang.github.io/rust-clippy/master/index.html#type_complexity
- Announcing Rust 1.37.0（enum バリアントをエイリアス経由で参照）: https://blog.rust-lang.org/2019/08/15/Rust-1.37.0/
- anyhow::Result（デフォルト型引数付きエイリアスの実例）: https://docs.rs/anyhow/latest/anyhow/type.Result.html
