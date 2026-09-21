---
title: Rustで複数のstructに共通するフィールドを共有する — 合成＋アクセサtrait、Derefで継承を模倣しない
tags: [rust, struct, composition, inheritance, trait, deref, anti-pattern, type-design]
---

## TL;DR

- Rustにフィールドの継承はない。共通フィールドは**共通structに切り出して埋め込む**（合成）。
- 共通部分だけを扱う関数を書きたいときは、`fn meta(&self) -> &Meta` を返す**アクセサtraitを1本**足す。フィールドごとにゲッターを生やさない。
- `impl Deref for Foo { type Target = Meta }` で `foo.d` と直接触れるようにするのは**アンチパターン**。Derefはスマートポインタ用。
- 固有部分が1セットで差し替わるなら `struct Entity<T> { meta: Meta, body: T }` も選択肢だが、`Entity<A>` と `Entity<B>` は別型になる。

## このドキュメントの射程

- 複数のstruct（例：3種類）があり、フィールド D/E/F は全部に共通、A/B/C はそれぞれ違う、という状況の設計。
- 対象外：trait objectの性能、GAT、`delegate` 系マクロの詳細。

## 原因

Rustのデータ集約体（struct / enum / タプル）は互いに無関係な型で、サブタイピングもデータの継承もない。型同士の関係はtraitで表現する（*A Gentle Introduction to Rust*）。

そのため「共通フィールドを親に置いて子が引き継ぐ」というOOPの形は直接書けず、次のどれかで表現することになる。

- **合成**：共通部分を別structにして値として持つ（`has-a`）。
- **trait**：共通部分へのアクセスをtraitメソッドとして宣言する。
- **ジェネリクス**：共通部分を固定し、固有部分を型パラメータにする。

Derefで継承を模倣する手法は *Rust Design Patterns* が明示的にアンチパターンとしている。理由は、（1）読む側が予期しない驚きのイディオムであること、（2）Derefを本来の用途（ポインタ型から `T` を得る）と違う目的で濫用していること、（3）機構が完全に暗黙であること、（4）`Foo` と `Meta` の間にサブタイピングは生まれず、`Meta` が実装するtraitが `Foo` に自動で実装されるわけでもないため、ジェネリクスの境界と相性が悪いこと。Rust API Guidelines も「Derefを実装するのはスマートポインタだけ（C-DEREF）」としている。

## 解決

```rust
// ✅ 手1：共通部分を切り出して埋め込む（基本形）
struct Meta {
    d: D,
    e: E,
    f: F,
}

struct Foo { a: A,  b: B,  c: C,  meta: Meta }
struct Bar { a: A2, b: B2, c: C2, meta: Meta }
struct Baz { a: A3, b: B3, c: C3, meta: Meta }

// アクセスは foo.meta.d — 「どのstructの話か」が明示される

// ✅ 手2：共通部分を使う処理を1本で書きたいときだけ trait を足す
trait HasMeta {
    fn meta(&self) -> &Meta;
    fn meta_mut(&mut self) -> &mut Meta;
}

impl HasMeta for Foo {
    fn meta(&self) -> &Meta { &self.meta }
    fn meta_mut(&mut self) -> &mut Meta { &mut self.meta }
}
// Bar, Baz も同様

fn touch<T: HasMeta>(x: &mut T) {
    x.meta_mut().e = /* ... */;
}
// 混在させたいなら Vec<Box<dyn HasMeta>>

// ✅ 手3：固有部分が「1セット」で差し替わるならジェネリクス
struct Entity<T> {
    meta: Meta,
    body: T,
}
struct FooBody { a: A, b: B, c: C }
type Foo2 = Entity<FooBody>;
// ただし Entity<FooBody> と Entity<BarBody> は別型 → 同じ Vec には入らない

// ❌ Deref で継承を模倣する
impl std::ops::Deref for Foo {
    type Target = Meta;
    fn deref(&self) -> &Meta { &self.meta }
}
// foo.d と書けるようになるが、Deref の意味を壊し、trait 境界と噛み合わない
```

`HasMeta` のポイントは `d()` `e()` `f()` を個別に生やさず `meta()` 1本にすること。フィールドが増えてもtraitが膨らまない。

## まとめ

- 共通フィールドは共通structに切り出して埋め込む。`.meta.` が挟まるのは冗長ではなく明示。
- 共通部分だけ触る関数が必要になったら `HasMeta` を1本。
- Derefで継承の真似はしない。

## 参考

- Rust Design Patterns, Anti-patterns: Deref Polymorphism — https://rust-unofficial.github.io/patterns/anti_patterns/deref.html
- Rust API Guidelines, Predictability — Only smart pointers implement Deref and DerefMut (C-DEREF)
- A Gentle Introduction to Rust, Object-Oriented Programming — https://stevedonovan.github.io/rust-gentle-intro/object-orientation.html
- users.rust-lang.org, "How to think without field inheritance?" — https://users.rust-lang.org/t/how-to-think-without-field-inheritance/78116
