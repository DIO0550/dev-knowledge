---
title: axum の State にリポジトリを持たせるときはジェネリクスを基本にし、dyn が要るなら async-trait を使う
tags: [rust, axum, async, dyn-trait, generics, dependency-injection]
---

## TL;DR

- リポジトリなどの port を axum の `State` に持たせる方法は、ジェネリクス（`AppState<R: UserRepository>`）か `Arc<dyn UserRepository>` の 2 つ。
- Rust 1.75 で trait 内の `async fn` が安定化したが、`async fn` を持つ trait は **`dyn` にできない**（dyn compatible ではない）。そのまま `Arc<dyn Trait>` にはできない。
- ジェネリクスで行くなら、trait に `Clone + Send + Sync + 'static` を付け、メソッドを `fn ... -> impl Future<Output = ...> + Send` と書く。素の `async fn` では返す Future に `Send` 境界を付けられず、axum のハンドラで使えないことがある。
- 実行時に実装を切り替えたいなど `dyn` が必要なら、`async-trait` クレートで Future を `Box` 化する。動的ディスパッチのコストは DB 往復に比べて無視できる。

## 概要・対象

axum（0.7 / 0.8 系）で、domain に置いたリポジトリ trait の実装をハンドラに渡す方法。Rust 1.75 以降（async fn in trait / RPITIT の安定版）を前提にする。

## 仕組み・仕様

### パターン A：ジェネリクス（静的ディスパッチ）

```rust
// domain
pub trait UserRepository: Clone + Send + Sync + 'static {
    fn find(&self, id: UserId)
        -> impl Future<Output = Result<Option<User>, RepoError>> + Send;
}

// api
#[derive(Clone)]
pub struct AppState<R: UserRepository> {
    repo: Arc<R>,
}

async fn get_user<R: UserRepository>(
    State(state): State<AppState<R>>,
    Path(id): Path<UserId>,
) -> Result<Json<UserDto>, ApiError> {
    let user = state.repo.find(id).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(user.into()))
}

pub fn router<R: UserRepository>(state: AppState<R>) -> Router {
    Router::new()
        .route("/users/{id}", get(get_user::<R>))
        .with_state(state)
}
```

- `Clone + Send + Sync + 'static` は axum の `State` と tokio のタスクが要求する。
- `async fn find(&self, ...)` と書くと、返る Future が `Send` かどうかを trait の利用側で保証できない。`-> impl Future<Output = ...> + Send` と書けば、実装側の `async fn` が `Send` であることが要求される。`trait-variant` クレートの `#[trait_variant::make(UserRepository: Send)]` で Send 版の trait を生成する方法もある。
- 型パラメータはハンドラ・ルータ・`AppState` に伝染する。テストではフェイク実装を `R` に入れるだけで済む。

### パターン B：`Arc<dyn Trait>`（動的ディスパッチ）

```rust
// domain
#[async_trait::async_trait]
pub trait UserRepository: Send + Sync {
    async fn find(&self, id: UserId) -> Result<Option<User>, RepoError>;
}

// api
#[derive(Clone)]
pub struct AppState {
    repo: Arc<dyn UserRepository>,
}

async fn get_user(
    State(state): State<AppState>,
    Path(id): Path<UserId>,
) -> Result<Json<UserDto>, ApiError> { /* 同じ */ }
```

- `async-trait` は各メソッドを `Pin<Box<dyn Future<Output = ...> + Send + 'async_trait>>` を返す形に書き換えるので、trait が dyn compatible になる。`Send` が不要なら `#[async_trait(?Send)]`。
- 型パラメータが消え、ハンドラとルータがすっきりする。代わりに呼び出しごとに Future のヒープ確保と vtable 経由の呼び出しが入る。
- `async-trait` を使わず、`fn find(&self, id: UserId) -> Pin<Box<dyn Future<Output = ...> + Send + '_>>` を手で書いてもよい。

### 比較

| 観点 | ジェネリクス | `Arc<dyn Trait>` |
|---|---|---|
| 実行時の切り替え | できない（型がコンパイル時に決まる） | できる（設定でバックエンドを選ぶなど） |
| 型の伝染 | ハンドラ・ルータ・State に型パラメータが付く | 付かない |
| trait の書き方 | `impl Future + Send` を返す形 | `async-trait` か `Pin<Box<dyn Future>>` |
| 実行コスト | 単相化されてオーバーヘッドなし | Box 確保と動的ディスパッチ（DB 往復に比べて無視できる） |
| ビルド | 実装ごとに単相化される | 1 つのコードで済む |

## 使いどころ・注意点

- 既定はジェネリクス。howtocodeit のヘキサゴナル解説も Bulletproof Rust Web もこの形を採る。
- 起動時の設定で実装を選ぶ、プラグイン的に実装を並べる、型パラメータの伝染がハンドラ数に比べて重い、のどれかなら `Arc<dyn Trait>` にする。
- 実装が本番とテスト用の 2 つだけなら、`enum Repo { Real(PgRepo), Fake(FakeRepo) }` にして `match` で振り分ける方法もある。trait も dyn も要らない。
- 依存を差し替える方法そのもの（trait 注入か sans-IO か）は「[Rust で依存を差し替えるには「trait で注入」か「注入せず sans-IO」の2択](./dependency-substitution-trait-vs-sans-io.md)」を参照。

## 参考

- [Announcing Rust 1.75.0（async fn in traits の安定化）](https://blog.rust-lang.org/2023/12/28/Rust-1.75.0/)
- [Announcing `async fn` and return-position `impl Trait` in traits（Rust Blog, 2023-12-21）](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/)
- [async-trait（docs.rs）](https://docs.rs/async-trait)
- [Trait-variant crate now available for AFIT and RPITIT（Rust Internals, 2023-12）](https://internals.rust-lang.org/t/trait-variant-crate-now-available-for-afit-and-rpitit/20050)
- [Master hexagonal architecture in Rust（howtocodeit）](https://www.howtocodeit.com/articles/master-hexagonal-architecture-rust)
- [Bulletproof Rust Web - Architecture](https://gruberb.github.io/bulletproof-rust-web/architecture.html)
