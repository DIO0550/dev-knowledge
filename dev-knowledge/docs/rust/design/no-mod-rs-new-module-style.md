---
title: mod.rs を使わない Rust 2018+ 新スタイルのモジュール構成
tags: [rust, module-system, rust-2018, project-structure]
---

## TL;DR

- Rust 2018 以降は `foo/mod.rs`（旧スタイル）ではなく、`foo.rs` + `foo/bar.rs`（新スタイル）を使うのが推奨。
- モジュールパス（`crate::foo::bar`）や機能は同一だが、ファイル名だけでモジュールが識別でき、エディタのタブが `mod.rs` だらけになるのを防げる。

## 背景・射程

Rust でサブモジュールを持つモジュール構成を作るとき、旧来の `foo/mod.rs` 形式と Rust 2018 以降の新形式（`foo.rs` + `foo/`）のどちらを採用すべきかの整理。

## 比較と理由

Rust にはモジュールをファイルに分割する置き方が 2 つある。

- 旧スタイル: `foo/mod.rs`
- 新スタイル（Rust 2018+）: `foo.rs`（親）+ `foo/bar.rs`（子）

新スタイルの利点は次の通り。

- ファイル名から直接どのモジュールか分かる（`foo.rs` = `foo` モジュール）。`mod.rs` だと、どのモジュールの `mod.rs` なのかはディレクトリ名を見ないと分からない。
- エディタのタブに `mod.rs` が並んで重複表示されない（複数モジュールを開くと `mod.rs` だらけになる問題を避けられる）。

```text
// 旧スタイル
src/
  foo/
    mod.rs
    bar.rs

// 新スタイル（Rust 2018+）
src/
  foo.rs
  foo/
    bar.rs
```

どちらのスタイルもモジュールパス（`crate::foo::bar`）は同じで、機能的な差はない。差は「ファイル名から中身が分かるか」「エディタ上の見やすさ」といった可読性の面にある。

## 指針

新規・既存を問わず `mod.rs` を使わず、新スタイル（`foo.rs` + `foo/`）に統一する。

## 参考

- [No more mod.rs - The Rust Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2018/path-changes.html#no-more-modrs)
