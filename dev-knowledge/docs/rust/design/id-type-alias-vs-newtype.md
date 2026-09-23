---
title: ID 型は type エイリアスか newtype か — pub type UserId = u64; で起きること
tags: [rust, type, type-alias, newtype, id-type, type-safety, api-guidelines, domain-model, hashmap, derive]
---

## TL;DR

- `pub type UserId = u64;` は `u64` に名前を足すだけ。読みやすさは上がるが、**`UserId` と `OrderId` を取り違えてもコンパイルが通る**し、`id + 1` のような ID にとって無意味な演算も通る。
- ID のように「混ぜたら事故になる値」が **2 種類以上ある**なら newtype（`struct UserId(u64);`）にする。Rust API Guidelines の C-NEWTYPE がまさにこの用途。
- newtype の実行時コストはゼロ（The Book: ラッパーはコンパイル時に消える）。増える手間は生成（`UserId::new`）と取り出し（`get()`）を書くことくらい。
- newtype 定型セット: `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]` + `new` / `get` + 必要なら `Display` と `From`。`Hash + Eq` が無いと `HashMap` のキーにできず、`Display` が無いと `{}` で出せない。
- 逆に、同じ土台型の ID が 1 種類しかなく取り違えようがないなら、`type` のままでも実害は出にくい。迷ったら newtype に寄せる方が、後戻りのコストが小さい。

## このドキュメントの射程

- **対象**: `UserId` のようなドメインの ID 型を、型エイリアスにするか newtype にするかの判断と、newtype にする場合の最小実装。
- **対象外**: 型エイリアス一般の仕様（→ `rust-type-alias`）、トレイト内の `type`（→ `rust-associated-type`）、serde などクレート固有の連携。
- **確認方法**: 方針は Rust API Guidelines / The Rust Programming Language で確認。コード例とエラーは rustc 1.75.0（edition 2021）でコンパイルして確認（メッセージ文言は新しい rustc では多少異なる）。

## 原因

### エイリアスは名前だけなので、区別の役に立たない

`type` は既存の型に名前を付けるだけで新しい型を作らない。したがって `UserId` と `OrderId` を両方 `u64` のエイリアスにすると、**この 2 つは同じ型**になる。

```rust
pub type UserId = u64;
pub type OrderId = u64;

fn cancel_order(id: OrderId) { /* ... */ }

fn main() {
    let uid: UserId = 42;
    cancel_order(uid);          // ユーザー ID で注文をキャンセル → 通ってしまう
    let _next: UserId = uid + 1; // ID 同士の算術も通ってしまう
}
```

The Book も、エイリアスは newtype と違って型検査の恩恵が得られないと明記している。つまり「名前で意図は伝わるが、コンパイラは何も守ってくれない」状態になる。

### newtype なら同じ間違いがコンパイルエラーになる

API Guidelines の C-NEWTYPE は、newtype によって同じ土台型の異なる解釈を静的に区別でき、変換を忘れればコンパイラが指摘してくれる、と説明している（マイルとキロメートルの例）。ID もまったく同じ構図。

```rust
#[derive(Clone, Copy)] pub struct UserId(u64);
#[derive(Clone, Copy)] pub struct OrderId(u64);

fn cancel_order(id: OrderId) { /* ... */ }

fn main() {
    let uid = UserId(42);
    cancel_order(uid);        // NG: E0308 mismatched types
    let _x = uid + UserId(1); // NG: E0369 cannot add `UserId` to `UserId`
}
```

`+` が使えなくなるのは欠点ではなく、ID に対する算術がそもそも意味を持たないことを型で表現できている状態。

## 解決

### newtype の最小実装セット

```rust
mod domain {
    use std::fmt;

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
    pub struct UserId(u64); // フィールドは private にする

    impl UserId {
        pub fn new(raw: u64) -> Self { Self(raw) }
        pub fn get(self) -> u64 { self.0 }
    }

    impl fmt::Display for UserId {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "user#{}", self.0)
        }
    }

    impl From<u64> for UserId { fn from(v: u64) -> Self { Self(v) } }
    impl From<UserId> for u64 { fn from(v: UserId) -> Self { v.0 } }
}

use domain::UserId;
use std::collections::HashMap;

fn main() {
    let id: UserId = 42.into();
    let mut m: HashMap<UserId, &str> = HashMap::new();
    m.insert(id, "doi");
    println!("{} {} {:?}", id, id.get(), m.get(&UserId::new(42)));
    // → user#42 42 Some("doi")
    let raw: u64 = id.into();
}
```

各要素の役割は次のとおり。

| 要素 | 無いとどうなるか（実測したエラー） |
|---|---|
| `Hash` + `Eq` | `HashMap` のキーにできない（E0599: trait bounds were not satisfied） |
| `Display` | `println!("{}", id)` が通らない（E0277: doesn't implement `std::fmt::Display`） |
| `Copy` | 渡すたびに move する。ID は小さい値なので付けておくと楽 |
| `PartialOrd` / `Ord` | ソートや `BTreeMap` のキーにできない |
| private フィールド + `get()` | `pub struct UserId(pub u64)` にすると外から中身をいじれてしまう。API Guidelines も struct のフィールドは private を推奨（C-STRUCT-PRIVATE） |

フィールドを private にしたうえで別モジュールから `id.0` に触ると E0616（field `0` of struct `UserId` is private）になる。ここまで含めてカプセル化できるのが、エイリアスとの決定的な差。

### 判断基準

| 状況 | 選択 |
|---|---|
| 同じ土台型（`u64` など）の ID が 2 種類以上ある | newtype |
| ID を関数に渡す箇所が多く、引数順の取り違えが起こり得る | newtype |
| ID に不変条件がある（0 は不正、範囲制限など） | newtype（`new` を `Result` 返しにして境界で弾く） |
| ID が 1 種類しかなく、混ざる相手がいない | `type` でも可 |
| 外部クレートの型に自前トレイトを実装したい | newtype（エイリアスでは orphan rule を回避できない） |

### 実務上のメモ（経験則。ガイドラインではない）

- 後から `type` → newtype に変える作業自体は、エイリアス定義を newtype に置き換えてコンパイルエラーを潰していくだけなので機械的に進む。ただしリテラル代入・算術・`HashMap` のキーなど、`u64` 前提で書いた箇所がすべてエラーになるので、コード量に比例して作業量が増える。始めから newtype にしておく方が安い。
- 逆方向（newtype → `type`）に戻すことはまず無い。片道の判断だと思って選ぶ。

## まとめ

- `pub type UserId = u64;` は読みやすさのための名前付けで、取り違えは防げない。ID が複数種類あるなら newtype にして、コンパイラに区別させる。

## 参考

- Rust API Guidelines — Type safety（Newtypes provide static distinctions, C-NEWTYPE）: https://rust-lang.github.io/api-guidelines/type-safety.html
- Rust API Guidelines — Checklist（Structs have private fields, C-STRUCT-PRIVATE）: https://rust-lang.github.io/api-guidelines/checklist.html
- The Rust Programming Language — Advanced Types（Type Synonyms and Type Aliases / Newtype にランタイムコストは無い）: https://doc.rust-lang.org/book/ch20-03-advanced-types.html
- The Rust Reference — Type aliases: https://doc.rust-lang.org/reference/items/type-aliases.html
- std — `From` / `Into`: https://doc.rust-lang.org/std/convert/trait.From.html
