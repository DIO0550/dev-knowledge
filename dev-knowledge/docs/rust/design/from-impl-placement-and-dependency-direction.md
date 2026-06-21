---
title: From実装の「型への紐づき」と「クレート依存の向き」は別物 — 外部DTO→ドメイン変換をどこに置くか
tags: [rust, orphan-rule, coherence, from-trait, into-trait, clean-architecture, ddd, acl, dependency-direction, clippy, from_over_into]
---

## TL;DR

- `impl From<ApiUser> for User` を見て「User が ApiUser に依存する（逆流）」と読むのは誤読。trait impl が型に**紐づく**ことと、クレートが相手の型に**依存する**ことは別物。
- 依存（`use`）の向きを決めるのは「**impl ブロックを物理的にどのクレートに置いたか**」。型の組み合わせ `From<ApiUser> for User` 自体は向きを決めない。
- 同じ `impl From<ApiUser> for User` でも、`domain` に置けば `domain → api-client` の逆流、`api-client` に置けば `api-client → domain` の正しい向きになる。
- Rust の trait impl は**型定義から物理的に切り離せる**（C++ のメンバ関数と決定的に違う点）。だから「User に紐づく変換」を書きつつ「domain は ApiUser を知らない」を両立できる。
- 孤児ルール（E0117）は「impl のどこかにローカル型が1つあるか」で判定。`api-client` に置けば `ApiUser` がローカルなので合法。RFC 2451 の `impl From<Foo> for Vec<i32>` がこの形の公式例。
- `Into` 直書きは Clippy `from_over_into` に引っかかる。`From`（失敗するなら `TryFrom`）を書くのが定石。
- 別軸: **実装は `From`、呼び出しは `.into()`** が両取り。`.into()` は主語が外部DTOになり「依存が逆転していないように見える」。Clippy は `impl Into` を書くのを止めるだけで `.into()` の呼び出しは妨げない。公式 API Guidelines も `from_` より `into_`/`.into()` 呼び出しを ergonomic として推奨。

## このドキュメントの射程

外部API境界型（DTO, 例 `ApiUser`）を内部ドメイン型（例 `User`）へ変換するとき、`From`/`Into`/`TryFrom` の実装をどこに置くべきか。とくに「`From` をドメイン型に実装すると依存が逆流するのでは？」という直感の真偽を、Rust の言語仕様（trait impl の所在）と孤児ルールに照らして確定させる。

## 原因（なぜ「逆流して見える」のか）

`User::from(api)` という呼び出しの構文が「User が主体、ApiUser が引数」に見えるため、「User 型が ApiUser に依存している」と読みたくなる。これは C++ 的な「メソッドはクラス定義の中に属する」というメンタルモデルに由来する。

C++ なら正しい。`User::from(api)` を書くには `User` クラス定義の中に `from` を書くしかなく、`User` の定義が `ApiUser` を知る＝逆流する。

しかし Rust の **trait impl は独立したアイテム**であり、型の定義とは別ファイル・別クレートに置ける。`struct User { ... }`（型定義）と `impl From<ApiUser> for User { ... }`（変換ロジック）は分離できる。よって「型に紐づく」ことと「型の定義クレートが依存する」ことがイコールにならない。ここがメンタルモデルのズレの正体。

## 解決（置き場所で依存方向を制御する）

変換 impl を **api-client クレート側**に置く。こうすると `domain` は `ApiUser` を一切知らずに済む。

```rust
// ══ crate: domain （Cargo.toml に api-client 依存なし）══
// domain/src/lib.rs ── ApiUser の文字は一つも出てこない
pub struct User {
    pub id: u64,
    pub name: String,
}

impl User {
    pub fn new(id: u64, name: String) -> Self {
        User { id, name }
    }
}
```

```rust
// ══ crate: api-client （Cargo.toml に domain = { path = "../domain" }）══
// api-client/src/lib.rs
use domain::User;          // ← api-client → domain。これが唯一の依存の矢印

pub struct ApiUser {
    pub id: i64,
    pub full_name: String,
}

// impl をこのクレートに置く。ApiUser がローカル型なので孤児ルールOK。
impl From<ApiUser> for User {
    fn from(api: ApiUser) -> User {
        User::new(api.id as u64, api.full_name)
    }
}
```

検算（依存方向）:

- `domain/src/lib.rs` に `ApiUser` は出てこない。`domain/Cargo.toml` に `api-client` も書かれていない。
- → `cargo build -p domain` は `api-client` 無しで通る → **domain は api-client を知らない**。
- `User::from(api)` の **実体**（`fn from` の中身）は api-client 側にあり、`User` 型の定義には `from` は含まれない。

### NG パターン: 同じ impl を domain に置く

```rust
// domain/src/mappers.rs （これはダメ）
use api_client::ApiUser;   // ← domain が api-client を use ＝ domain → api-client の逆流
impl From<ApiUser> for User { /* ... */ }
```

型の組み合わせは上の OK 例と**全く同じ** `From<ApiUser> for User`。違うのは置き場所だけ。これで依存方向が真逆になる。

### 孤児ルール（E0117）の判定基準

`impl<P> Trait<T0..Tn> for P0` は「`Trait` 自身がローカル」または「`P0..Pn` のどこかにローカル型が1つ以上ある」なら合法。判定は **impl が置かれたクレート**に対して行われる（上流の impl は対象外）。

- `api-client` に `impl From<ApiUser> for User`: `ApiUser` がローカル → 合法。
- RFC 2451 の公式例 `impl From<Foo> for Vec<i32>` と同型（`Foo`=ローカル の役割を `ApiUser` が果たす）。`i32` が std であることは無関係で、効いているのは「ローカル型が1つあるか」だけ。
- 注意: ローカル型がジェネリック（`MyVec<T>`）だと E0210 のカバレッジ規則が追加でかかる。非ジェネリックな struct なら無関係。

### Into ではなく From を使う（Clippy）

`impl Into<User> for ApiUser` は Clippy `from_over_into` で警告される。`From` を実装すれば標準ライブラリのブランケット実装で `Into` が自動的に手に入る（逆は成立しない）ため、`From` 側を実装するのが定石。変換が失敗しうるなら `From` → `TryFrom` に読み替える（`TryFrom` を実装すれば `TryInto` が無料で付く）。

### 「実装は From、呼び出しは .into()」が両取り

これは別軸の話。実装する trait（`From`）と、変換を呼ぶときの構文（`.into()`）は分けて考えられる。

呼び出し側のコードの「主語」に注目すると、見た目の自然さが変わる:

```rust
// A: User::from(api) — 文の主語が User（内部ドメイン）。
//    「内部ドメインが外部DTOを取り込む」風に読め、依存が内→外に見える錯覚を生む。
let user = User::from(api);

// B: api.into() — 文の主語が api（外部DTO）。
//    「外部DTOが内部ドメインへ出ていく」風に読め、変換の向き（外→内）と主語が一致する。
let user: User = api.into();
```

依存方向の実体はどちらも同じ impl（api-client 側、向きは api→domain で正しい）。違うのは**読んだときの主語の自然さ**だけ。`.into()` の方が「依存が逆転していないように見える」。

重要なのは、この選択がノーコストであること。Clippy `from_over_into` は「`impl Into` を**書く**な」という lint であって、「`.into()` を**呼ぶ**な」ではない。したがって:

- **実装**は `impl From<ApiUser> for User`（Clippy も満足、`Into` は自動で付く）
- **呼び出し**は `api.into()`（主語が外部DTOで変換の流れと一致、読みやすい）

の組み合わせが成立する。`From` を実装してあるから `.into()` が自動で生えており、呼ぶ側はそちらを使えばよい。

#### コミュニティ・公式ガイドラインの後押し

この「呼び出しは `.into()` を好む」流儀は個人の好みにとどまらず、公式の Rust API Guidelines が同方向を推奨している:

- 迷ったら `from_` より `to_` / `as_` / `into_` を選べ。理由は、その方が使い勝手がよく、他のメソッドとチェインできるから（C-CONV-SPECIFIC）。
- `.into()` のようなトレイトメソッドは import や型修飾なしに、適切な型の値さえあれば呼べる。`Type::from(x)` は型名を書く必要があるが、`x.into()` は文脈で変換先が決まる場面（関数引数など）では型注釈すら不要。

```rust
fn save(user: User) { /* ... */ }

let api: ApiUser = /* ... */;
save(api.into());   // 引数型が User と分かるので into() で十分、型注釈も不要
```

ただし `.into()` は変換先が文脈から推論できないと型注釈（`let user: User = ...`）が要る。一方 `User::from(api)` は「何から何へ」が一目で分かる自己文書性がある。チェイン・引数渡しでは `.into()`、変換を強調したい単独行では `::from()`、と使い分けるのが実務的。

#### 補足: 「より specific な型の側に変換を置く」原則との関係

API Guidelines は「2つの型のうち、より specific（不変条件や解釈を多く持つ）な型の側に変換を置け」とも述べている（例: `str` は `&[u8]` より specific なので、`str` 側に `as_bytes` と `from_utf8` を置く）。

これを外部DTO↔ドメインに当てはめると、不変条件を持つ**ドメイン型 `User` の方が specific**。原則通りなら変換は `User` 側＝domain に置きたくなる——が、それをやると依存が逆流する。ここで「specific な型の側に置く」原則と「依存は内向き」原則が衝突する。実務では後者（依存方向）を優先し、変換を api-client / acl 側に追い出すのが一般的。この衝突こそ、単純な値変換（std 内で完結）とレイヤー分割アーキテクチャ（クレート境界をまたぐ）で最適解が変わる理由。

### 判断マトリクス

| 書き方 | 置き場所 | 孤児ルール | 依存方向 | Clippy |
|---|---|---|---|---|
| `impl From<ApiUser> for User` | **api-client** | ✅ | ✅ api→domain | ✅ |
| `impl From<ApiUser> for User` | domain | ✅ | ❌ 逆流 | ✅ |
| `impl Into<User> for ApiUser` | api-client | ✅ | ✅ | ⚠️ from_over_into |
| 専用 acl クレートに impl | acl | ❌ 全部他クレートで孤児 | ✅ | — |

- 結論: **`From`（失敗するなら `TryFrom`）を api-client 側に置く**のが、孤児ルール・依存方向・Clippy の三拍子をクリアする。
- 専用の acl 層に置きたい場合、トレイト impl は全型が他クレートで孤児ルールに阻まれるため、**ただの変換関数** `fn to_domain_user(api: ApiUser) -> Result<User, _>` にする。

## まとめ・参考

- 一行まとめ: 「trait impl は型に**紐づく**が、依存は impl の**置き場所**が背負う。型定義から impl を切り離せるのが Rust と C++ の決定的な差」。
- `User::from(api)` と呼べることは依存逆流の証拠にならない（`String::from(&str)` でも `str` は `String` に依存しない、と同じ構造）。
- 参考: RFC 2451 (re-rebalancing coherence), E0117 / E0210, Clippy `from_over_into`, Effective Rust Item 5, Rust API Guidelines (C-CONV-SPECIFIC / Predictability: `from_` より `to_`/`as_`/`into_` を推奨)。
- 未検証: 本記事のコンパイル確認は環境のネットワーク制約（rustup 取得不可）で未実施。手元 or Rust Playground で `cargo build -p domain` が api-client 非依存で通ることを確認推奨。
