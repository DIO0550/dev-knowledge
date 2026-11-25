---
title: Rust のアプリはロジックを lib.rs に置き main.rs は起動処理だけにする
tags: [rust, project-structure, cargo, module-system, testing]
---

## TL;DR

- `src/lib.rs` と `src/main.rs` が同じパッケージにあると、同名の **2 つの crate**（ライブラリとバイナリ）になる。main.rs からは `パッケージ名::foo`（ハイフンはアンダースコア）でライブラリを参照する。
- `tests/` の統合テストから関数として呼べるのはライブラリ crate だけ。だからアプリでもロジックは lib.rs 配下に置き、main.rs は引数・設定・`run` の呼び出し・エラー処理だけにする（Rust Book ch12 の推奨）。
- `mod foo;` を lib.rs と main.rs の両方に書くと、同じファイルが 2 回コンパイルされて **別の型** になり、mismatched types エラーになる。`mod` 宣言は lib.rs 側に 1 回だけ書き、main.rs では `use` する。
- 追加のバイナリは `src/bin/<name>.rs`、複数ファイルなら `src/bin/<name>/main.rs`。どれもライブラリの公開 API を使える。

## 概要・対象

Cargo の標準パッケージレイアウトのうち、アプリケーション（バイナリ）を作るときの lib.rs / main.rs / bin/ の使い分け。Cargo Book・Rust Book の最新版（2026-11 時点）を参照。

## 仕組み・仕様

### 標準レイアウトと自動検出

```text
.
├── Cargo.toml
├── src/
│   ├── lib.rs                  # ライブラリ crate のルート
│   ├── main.rs                 # バイナリ crate のルート（名前はパッケージ名）
│   └── bin/
│       ├── migrate.rs          # 追加バイナリ「migrate」
│       └── admin/
│           ├── main.rs         # 複数ファイルのバイナリ「admin」
│           └── args.rs
├── tests/                      # 統合テスト（1 ファイル = 1 crate）
├── examples/
└── benches/
```

- Cargo はこの配置からターゲットを自動で推論する。ターゲット名はファイル名またはディレクトリ名になる。
- `autobins = false` などで種類ごとに自動検出を止められる（`autolib` は Rust 1.83 から）。

### lib.rs と main.rs は別 crate

```rust
// src/lib.rs
pub mod config;
pub mod domain;
pub mod http;

pub async fn run(config: config::Settings) -> anyhow::Result<()> {
    // サーバの組み立てと起動
    Ok(())
}
```

```rust
// src/main.rs（パッケージ名が my-app の場合）
use my_app::{config, run};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let settings = config::load()?;
    run(settings).await
}
```

main.rs に残すのは、Rust Book ch12 の挙げる「引数パースの呼び出し」「設定のセットアップ」「lib.rs の `run` の呼び出し」「`run` のエラー処理」だけ。main 関数は直接テストできないので、テストしたいものは全部 lib 側に寄せる。

### 統合テストから見えるのはライブラリだけ

```rust
// tests/api.rs
use my_app::domain::UserName;  // lib.rs の公開 API は使える

#[test]
fn rejects_empty_name() {
    assert!(UserName::parse(String::new()).is_err());
}
```

- 統合テストはライブラリの公開 API と依存 crate にリンクされる。main.rs だけのパッケージだと、テストから `use` できるものがない。
- バイナリ自体は統合テストのために自動でビルドされ、`env!("CARGO_BIN_EXE_my-app")` でパスが取れる。外部プロセスとして実行して確かめることはできる。
- doctest もライブラリにしか効かない。

## 使いどころ・注意点

### mod を両方に書くと型が 2 つになる

```rust
// ❌ src/main.rs
mod domain;                       // lib.rs にも `pub mod domain;` がある
use my_app::run_with;

fn main() {
    let name = domain::UserName::parse("a".into()).unwrap();
    run_with(name);               // 期待は my_app::domain::UserName
}                                 // → mismatched types（同じ名前なのに別の型）
```

`mod domain;` は、その場所にファイルの中身を展開する宣言。lib.rs と main.rs の両方に書くと、`domain` は 2 つの crate にそれぞれコンパイルされ、`crate::domain::UserName` と `my_app::domain::UserName` は別の型になる。

```rust
// ✅ src/main.rs
use my_app::{domain::UserName, run_with};
```

main.rs にだけ必要なモジュール（CLI 引数の定義など）は main.rs で `mod cli;` してよいが、lib.rs と同じファイルを `mod` しない。この紛らわしさから、lib.rs と main.rs の同居を非推奨にする案が Rust Internals で議論されている（2025-06 時点で提案段階）。

### 統合テストは 1 バイナリにまとめる

`tests/` の各ファイルは別々の crate としてコンパイル・リンクされる。テストファイルが増えるとリンク時間が積み上がるので、Zero To Production は `tests/api/main.rs` を起点にサブモジュールでテストを分ける構成を勧めている。

## 参考

- [Package Layout - The Cargo Book](https://doc.rust-lang.org/cargo/guide/project-layout.html)
- [Cargo Targets - The Cargo Book](https://doc.rust-lang.org/cargo/reference/cargo-targets.html)
- [Packages and Crates - The Rust Programming Language ch07-01](https://doc.rust-lang.org/book/ch07-01-packages-and-crates.html)
- [Test Organization - The Rust Programming Language ch11-03](https://doc.rust-lang.org/book/ch11-03-test-organization.html)
- [Refactoring to Improve Modularity and Error Handling - The Rust Programming Language ch12-03](https://doc.rust-lang.org/book/ch12-03-improving-error-handling-and-modularity.html)
- [Zero To Production #3（Luca Palmieri, 2020-08-09）](https://lpalmieri.com/posts/2020-08-09-zero-to-production-3-how-to-bootstrap-a-new-rust-web-api-from-scratch/)
- [Skeleton And Principles For A Maintainable Test Suite（Luca Palmieri, 2021-02）](https://lpalmieri.com/posts/skeleton-and-principles-for-a-maintainable-test-suite)
- [Mismatched types when types are the same but paths differ（Rust Users Forum, 2021-06）](https://users.rust-lang.org/t/mismatched-types-when-types-are-the-same-but-paths-differ-for-some-reason/61451/2)
- [Deprecating having both src/lib.rs and src/main.rs in the same package（Rust Internals, 2025-06）](https://internals.rust-lang.org/t/deprecating-having-both-src-lib-rs-and-src-main-rs-in-the-same-package/23033)
