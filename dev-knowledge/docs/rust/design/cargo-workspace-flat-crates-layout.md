---
title: Cargo workspace は crates 配下にフラットに並べ、ルートを virtual manifest にする
tags: [rust, cargo-workspace, project-structure, cargo]
---

## TL;DR

- workspace の典型構成は、ルートの `Cargo.toml` を `[workspace]` だけの virtual manifest にし、全 crate を `crates/` 直下に 1 階層で並べる形（matklad の推奨、rust-analyzer が採用）。
- crate 名とフォルダ名を一致させ、入れ子にしない。Cargo の crate 名前空間がフラットなので、ディレクトリも合わせたほうが迷わない。
- 依存のバージョンやメタデータは `[workspace.dependencies]` / `[workspace.package]` にまとめ、各 crate では `workspace = true` で継承する（Cargo 1.64 以降）。
- virtual manifest には edition がないので `resolver` を明示する。edition 2024 相当なら `"3"`（Rust 1.84 で安定化）。

## 概要・対象

Cargo workspace で複数 crate を持つときの、ディレクトリと manifest の組み方。対象は Cargo 1.64 以降（workspace 継承）、`[workspace.lints]` は 1.74 以降、`resolver = "3"` は 1.84 以降。

## 仕組み・仕様

### ディレクトリ構成

```text
.
├── Cargo.toml        # virtual manifest（[package] を持たない）
├── Cargo.lock        # workspace 全体で 1 つ
├── crates/
│   ├── myapp/        # バイナリ（main.rs）。ルートには置かない
│   │   ├── Cargo.toml
│   │   └── src/main.rs
│   ├── myapp-domain/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── myapp-infra/
│       ├── Cargo.toml
│       └── src/lib.rs
└── xtask/            # ビルド補助タスク（任意）
```

matklad の「Large Rust Workspaces」の推奨は次のとおり。

- `crates/` の直下に全 crate を並べ、木構造にしない。木にすると「どこに置くか」の判断と雑多なフォルダが増える。`ls crates` で全体が見渡せる状態を保つ。
- ルートは virtual manifest にし、主バイナリもルートに置かない。ルートに `[package]` があると、ルートの `src/` だけが特別扱いになる。
- crate 名とフォルダ名を一致させる。共通 prefix（`myapp-`）も削らない。
- 公開しない内部 crate は `version = "0.0.0"` にする。crates.io に公開して semver を守る crate は `libs/` など別の場所に分ける。
- 1 ファイルしかない crate でも `src/lib.rs` にする。
- シェルスクリプトや Makefile の代わりに `cargo xtask`（Rust で書いたタスク用バイナリ）を使う。

### ルートの Cargo.toml

```toml
[workspace]
members = ["crates/*"]
resolver = "3"

[workspace.package]
edition = "2024"
rust-version = "1.85"
license = "MIT"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
myapp-domain = { path = "crates/myapp-domain" }

[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
```

### 各 crate の Cargo.toml

```toml
[package]
name = "myapp-infra"
version = "0.0.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
serde.workspace = true
tokio = { workspace = true, features = ["fs"] }  # features は workspace 側に加算される
myapp-domain.workspace = true

[lints]
workspace = true
```

### 共有されるもの・ルートだけが読むもの

- `Cargo.lock` と `target/` は workspace 全体で 1 つ。
- `[profile.*]` と `[patch]` はルートの manifest からしか読まれない。member に書いても無視される。
- `[workspace.dependencies]` の依存は `optional` にできない。`optional = true` は member 側で付ける。
- `resolver` は virtual manifest では edition から決まらないので明示する。`"2"` は edition 2021、`"3"`（MSRV を考慮した解決）は edition 2024 の既定。

## 使いどころ・注意点

- 実例として rust-analyzer は `crates/` をフラットに並べ、公開ライブラリは `lib/`、タスクは `xtask/` に分けている。ripgrep もルートの `ripgrep` パッケージに加えて `crates/` 配下に `grep`・`ignore`・`globset` などを置く。
- ripgrep のようにルートにも `[package]` を置く構成（root package + members）もある。主バイナリを `cargo install` しやすい反面、ルートの `src/` だけ別扱いになる。アプリ内部の層分割なら virtual manifest のほうが揃う。
- crate を鎖状に並べるだけではビルドの並列化は効かない。層を crate に分けるかどうか自体の判断は「[層の分割は mod で始め、境界の強制やビルド時間が必要になったら workspace の crate に切り出す](./layer-split-module-vs-workspace-crate.md)」を参照。

## 参考

- [Large Rust Workspaces（matklad, 2021-08-22）](https://matklad.github.io/2021/08/22/large-rust-workspaces.html)
- [Cargo Book - Workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
- [RFC 2906 Cargo workspace deduplicate（workspace 継承）](https://rust-lang.github.io/rfcs/2906-cargo-workspace-deduplicate.html)
- [Announcing Rust 1.84.0（resolver = "3" の安定化）](https://blog.rust-lang.org/2025/01/09/Rust-1.84.0/)
- [Edition Guide - Rust-version aware resolver](https://doc.rust-lang.org/edition-guide/rust-2024/cargo-resolver.html)
- [rust-analyzer architecture.md](https://fuchsia.googlesource.com/third_party/github.com/rust-lang/rust-analyzer/+/HEAD/docs/dev/architecture.md)
- [ripgrep 14.1.1 Cargo.toml](https://docs.rs/crate/ripgrep/14.1.1/source/Cargo.toml.orig)
