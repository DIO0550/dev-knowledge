---
title: Rust でユニットテストを実装ファイルから別ファイルに分離する（#[path] 属性）
tags: [rust, testing, unit-test, module, cfg-test, path-attribute, file-organization, cargo]
---

## TL;DR

- ユニットテストは**クレート内に置く必要がある**。`tests/` ディレクトリは別クレート扱いになり、公開 API しか触れないため、プライベート関数のテストには使えない。
- ファイルの肥大化を避けたいなら、`#[cfg(test)] #[path = "..."] mod tests;` を使い、テストを別ファイルに切り出してサブモジュールとして読み込む。
- これなら「クレート内に置く（プライベートアクセス可）」「`cargo test` 時のみコンパイル」という公式の利点を維持したまま、物理ファイルだけ分離できる。
- 最大の罠: `#[path]` をインラインモジュールブロックの**中にネストさせない**こと。トップレベルに直接書けば「実装ファイルのあるディレクトリ」基準で素直に解決されるが、non-mod-rs ファイル内でネストすると起点にモジュール名ディレクトリが付いて解決を外しやすい。

## 遭遇した問題

公式（The Book）の慣習に従い、実装と同じファイルに `#[cfg(test)] mod tests { ... }` でユニットテストを書いていた。

```rust
// src/calc.rs
pub fn add(a: i32, b: i32) -> i32 { /* ... */ }

#[cfg(test)]
mod tests {
    use super::*;
    // テストが増え続け、ファイルが実装の2〜3倍の行数に膨らむ
}
```

トリビアルなコードでは問題ないが、現実のコードでは1ファイルの行数が2〜3倍に膨らみ、実装とテストを行き来するナビゲーションが辛くなる。「テストを別ファイルに出したい」が、単純に `tests/` へ移すとプライベート関数を呼べなくなる。

- 環境: Rust 2021 edition 想定（`#[path]` 自体は古くから利用可能）

## 原因

Rust のテストは「ユニットテスト」と「統合テスト」で**置き場所と見える範囲が違う**。

- **ユニットテスト**: `src/` 内のコードと同じファイル（同じクレート）に置く。だからプライベートな実装詳細をテストできる。慣習として `tests` という名前のモジュールを作り `#[cfg(test)]` を付ける。`#[cfg(test)]` は `cargo test`（テストハーネスのコンパイル）時のみ有効化され、`cargo build` の成果物には含まれないため、コンパイル時間とバイナリサイズを節約できる。
- **統合テスト**: プロジェクト直下の `tests/` ディレクトリに置く。**各ファイルが個別のクレートとしてコンパイルされる**ため、ライブラリの公開 API しか呼べない。`#[cfg(test)]` 注釈も不要。

つまり「テストを `tests/` に出す＝別クレート化＝プライベートにアクセスできなくなる」。プライベート関数をテストしたいユニットテストは、物理的に別ファイルにしても**論理的には同じモジュールの内部**である必要がある。

## 解決

`#[path]` 属性で、テスト専用ファイルを「実装モジュールのサブモジュール」として読み込む。論理的には内部モジュールのままなので `use super::*;` でプライベート項目に届き、物理ファイルだけ分離できる。

### ファイル構造

```
src/
├── lib.rs
├── calc.rs           ← 実装本体だけ
├── calc_tests.rs     ← calc のテストだけ
├── parser.rs         ← 実装本体だけ
└── parser_tests.rs   ← parser のテストだけ
```

### 実装側（末尾にこれだけ足す）

```rust
// src/calc.rs
pub fn add(a: i32, b: i32) -> i32 {
    a + b + secret_bonus()
}

fn secret_bonus() -> i32 { 10 } // プライベート関数

// テストを別ファイルのサブモジュールとして読み込む
#[cfg(test)]
#[path = "calc_tests.rs"]
mod tests;
```

### テスト側（別ファイル）

```rust
// src/calc_tests.rs
use super::*; // 親モジュール = calc の中身（プライベート含む）を取り込む

#[test]
fn test_add() {
    assert_eq!(add(1, 2), 13); // 1 + 2 + secret_bonus(10)
}

#[test]
fn test_secret_bonus() {
    assert_eq!(secret_bonus(), 10); // プライベート関数にアクセス可能
}
```

### テストをディレクトリにまとめたい場合

```
src/
├── lib.rs
├── calc.rs
└── tests/
    └── calc.rs
```

```rust
// src/calc.rs の末尾
#[cfg(test)]
#[path = "tests/calc.rs"]
mod tests;
```

### 注意すべき罠: #[path] の相対パス起点

`#[path]` を**インラインモジュールブロックの外（ファイルのトップレベル）**に書いた場合、相対パスは「その属性が書かれたソースファイルがあるディレクトリ」基準で解決される。だから `src/calc.rs` のトップレベルに書けば `src/calc_tests.rs` を素直に指す。

問題は**インラインモジュールブロックの中**に `#[path]` を書いたとき。Rust Reference の定義では:

- **mod-rs ファイル** = ルートモジュール（`lib.rs` / `main.rs`）や `mod.rs` という名前のファイル
- **non-mod-rs ファイル** = それ以外のすべてのモジュールファイル（例: `calc.rs`）

non-mod-rs ファイル（例: `calc.rs`）の中でインラインモジュールをネストし、その内側で `#[path]` を使うと、起点パスの**先頭にそのモジュール名のディレクトリが付く**。つまり起点が存在しない `src/calc/` 扱いになり、隣のファイルを指したいときに解決を外しやすい。

```rust
// アンチパターン: ネストするとパス起点が src/calc/ になり混乱する
#[cfg(test)]
mod tests {
    #[path = "calc_tests.rs"] // → src/calc/calc_tests.rs を探しに行ってしまう
    mod inner;
}
```

```rust
// 推奨: ファイルのトップレベル（実装本体の直下）に直接書く
#[cfg(test)]
#[path = "calc_tests.rs"] // → src/calc_tests.rs と素直に解決される
mod tests;
```

ポイントは「ファイルの場所を基準にするか・モジュール名ディレクトリが先頭に付くか」が、**`#[path]` をインラインブロックの外に置くか中に置くかで切り替わる**こと。`mod` でネストせずトップレベルに書けば、起点が混乱しない。

## まとめ

`#[cfg(test)] #[path = "xxx_tests.rs"] mod tests;` を実装ファイルの直下（トップレベル）に置けば、「ユニットテストはクレート内に置く」という原則とプライベートアクセス・`cargo test` 限定コンパイルを保ったまま、ファイルの肥大化だけを解消できる。`#[path]` をインラインモジュールブロックの中にネストすると起点にモジュール名ディレクトリが付いて崩れるので、トップレベルに直接書くこと。

## 参考

- Test Organization - The Rust Programming Language: https://doc.rust-lang.org/book/ch11-03-test-organization.html
- Conditional compilation（`test` cfg の定義）- The Rust Reference: https://doc.rust-lang.org/reference/conditional-compilation.html
- Modules（#[path] 属性 / mod-rs・non-mod-rs の定義）- The Rust Reference: https://doc.rust-lang.org/reference/items/modules.html
- How To Structure Unit Tests in Rust（#[path] でテスト分離する手法）: https://medium.com/better-programming/how-to-structure-unit-tests-in-rust-cc4945536a32
- Better location for unit tests in Rust（#[path] の解説）: http://xion.io/post/code/rust-unit-test-placement.html
- rust-lang/rust #139602（#[path] がモジュールディレクトリ相対である挙動の議論）: https://github.com/rust-lang/rust/issues/139602
