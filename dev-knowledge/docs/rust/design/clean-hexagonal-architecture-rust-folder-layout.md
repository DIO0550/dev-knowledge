---
title: Rust のクリーンアーキテクチャやヘキサゴナルは domain に trait を置き外側で実装する同じ形に収束する
tags: [rust, clean-architecture, hexagonal-architecture, ddd, project-structure, axum]
---

## TL;DR

- Rust の Web API（axum / actix-web）で見かけるクリーン・ヘキサゴナル・オニオン・レイヤードの構成は、実際のツリーではほぼ同じ形になる。`domain`（モデル＋port の trait）、`service`/`application`、`infra`/`outbound`（trait の実装）、`api`/`inbound`（HTTP）、そして全部を組み立てる `main.rs`。
- port（リポジトリなどの trait）は **domain 側** に置き、domain は sqlx や axum を import しない。実装は外側の層に置く。
- 値オブジェクトは newtype ＋検証付きコンストラクタ（parse, don't validate）で domain に置く。domain モデルに `Deserialize` を付けると検証を迂回されるので付けない。ドメインエラーは enum にし、HTTP 層で別のエラー型に変換する。
- 流派の名前より「依存は内側にだけ向く」を守るかが本質。規模が小さいうちは単一 crate のレイヤード（またはフラットなモジュール）で十分という意見が主流。

## 背景・射程

クリーンアーキテクチャを中心とする層構成を、Rust ではどんなフォルダ構成で表現するのが一般的かを、公開されている解説と OSS から整理する。対象は axum / actix-web のような Web API。層を mod で分けるか crate で分けるかは「[層の分割は mod で始め、境界の強制やビルド時間が必要になったら workspace の crate に切り出す](./layer-split-module-vs-workspace-crate.md)」、trait 注入と sans-IO の選び方は「[Rust で依存を差し替えるには「trait で注入」か「注入せず sans-IO」の2択](./dependency-substitution-trait-vs-sans-io.md)」で扱う。

## 判断軸・比較

### 代表的な構成例

howtocodeit「Master Hexagonal Architecture in Rust」のサンプル（ports & adapters の命名）は次の形。

```text
src/
  main.rs              # 組み立てだけ。axum を import しない
  lib/
    config.rs
    domain/
      author/          # models / errors / ports（trait）/ service
    inbound/
      http/            # axum のサーバ・ハンドラ（driving adapter）
    outbound/
      sqlite/          # AuthorRepository の実装（driven adapter）
      email_client/    # AuthorNotifier の実装
```

Bulletproof Rust Web（axum 向けの構成ガイド）は層の名前で分ける。

```text
src/
  main.rs
  lib.rs
  config.rs
  error.rs
  domain/              # フレームワーク非依存
    models/
    services/
    ports/             # trait（任意）
    errors.rs
  infra/               # sqlx による実装
    db.rs
    repositories/
  api/                 # axum
    routes.rs
    state.rs
    handlers/
    extractors/
    dtos/
```

ほかに、円ごとに crate を分ける例（flosse/clean-architecture-with-rust：`domain` / `application` / `adapter` / `infrastructure`、2026-11 にアーカイブ）や、repository trait を使わず関数で CRUD する実用寄りの workspace 例（kigawas/clean-axum：`api` / `app` / `models` / `migration`）もある。

### 各層に置くもの

| 層 | 置くもの | 依存してよいもの |
|---|---|---|
| domain | エンティティ・集約、値オブジェクト（newtype）、ドメインエラー enum、port の trait（`UserRepository` など） | std、エラー用の小さな crate 程度 |
| application / service | ユースケース。port を引数やフィールドで受け取って手順を組む | domain |
| infra / outbound | port の実装（sqlx、HTTP クライアント、メール送信） | domain、外部 crate |
| api / inbound | ルーティング、ハンドラ、DTO（`Deserialize` 付き）、`ApiError` への変換 | application、domain、axum |
| main.rs | 設定を読み、実装を生成し、サービスに渡してサーバを起動する（composition root） | 全部 |

### 流派の違いは実質的にない

- Bulletproof Rust Web は、ヘキサゴナルとオニオンを「同じ根本パターンの別名」と書いている。
- 違いは命名（`inbound` / `outbound` か `api` / `infra` か）と、usecase 層を domain の service から独立させるかどうか程度。
- Rust 固有に意味がある違いは、層を mod で分けるか crate で分けるかの方で、crate に分ければ依存方向を Cargo が強制できる。

### DDD の要素の置き場所

```rust
// domain/user.rs
pub struct UserName(String);  // フィールドは private

impl UserName {
    pub fn parse(s: String) -> Result<Self, UserNameError> {
        if s.trim().is_empty() || s.chars().count() > 256 {
            return Err(UserNameError::Invalid);
        }
        Ok(Self(s))
    }
}

impl AsRef<str> for UserName {
    fn as_ref(&self) -> &str { &self.0 }
}

pub enum CreateUserError {
    Duplicate { name: UserName },
    Unknown(anyhow::Error),
}

// port：domain に置き、domain の型だけで書く
pub trait UserRepository: Clone + Send + Sync + 'static {
    fn create(&self, name: UserName)
        -> impl Future<Output = Result<User, CreateUserError>> + Send;
}
```

- 値オブジェクトは検証付きコンストラクタでしか作れないようにする（Zero To Production の `SubscriberName::parse` と同じ考え方）。
- HTTP の入力は api 層の DTO で `Deserialize` し、そこから `UserName::parse` を通して domain の型にする。
- `CreateUserError` は api 層で `ApiError` に `From` で変換し、ドメインの内部情報をレスポンスにそのまま出さない。
- 複数リポジトリにまたがるトランザクション（Unit of Work）をきれいに書く定番はまだない。

## 指針

- 名前の流派は気にせず、「domain は外側を import しない」「port は domain に置く」「組み立ては main だけ」の 3 点を守る。
- 規模で段階を分ける（Bulletproof Rust Web の推奨と同じ）。
  1. プロトタイプや小さな API：`routes` / `domain` / `startup` のようなフラットなモジュール。newtype で不変条件を守れば十分（Zero To Production の構成）。
  2. 本番サービスの多く：単一 crate 内のレイヤード（`domain` / `infra` / `api`）。
  3. 複雑なドメイン、複数チーム、複数の入口（HTTP・gRPC・CLI）：ヘキサゴナルの命名や workspace の crate 分割に進む。
- 実装が 1 つしかない trait を全部の依存に作ると、テストのための偽物と変換コードが増えるだけになりやすい。差し替えたい境界（DB・外部 API・時刻）だけを port にする。howtocodeit 自身も、ビジネスロジックが薄いアプリやソロの小規模開発ではヘキサゴナルは不要としている。

## 参考

- [Master hexagonal architecture in Rust（howtocodeit）](https://www.howtocodeit.com/articles/master-hexagonal-architecture-rust)
- [Bulletproof Rust Web - Architecture](https://gruberb.github.io/bulletproof-rust-web/architecture.html)
- [Using Types To Guarantee Domain Invariants（Zero To Production, 2020-12）](https://lpalmieri.com/posts/2020-12-11-zero-to-production-6-domain-modelling)
- [flosse/clean-architecture-with-rust](https://github.com/flosse/clean-architecture-with-rust)
- [kigawas/clean-axum](https://github.com/kigawas/clean-axum)
- [Structuring a Rust backend: feature-based architecture that scales（Rust Users Forum）](https://users.rust-lang.org/t/structuring-a-rust-backend-feature-based-architecture-that-scales/137452)
