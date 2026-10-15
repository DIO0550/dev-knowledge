---
title: impl ヘッダーの '_ は「それぞれ別の新しいライフタイム」になる
tags: [rust, lifetime, anonymous-lifetime, lifetime-elision, impl, impl-header, variance, rust-2018, rust-1.31, E0726]
---

## TL;DR

- `impl InfoReader<'_, '_, '_>` と書くと、`InfoReader` はライフタイム引数を 3 つ取る型だと分かる。
- impl ヘッダーの `'_`（と省略したライフタイム）は、1 つごとに独立した新しいライフタイムパラメータになる。3 つが同じライフタイムにまとめられることはない。
- つまり `impl InfoReader<'_, '_, '_>` は `impl<'a, 'b, 'c> InfoReader<'a, 'b, 'c>` と同じ意味。
- impl の中でライフタイムを名前で参照したいとき（戻り値を `&'a T` にするなど）は、そのライフタイムにだけ名前を付ける。残りは `'_` のままでよい。
- impl ヘッダーで、ライフタイムを持つ型を `'_` を付けずに書くと（例: `impl Trait for Wrapper<T>`）、エラー E0726 になる。

## このドキュメントの射程

- `impl Foo<'_, '_, '_>` のように、impl ヘッダーに `'_`（匿名ライフタイム）を複数並べたときの意味。
- 名前付きライフタイムと `'_` をどう使い分けるか。
- 扱わないもの: 関数シグネチャの省略規則（入力のライフタイムを出力へ割り当てるルール）、`dyn Trait + '_` のデフォルトオブジェクトライフタイム。

## 原因

- impl ヘッダーでのライフタイム省略は rust-lang/rust PR #49251「support elision in impl headers」で入った（2018-03、feature `impl_header_lifetime_elision`）。PR 本文には "Each `'_` or elided lifetime is a fresh parameter." とある。これは関数の引数位置で省略した場合と同じ考え方。
- この機能は PR #54778 で **Rust 1.31（2018-12）** に安定化された。1.31 はエディション 2018 と同時にリリースされたが、impl ヘッダーの省略は 2015 エディションでも使える。
- Rustonomicon の省略規則にも "For `impl` headers, all types are input." とある。impl ヘッダーに書く型はすべて**入力位置**として扱われ、入力位置で省略したライフタイムはそれぞれ別のライフタイムになる。
- このため、`'_` を何回書いても、`'_` どうしが同じライフタイムに揃えられることはない。
- `'_` には名前がないので、impl の本体からは参照できない。参照したいときは `impl<'a>` と宣言して名前を付ける。

## 解決

検証環境: rustc 1.97.0（edition 2021）。

型定義の例:

```rust
struct Config;

struct InfoReader<'a, 'b, 'c> {
    name: &'a str,
    data: &'b [u8],
    config: &'c Config,
}
```

impl の中でライフタイムの名前を使わないなら、`'_` だけで書ける:

```rust
// 次の 2 つは等価。3 つの '_ はそれぞれ別のライフタイム
impl InfoReader<'_, '_, '_> {
    fn len(&self) -> usize {
        self.data.len()
    }
}

// impl<'a, 'b, 'c> InfoReader<'a, 'b, 'c> { ... }
```

impl の中で特定のライフタイムを使うときは、そのライフタイムにだけ名前を付ける:

```rust
impl<'a> InfoReader<'a, '_, '_> {
    // &self の寿命ではなく、元の借用 'a のまま name を返したい
    fn name(&self) -> &'a str {
        self.name
    }
}
```

### `'_` どうしが別物であることを確かめる

`&'a T` は共変（covariant）なので、ライフタイムが違っても短い方に縮められて通ってしまうことがある。そこで不変（invariant）な `Cell<&'a str>` を使って確かめる:

```rust
use std::cell::Cell;

struct Q<'a, 'b>(Cell<&'a str>, Cell<&'b str>);

impl Q<'_, '_> {
    fn any(&self) {}
}

impl<'a> Q<'a, 'a> {
    fn same(&self) {}
}

fn f<'x, 'y>(q: Q<'x, 'y>) {
    q.any();  // OK: '_ はそれぞれ独立しているので 'x と 'y が違っていてよい
    q.same(); // NG: error: lifetime may not live long enough
              //     argument requires that `'x` must outlive `'y`（逆向きも同様）
}
```

### `'_` を書き忘れた場合（E0726）

```rust
use std::cell::Ref;
use std::fmt;

struct Wrapper<'a, T>(Ref<'a, T>);

// NG: error[E0726]: implicit elided lifetime not allowed here
//     help: indicate the anonymous lifetime: `Wrapper<'_, T>`
// impl<T: fmt::Debug> fmt::Debug for Wrapper<T> { ... }

// OK: '_ を書いて、ライフタイムを持つ型だと明示する
impl<T: fmt::Debug> fmt::Debug for Wrapper<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}
```

- 手元の rustc 1.97.0 では、`--edition 2015` でも `--edition 2021` でも E0726 になった。
- E0726 の公式説明（`rustc --explain E0726`）に載っている例は async fn のものだけ。impl ヘッダーでもこのエラーが出ることは、PR #49251 の例（`impl MyTrait for std::cell::Ref<u32> { } // ERROR`）と実際のコンパイル結果で確認した。

### 使い分けの目安

| やりたいこと | 書き方 |
|---|---|
| impl の中でライフタイムを使わない | `impl Foo<'_, '_, '_>` |
| 一部のライフタイムを戻り値などで使う | `impl<'a> Foo<'a, '_, '_>` |
| 複数の引数に**同じ**ライフタイムを要求する | `impl<'a> Foo<'a, 'a, '_>`（`'_` では書けない） |

- 「全部省略するか、全部名前を付けるか」の二択ではない。名前が必要なライフタイムだけ名前を付ければよい。
- `'_` を使えないのは、関連型の値（`type Item = ...`）の中だけ（PR #49251）。

## まとめ

- impl ヘッダーの `'_` は「名前を付けずに宣言した、それぞれ独立したライフタイム」。`'_` が 3 つあれば、ライフタイムパラメータが 3 つあるのと同じ。
- 名前が必要になったら、そのライフタイムだけ `impl<'a>` で名前を付ける。

## 参考

（2026-10-15 確認、rustc 1.97.0 で動作確認）

- rust-lang/rust PR #49251「support elision in impl headers」（nikomatsakis, 2018-03 マージ）: https://github.com/rust-lang/rust/pull/49251
- 追跡 Issue #15872（`impl_header_lifetime_elision`。#54778 で 1.31 に安定化）: https://github.com/rust-lang/rust/issues/15872
- RFC 2115 argument_lifetimes: https://rust-lang.github.io/rfcs/2115-argument-lifetimes.html
- The Rustonomicon — Lifetime Elision: https://doc.rust-lang.org/nomicon/lifetime-elision.html
- The Rust Reference — Lifetime elision（`'_` と関数での省略の一般規則。impl ヘッダーを直接扱った記述はない）: https://doc.rust-lang.org/reference/lifetime-elision.html
- Announcing Rust 1.31 and Rust 2018 — More lifetime elision rules（旧 Edition Guide「The anonymous lifetime」の転送先）: https://blog.rust-lang.org/2018/12/06/Rust-1.31-and-rust-2018/
- E0726: https://doc.rust-lang.org/error_codes/E0726.html
- users.rust-lang.org「Confused about the anonymous lifetime `'_`」: https://users.rust-lang.org/t/confused-about-the-anonymous-lifetime/138106
