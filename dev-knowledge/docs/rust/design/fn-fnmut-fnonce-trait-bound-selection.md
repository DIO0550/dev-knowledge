---
title: Rust のクロージャトレイト Fn / FnMut / FnOnce の使い分け
tags:
  [
    rust,
    closure,
    trait,
    fn,
    fnmut,
    fnonce,
    trait-bound,
    api-design,
    function-pointer,
    dyn-trait,
  ]
---

## TL;DR

- 3 つのトレイトの違いは **レシーバの取り方だけ**。`FnOnce` は `self`、`FnMut` は `&mut self`、`Fn` は `&self`。
- 継承関係は `Fn ⊂ FnMut ⊂ FnOnce`。**制約がゆるいのは `FnOnce`** なので、受け取る側は「呼び出しに必要な最小の境界」を選ぶ。
- どのトレイトが自動実装されるかは **キャプチャした値をどう使うか** で決まる。`move` を付けたかどうかでは決まらない。
- 大文字 `Fn`（トレイト）と小文字 `fn`（関数ポインタ型）は別物。関数ポインタは 3 トレイトすべてを実装する。

## このドキュメントの射程

クロージャを引数に取る関数を書くとき、`F: Fn()` / `F: FnMut()` / `F: FnOnce()` のどれをトレイト境界に選ぶべきかの判断基準を整理する。あわせて、混同しやすい関数ポインタ型 `fn` との違い、`Box<dyn FnOnce()>` の扱いも扱う。

対象バージョン: Rust 1.0 以降（`Box<dyn FnOnce()>` の呼び出しのみ 1.35 以降）。

## 原因

### トレイト定義はレシーバだけが違う

```rust
// self を消費する（by-value receiver）
pub trait FnOnce<Args> {
    type Output;
    extern "rust-call" fn call_once(self, args: Args) -> Self::Output;
}

// &mut self
pub trait FnMut<Args>: FnOnce<Args> {
    extern "rust-call" fn call_mut(&mut self, args: Args) -> Self::Output;
}

// &self
pub trait Fn<Args>: FnMut<Args> {
    extern "rust-call" fn call(&self, args: Args) -> Self::Output;
}
```

`call_once` は `self` を値で取るため、呼んだ時点でクロージャ自体がムーブされる。これが「1 回しか呼べない」の正体であり、トレイト側に特別な回数制限の仕組みがあるわけではない。

### 継承関係が「渡せる範囲」を決める

```
Fn  ⊂  FnMut  ⊂  FnOnce
できることが多い       制約がゆるい（渡せるものが多い）
```

`FnMut` は `FnOnce` のサブトレイト、`Fn` は `FnMut` のサブトレイト。したがって `FnOnce` を期待する場所には `Fn` / `FnMut` のインスタンスをそのまま渡せる。逆は不可。

受け取る側が厳しい境界（`Fn`）を書くと、呼び出し側が渡せるクロージャが減る。**API 設計としては「実際に必要な最小の能力」を境界にするのが正しい**。

### どれが自動実装されるかはキャプチャの使い方で決まる

| クロージャの挙動                      | 実装されるトレイト        |
| ------------------------------------- | ------------------------- |
| 何もキャプチャしない / 不変借用のみ   | `Fn` + `FnMut` + `FnOnce` |
| キャプチャを可変借用する              | `FnMut` + `FnOnce`        |
| キャプチャを消費（ムーブ / drop）する | `FnOnce` のみ             |

よくある誤解として「`move` を付けると `FnOnce` になる」があるが、これは誤り。`move` は **キャプチャの取り込み方**（借用かムーブか）を変えるだけで、実装されるトレイトを決めるのは **取り込んだ値を本体でどう使うか**。

## 解決

### 基本の 3 パターン

```rust
// (1) Fn: 不変借用のみ → Fn / FnMut / FnOnce すべて実装
let s = String::from("hello");
let print = || println!("{s}");
print();
print(); // OK

// (2) FnMut: 可変借用 → FnMut / FnOnce を実装（Fn は実装しない）
let mut v = Vec::new();
let mut push = |x: i32| v.push(x);
push(1);
push(2); // OK

// (3) FnOnce: 所有権を消費 → FnOnce のみ
let owned = String::from("bye");
let consume = move || drop(owned);
consume();
// consume(); // ERROR: use of moved value: `consume`
```

### `move` だけでは FnOnce にならない例

```rust
let n = 42_i32;

// Copy 型を move キャプチャして「読むだけ」→ これは Fn
let f = move || println!("{n}");
f();
f(); // OK（move を付けても Fn のまま）
```

### 境界の選び方

```rust
// 1 回だけ呼ぶ → FnOnce
fn run_once<F: FnOnce()>(f: F) { f(); }

// 繰り返し呼ぶ + 状態変更を許す → FnMut
fn run_twice<F: FnMut()>(mut f: F) { f(); f(); }

// 繰り返し呼ぶ + 状態変更なし（並行呼び出しなど） → Fn
fn run_parallel<F: Fn() + Sync>(f: &F) { /* ... */ }
```

`run_once` は最もゆるいので、`Fn` なクロージャも `FnMut` なクロージャも渡せる。逆に `run_parallel` に可変キャプチャのクロージャは渡せない。

### 標準ライブラリでの実例

| API               | 境界                              | 理由                                 |
| ----------------- | --------------------------------- | ------------------------------------ |
| `Option::map`     | `FnOnce(T) -> U`                  | 中身は最大 1 つなので 1 回で足りる   |
| `Iterator::map`   | `FnMut(T) -> U`                   | 要素ごとに呼ぶ / 状態保持を許したい  |
| `Iterator::filter`| `FnMut(&T) -> bool`               | 同上                                 |
| `Vec::retain`     | `FnMut(&T) -> bool`               | 同上                                 |
| `slice::sort_by`  | `FnMut(&T, &T) -> Ordering`       | 比較を何度も呼ぶ                     |
| `thread::spawn`   | `FnOnce() + Send + 'static`       | スレッドで 1 回だけ実行              |

「1 個しかないものに適用する API は `FnOnce`」「複数回適用する API は `FnMut`」という対応が std 全体で一貫している。`Fn` が境界に選ばれるのは並行呼び出しが絡む場面が中心。

### 混同しやすい: 大文字 `Fn` と小文字 `fn`

```rust
fn add_one(x: i32) -> i32 { x + 1 }

let fp: fn(i32) -> i32 = add_one; // 関数ポインタ「型」（Sized, Copy）
```

|                | `fn` 型（小文字）                                        | `Fn` トレイト（大文字） |
| -------------- | -------------------------------------------------------- | ----------------------- |
| 正体           | 具体的な型（関数のアドレス）                             | トレイト（境界として使う） |
| 環境キャプチャ | できない                                                 | できる                  |
| FFI            | `extern "C" fn` で使える                                 | 使えない                |
| 関係           | `fn` 型は `Fn` / `FnMut` / `FnOnce` を **すべて実装**     | —                       |

キャプチャを持たないクロージャは `fn` ポインタへ強制変換できる。

```rust
let f: fn(i32) -> i32 = |x| x + 1; // OK（キャプチャなしなので coercion される）

let n = 1;
// let g: fn(i32) -> i32 = |x| x + n; // ERROR: キャプチャがあるので不可
```

### trait object にするとき

```rust
// 静的ディスパッチ（ジェネリクス / impl Trait）
fn call_twice(mut f: impl FnMut()) { f(); f(); }

// 動的ディスパッチ（複数種類をまとめて持つとき）
let handlers: Vec<Box<dyn Fn(i32)>> = vec![
    Box::new(|x| println!("a {x}")),
    Box::new(|x| println!("b {x}")),
];

// Box<dyn FnOnce()> は Rust 1.35 以降そのまま呼べる
let once: Box<dyn FnOnce()> = Box::new(|| println!("once"));
once();
```

`FnOnce::call_once` が `self` を値で取る都合で、1.35 以前は `Box<dyn FnOnce()>` を呼び出せず `FnBox` という回避策が必要だった。現在は不要。

なお `Fn(usize, bool) -> usize` という括弧記法はこの 3 トレイト専用の糖衣構文。生の `Fn<(usize, bool)>` 記法や自作型への手動 `impl Fn` は nightly 限定の実験的 API（`fn_traits`, issue #29625）である。

## まとめ

呼び出し側の自由度を最大化するため、**受け取る側は必要最小の境界（`FnOnce` 寄り）を選ぶ**。実装されるトレイトはキャプチャの使い方が決め、`move` の有無では決まらない。

## 参考

- [`std::ops::FnOnce`](https://doc.rust-lang.org/std/ops/trait.FnOnce.html)
- [`std::ops::FnMut`](https://doc.rust-lang.org/std/ops/trait.FnMut.html)
- [`std::ops::Fn`](https://doc.rust-lang.org/std/ops/trait.Fn.html)
- [The Rust Programming Language 第 13 章: 関数型言語の機能](https://doc.rust-lang.org/book/ch13-01-closures.html)
- [The Rustonomicon: Higher-Rank Trait Bounds](https://doc.rust-lang.org/nomicon/hrtb.html)
- [Tracking issue: `fn_traits` (#29625)](https://github.com/rust-lang/rust/issues/29625)
