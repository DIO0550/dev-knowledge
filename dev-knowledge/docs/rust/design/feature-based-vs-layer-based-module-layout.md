---
title: Rust の Web アプリは単一 crate で始め、機能別と層別を組み合わせたモジュール構成にする
tags: [rust, project-structure, vertical-slice, feature-based-architecture, architecture]
---

## TL;DR

- 層別（`domain/` `infra/` `api/`）は依存の向きが見えやすいが、1 機能の変更で複数ディレクトリを行き来する。機能別（`users/` `articles/`）は変更が 1 か所に集まるが、複数機能にまたがる処理の置き場所に困る。
- 実際の Rust プロジェクトはほぼハイブリッド。crates.io は上位が層（`controllers/` `db` …）で下位が機能、Lemmy は層ごとの crate の中を機能で分け、realworld-axum-sqlx は `http/` の下をルート（機能）単位で切る。
- Rust コミュニティの多数意見は「整理のためだけに crate を分けない。まず単一 crate のモジュールで設計する」。crate はコンパイル時間・公開・proc-macro などの理由ができてから分ける。
- 小〜中規模なら、機能別モジュールを主にしてハンドラを薄く保ち、`error` / `state` / `extractor` などの共通部品を横断モジュールに置く形から始める。

## 背景・射程

Rust の Web API（axum / actix-web）で、ディレクトリを層で切るか機能で切るかの判断。2026-11 時点の公開リポジトリとフォーラムの議論から整理する。層をどの単位（mod / crate）で分けるかは「[層の分割は mod で始め、境界の強制やビルド時間が必要になったら workspace の crate に切り出す](./layer-split-module-vs-workspace-crate.md)」を参照。

## 判断軸・比較

### 3 つの形

```text
# 層別
src/
  domain/   user.rs  article.rs
  infra/    user_repo.rs  article_repo.rs
  api/      user_handlers.rs  article_handlers.rs

# 機能別（vertical slice）
src/
  users/     handlers.rs  model.rs  repo.rs
  articles/  handlers.rs  model.rs  repo.rs
  shared/    error.rs  db.rs

# ハイブリッド（機能を主に、横断部品を別に）
src/
  http/      error.rs  extractor.rs  state.rs   # 横断
  users/     handlers.rs  model.rs  repo.rs
  articles/  handlers.rs  model.rs  repo.rs
```

| 観点 | 層別 | 機能別 |
|---|---|---|
| 1 機能の変更 | 複数の層ディレクトリにまたがる | 1 ディレクトリで完結しやすい |
| 依存の向き | ディレクトリ名で見える。crate に分ければ Cargo が強制する | 機能の中で層が混ざりやすい |
| 機能をまたぐ処理 | 置き場所に困らない | `get_user_with_teams` のような処理をどこに置くか迷う |
| 型の役割 | 層ごとに揃う | 機能ごとに揃う |

### 実例

- **crates.io**：`src/controllers/` の下に `krate` / `user` / `version` などの機能を並べる。DB や API 型は `crates/crates_io_database` などの別 crate に切り出している。上位は層、下位は機能。
- **Lemmy**：workspace の crate を `db_schema` / `db_views` / `api` / `apub` と層で分け、`db_views` の下を `post` / `comment` / `community` などの機能で分ける。
- **realworld-axum-sqlx（launchbadge）**：`src/http/` の下に RealWorld 仕様のルート名に合わせて `articles` / `profiles` / `users` を置き、ハンドラと SQL を同じ場所に書く。共通部品（`error` / `extractor` / `types`）は `http/` 直下。
- **Bulletproof Rust Web**：層を先に切り、規模が大きくなったら `domain/users/` のように層の中を機能で切ってもよいとする。「どちらでもよく、層の境界が明確であることが大事」という立場。

### コミュニティの意見

- users.rust-lang.org の「Modern Rust Project Layouts」（2025-12）では、「整理はモジュールで行う。crate のほうがずっと重い」「まず単一 crate で設計する」「純粋に整理のためだけに分割しない」という意見が支持されている。crate を分ける理由として挙がったのは proc-macro、大きなオプション機能、プラットフォームごとのバイナリ、公開ライブラリ、コンパイル時間。
- 「How to organize modules for a Rust web service」（2024-03）では、Laravel 式の細かい分割は「実益がないのに扱いにくい」、単純なうちは単純なままにする、という意見が出ている。データとロジックを近くに置き、コントローラ（ハンドラ）は薄く保つハイブリッド案もある。
- 機能別（vertical slice）を推す議論（2026-01〜03）では、機能ごとに model / repo / controller を置き、横断部分を `shared` にまとめる構成が挙がった。一方で、リポジトリを機能ごとに分けると、複数機能にまたがるトランザクションが書きにくいという問題も指摘されている。

## 指針

1. **単一 crate で始める**。ファイル 1 つから始め、膨らんだらモジュールに分ける。crate 分割はコンパイル時間や再利用の理由ができてからにする。
2. **機能別を主にし、横断部品を分ける**。`users/` `articles/` のように機能でモジュールを作り、エラー型・State・エクストラクタ・DB プールは `http/` や `shared/` に置く。
3. **ハンドラは薄く保つ**。HTTP の入出力変換だけをハンドラに書き、ロジックは機能モジュール内の関数や domain 型に置く。
4. **機能をまたぐ処理が増えたら層を意識する**。複数機能の集約やトランザクションが増えたら、その部分だけ `services/` のような層を足すか、層別（＋層の中を機能別）に寄せる。
5. 規模が大きくなり層の境界を強制したくなったら、crates.io や Lemmy のように層を crate に切り出し、crate の中を機能で分ける。

## 参考

- [Modern Rust Project Layouts（Rust Users Forum, 2025-12）](https://users.rust-lang.org/t/modern-rust-project-layouts/137003)
- [How to organize modules for a Rust web service（Rust Users Forum, 2024-03）](https://users.rust-lang.org/t/how-to-organize-modules-for-a-rust-web-service/107977)
- [Structuring a Rust Backend: Feature-Based Architecture That Scales（Rust Users Forum, 2026-01）](https://users.rust-lang.org/t/structuring-a-rust-backend-feature-based-architecture-that-scales/137452)
- [Bulletproof Rust Web - Project Structure](https://gruberb.github.io/bulletproof-rust-web/project-structure.html)
- [rust-lang/crates.io](https://github.com/rust-lang/crates.io)
- [LemmyNet/lemmy Cargo.toml](https://github.com/LemmyNet/lemmy/blob/main/Cargo.toml)
- [launchbadge/realworld-axum-sqlx](https://github.com/launchbadge/realworld-axum-sqlx)
- [Large Rust Workspaces（matklad, 2021-08-22）](https://matklad.github.io/2021/08/22/large-rust-workspaces.html)
