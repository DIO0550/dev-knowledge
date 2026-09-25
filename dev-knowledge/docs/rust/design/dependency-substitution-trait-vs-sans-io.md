---
title: Rust で依存を差し替えるには「trait で注入」か「注入せず sans-IO」の2択
tags: [rust, dependency-injection, trait, generics, sans-io, functional-core-imperative-shell, hexagonal-architecture, testing, design, struct-impl, free-function, closure]
---

## TL;DR

- Rust には C# の DI コンテナ文化はほぼない。標準は **trait + ジェネリクス（or `dyn Trait`）** で、これが C# のコンストラクタ注入に相当する。
- もう一つの主流は **sans-IO / Functional Core, Imperative Shell**。ロジックを純粋関数にして I/O を外側に追い出し、そもそも注入しない。ネットワーク系ライブラリ（quinn, quiche, str0m, Firezone connlib）で広く採用されている。
- 「関数（クロージャ）を struct に持たせて注入する」書き方は Rust では少数派。クロージャの型に名前が付けられず、ジェネリクスか `Box<dyn Fn>` になり、trait より重くなるため。関数を**引数で一時的にもらう**こと自体（`map`, `sort_by_key`, `or_insert_with` など）は日常的で、状態なし・振る舞い1つの依存なら `impl Fn` で受けるのも普通。
- アプリのロジックが「struct + impl + struct を渡す」に落ち着くのは Rust では自然。メソッドは `self` を第1引数にとる関数の糖衣で、「データ + 関数」の設計と衝突しない。
- 「struct でデータを定義して関数に渡す」スタイルは、そのまま Rust コミュニティの推奨と一致している。外の世界に触る部分だけ trait か sans-IO にすればよい。

## このドキュメントの射程

- C# で「ファクトリやサービスを interface 経由で注入する」ことに慣れている人が、Rust で同じことをどう表現するか。
- 「struct + 関数」中心で書いているとき、メール送信・DB・時刻のような外部依存をどこに置くか。
- DI コンテナのクレート（syrette, ferrunix 等）は存在するが、主流ではないので本記事では扱わない。

## 原因：なぜ Rust では「関数を持たせて注入」しにくいか

1. **クロージャは 1 つずつ固有の匿名型**で、フィールドに持つには型パラメータ `F: Fn(...)` か `Box<dyn Fn(...)>` が必要。型パラメータは使う側にまで伝染し、`dyn` はヒープ確保と動的ディスパッチになる。
2. **trait のほうが表現力が高い**。振る舞いが「送る」以外に増えたときメソッドを足すだけで済み、接続などの状態も struct に自然に持てる。
3. **静的ディスパッチと相性がよい**。`impl Trait` で受ければコンパイル時に具体型へ展開され、オーバーヘッドがない。

クロージャを引数で一時的に渡す（`map`, `sort_by_key`, `retry(|| ...)`）のは日常的にやるが、struct に保存して持ち回るのは GUI やルーティングのコールバック系に限られる。

## 解決

以下、「確認メールを送り、送れたらイベントを返す」処理を例にする。

```rust
pub struct Envelope { pub to: EmailAddress, pub body: String }
pub enum SendResult { Sent, NotSent }
pub struct AcknowledgmentSent { pub order_id: OrderId, pub to: EmailAddress }
```

### パターン A：trait + ジェネリクス（C# の interface 注入に相当）

```rust
// port（求人票）：ドメイン側で定義する。infra はこれに合わせる（依存関係逆転）
pub trait MailSender {
    fn send(&self, envelope: &Envelope) -> SendResult;
}

// 使う側：ジェネリクスで受ける。静的ディスパッチ
pub fn acknowledge(order: &Order, sender: &impl MailSender) -> Option<AcknowledgmentSent> {
    let envelope = Envelope { to: order.customer_email.clone(), body: render(order) };
    match sender.send(&envelope) {
        SendResult::Sent => Some(AcknowledgmentSent { order_id: order.id.clone(), to: envelope.to }),
        SendResult::NotSent => None,
    }
}

// infra（応募者）
pub struct SmtpSender { /* client */ }
impl MailSender for SmtpSender {
    fn send(&self, envelope: &Envelope) -> SendResult { /* SMTP で送る */ SendResult::Sent }
}

// テスト：偽物を渡すだけ
struct AlwaysNotSent;
impl MailSender for AlwaysNotSent {
    fn send(&self, _: &Envelope) -> SendResult { SendResult::NotSent }
}
assert!(acknowledge(&order, &AlwaysNotSent).is_none());
```

- 起動時に実行時で差し替えたいなら `&dyn MailSender` / `Box<dyn MailSender>` にする。
- 呼び出し順序も 1 か所にまとめたいなら、`struct Acknowledger<S: MailSender> { sender: S }` に持たせて `impl` メソッドで呼ぶ。`reqwest::Client` を struct に持たせるのと同じ感覚。

### パターン B：sans-IO / Functional Core, Imperative Shell（注入しない）

ロジックを「封筒を作る」「送信結果をイベントにする」の 2 つの純粋関数に割り、I/O は外側の層で行う。

```rust
// core：純粋関数。trait も I/O もない
pub fn prepare_envelope(order: &Order, body: String) -> Envelope {
    Envelope { to: order.customer_email.clone(), body }   // 宛先を決めるのはここ
}

pub fn acknowledgment_event(order: &Order, result: SendResult) -> Option<AcknowledgmentSent> {
    match result {
        SendResult::Sent => Some(AcknowledgmentSent { order_id: order.id.clone(), to: order.customer_email.clone() }),
        SendResult::NotSent => None,                       // 送れなくても失敗にしない
    }
}

// shell：ここだけが I/O をする。薄いのでテストは統合テストに任せる
let envelope = prepare_envelope(&order, render(&order));
let result   = smtp.send(&envelope);
let event    = acknowledgment_event(&order, result);

// テスト：偽物すら要らない
assert!(acknowledgment_event(&order, SendResult::NotSent).is_none());
```

- 業務ルール（宛先・イベントの中身・失敗時の扱い）は core の純粋関数に残り、infra には漏れない。
- 時刻が必要なら `Instant::now()` を呼ばず `Instant` を引数で受け取る（Firezone connlib の流儀）。
- 失うのは「呼ぶ順番」が shell に移ること。数行なので割り切る。

### どちらを選ぶか

| 状況 | 選択 |
|---|---|
| ロジックが純粋関数に割れる（ほとんどの業務処理） | B（sans-IO）。まずこれを試す |
| 呼び出し順序・リトライ・接続状態まで 1 か所に閉じ込めたい | A（trait を struct に持たせる） |
| 実行時に実装を切り替える（設定でバックエンド選択） | A の `dyn Trait` |
| C# の `IFooFactory` を注入していた場面 | 多くは B で「生成に必要な情報をデータで渡す」に置き換わる。必要なら `trait FooFactory { fn create(&self) -> Foo; }` |


## 補足：なぜ「struct + impl + struct を渡す」に落ち着くのか

高階関数を多用するのはイテレータや標準ライブラリのような「ライブラリを作る側」で、アプリのロジックを書く側は struct を定義し、`impl` に処理を置き、struct を受け渡す形で大半が済む。これは Rust の言語設計から来る自然な帰結で、以下が根拠。

### メソッドは「self を第1引数にとる関数」

`order.total()` は `Order::total(&order)` の糖衣構文。`impl` にまとめるのは、関数を型の名前空間に置いて `.` で呼べるようにしただけで、「データと関数を分けて考える」方針と矛盾しない。The Rust Book も、struct や enum にメソッドを付けたものは「オブジェクト」とは呼ばないが GoF の定義ではオブジェクトと同じ機能を提供する、と説明している（継承はないので、継承を必須とするなら Rust は OOP ではない）。

### struct は「状態（データ）」を中心に設計させられる

Rust の struct は他言語のオブジェクトのように振る舞いを持てるが拡張（継承）できないため、開発者は struct をまず状態を中心に設計することを強いられ、データファーストの設計に誘導される。振る舞いのために struct を作るのではなく、データの形として struct を作り、そこに処理を付ける、という順番になる。

### カプセル化の単位は struct ではなく module

Rust フォーラムでよく引かれる指摘として、Rust のカプセル化の単位は struct や impl ブロックではなく module であり、自由関数は同じ module 内なら struct のプライベートフィールドに完全にアクセスでき、公開する必要もない。したがって「struct に属させるため」に関連関数にする理由はなく、関連関数は `self` をとるメソッドとコンストラクタに限定し、それ以外は自由関数にする、という使い分けが推奨されている。

### クロージャより struct + `&mut self` のほうが借用が通しやすい

クロージャが `self` のフィールドを借用すると、同じ `self` の他フィールドとの借用が衝突しやすい（`self.list.retain(|i| self.filter.allowed(i))` が「`self.list` を可変借用中なので `self` を不変借用できない」で弾かれる問題。Rust 2021 の disjoint capture でフィールド単位になり緩和されたが、`&mut self` 全体をキャプチャする場面では今も起きる）。状態を struct に持たせ `&mut self` のメソッドにしたほうが、借用の範囲が明示的で通しやすい。

### OOP 化を防ぐ3つの目安

「struct + impl」が継承ツリーや神クラスに育たないようにするための目安。

1. struct は**データの形**を表す。振る舞いのために struct を作らない（`Manager`、`Service` のような名前が出てきたら疑う）。
2. 状態を持たない処理は `impl` に入れず、普通の `fn`（自由関数）にする。`impl` に入れるのは `self` を本当に使うものとコンストラクタだけ。
3. 差し替えたい振る舞いだけ trait にする。全部を trait にしない。

この3つを守っていれば、「struct + impl + struct を渡す」は sans-IO の core を書くときの標準的な形と一致する。本文の `prepare_envelope(&order, ...)` のような純粋関数も、`impl Order { fn envelope(&self, ...) }` と書いても本質は同じ。

### 関数（クロージャ）を使う場面

| 場面 | 形 |
|---|---|
| その場限りの変換・条件・キー（`map`, `filter`, `sort_by_key`, `retry(\|\| ...)`） | 引数に `impl Fn` を取る。日常的 |
| 状態を持たない1つの振る舞いの差し替え（時刻、乱数、1回の送信） | `impl Fn` で受けても普通。ただし値で渡せるなら値で渡す（`now: Instant`） |
| 状態を持つ・振る舞いが複数 | trait |
| struct に保存して持ち回る | コールバック・イベントハンドラ系のみ（`Box<dyn Fn>`） |

## まとめ

- Rust の依存差し替えは「trait で注入」か「注入せず sans-IO」。関数注入は F# 由来の慣用句で、Rust に直訳するとジェネリクスか `Box<dyn Fn>` まみれになる。
- struct + 純粋関数で書いているなら、外の世界に触る境界だけ trait か sans-IO にすれば、既存スタイルを変えずに済む。

## 参考

- Firezone, "sans-IO: The secret to effective Rust for network services" — https://www.firezone.dev/blog/sans-io
- howtocodeit, "Master Hexagonal Architecture in Rust" — https://www.howtocodeit.com/guides/master-hexagonal-architecture-in-rust
- Julio Merino, "Rust traits and dependency injection" — https://jmmv.dev/2022/04/rust-traits-and-dependency-injection.html
- joshuayou, "Dependency Injection in Rust"（関連型による静的 DI）— https://github.com/joshuayoudev/rust-dependency-injection-example
- Gary Bernhardt, "Boundaries"（Functional Core, Imperative Shell の原典）— https://www.destroyallsoftware.com/talks/boundaries
- The Rust Programming Language, "Characteristics of Object-Oriented Languages" — https://doc.rust-lang.org/book/ch18-01-what-is-oo.html
- Rust Users Forum, "Cannot find function"（カプセル化の単位は module、関連関数は self とコンストラクタに限定する意見）— https://users.rust-lang.org/t/cannot-find-function/50663
- Rust Users Forum, "When to use functions and when to define structs and use methods on them?" — https://users.rust-lang.org/t/when-to-use-functions-and-when-to-define-structs-and-use-methods-on-them/84952
- R. Tyler Croy, "Considering object-orientedness from the Rust perspective"（struct を状態中心に設計させられる）— https://brokenco.de/2023/02/22/object-oriented-compulsions.html
- RFC 2229, "Capture disjoint fields"（クロージャと self の借用衝突）— https://rust-lang.github.io/rfcs/2229-capture-disjoint-fields.html
