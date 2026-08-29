---
title: Rust の validate 関数は `Result<(), E>` でいいのか（parse, don't validate）
tags: [rust, error-handling, api-design, validation, newtype, parse-dont-validate, type-driven-design, TryFrom, clippy]
---

## TL;DR

- `Result<(), E>` というシグネチャ自体は Rust で普通。std にも `io::Write::write_all() -> io::Result<()>` や `fmt::Write::write_str() -> Result<(), fmt::Error>` が多数ある。型としては何も問題ない。
- 問題は型ではなく設計。「`validate_xxx(&data) -> Result<(), E>` を作って、使う側が呼ぶ」スタイルは Rust では弱い選択肢。呼び忘れをコンパイラが検出できず、「検証済み」が型に残らない。
- Rust の主流は「検証を通った事実を型に刻む」= parse, don't validate。newtype + スマートコンストラクタで `Result<Self, E>` を返す。
- 例外的に `Result<(), E>` が正解なのは、(a) フォーム入力のエラー集約層、(b) 構築済みデータの不変条件チェック、(c) スマートコンストラクタ内の private ヘルパ、(d) トレイトのメソッド。
- `clippy::result_unit_err` は `Result<T, ()>`（**エラー側**が unit）が対象。`Result<(), E>`（**成功側**が unit）は対象外で警告されない。

## このドキュメントの射程

AI にコード生成させると `fn validate_user(&User) -> Result<(), ValidationError>` のような「検証専用関数」が頻出する。これが Rust のイディオムとして妥当かを、The Rust Book / Rust API Guidelines / エコシステムの実例から判断する。

- **扱う範囲**: 入力値の制約（範囲・書式・非空・フィールド間の関係）をどう守らせるかの設計判断。
- **扱わない範囲**: エラー型そのものの設計（`thiserror` / `anyhow` の使い分け）、`panic!` と `Result` の一般的な使い分け。

## 原因

### なぜ「検証専用関数」が弱いのか

```rust
pub struct User {
    pub email: String,
    pub age: u32,
}

pub fn validate_user(user: &User) -> Result<(), ValidationError> {
    if !user.email.contains('@') {
        return Err(ValidationError::InvalidEmail);
    }
    if user.age < 18 {
        return Err(ValidationError::TooYoung);
    }
    Ok(())
}

pub fn register(user: &User) -> Result<(), AppError> {
    validate_user(user)?;   // ← この行を消してもコンパイルは通る
    save_to_db(user)
}
```

弱点は 3 つ。

1. **呼び忘れをコンパイラが検出できない。** `validate_user(user)?;` を削除してもビルドは成功する。`Result` の `#[must_use]` は「戻り値を捨てる」ことは防げても、「呼び出し自体を書かない」ことは防げない。
2. **「検証済み」が型に残らない。** `save_to_db(user: &User)` は、渡された `User` が検証を通っているか知る手段がない。結果、各所で防御的に再検証するか、暗黙の前提に頼ることになる。
3. **検証と使用のあいだが空く。** 検証後に `user.email` を書き換えられても型は何も言わない（フィールドが `pub` である以上、静的に止められない）。

### The Rust Book の立場

The Rust Book ch.9.3「Custom Types for Validation」は、値が 1〜100 の範囲であることが決定的に重要で、その要件を持つ関数が多数ある場合、すべての関数に同じチェックを書くのは面倒でパフォーマンスにも影響しうる、と述べている。そのうえで、検証を各所で繰り返すのではなく **専用モジュールに新しい型を作り、その型のインスタンスを生成する関数に検証を置く** ことを勧めている。そうすれば関数シグネチャでその型を安全に使え、受け取った値を確信を持って扱える。

同章の `Guess` 型では、`value` フィールドが private であることが本質。外部コードは直接 `value` を設定できず、必ず `Guess::new` を経由するしかないため、条件を通っていない `Guess` は存在しえない。

## 解決

### 1. newtype + スマートコンストラクタで `Result<Self, E>` を返す

```rust
use std::str::FromStr;

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("email must contain '@'")]
    MissingAt,
    #[error("email is too long: {0} chars")]
    TooLong(usize),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email(String);   // 中身は private

impl Email {
    // 「検証して型を作る」= parse。Result<Self, E> であって Result<(), E> ではない
    pub fn parse(raw: &str) -> Result<Self, EmailError> {
        let trimmed = raw.trim();
        if !trimmed.contains('@') {
            return Err(EmailError::MissingAt);
        }
        if trimmed.len() > 254 {
            return Err(EmailError::TooLong(trimmed.len()));
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str { &self.0 }
}

// 標準トレイトにも乗せるとエコシステムと噛み合う
impl TryFrom<String> for Email {
    type Error = EmailError;
    fn try_from(s: String) -> Result<Self, Self::Error> { Self::parse(&s) }
}

impl FromStr for Email {
    type Err = EmailError;
    fn from_str(s: &str) -> Result<Self, Self::Err> { Self::parse(s) }
}
```

こうすると `fn save_to_db(email: &Email)` は検証を一切書かなくてよい。`Email` が存在するという事実が、検証を通った証明そのものになる。

`TryFrom` を実装する根拠は Rust API Guidelines (C-CONV-TRAITS) にある。常に成功する変換には `From`、失敗しうる変換には `TryFrom` を実装すべきとされ、`u32` が大きすぎると `u16` に収まらないため `TryFrom<u32> for u16` がエラーを返す形で実装されている。範囲外の文字列を弾く `Email` はまさにこの `TryFrom` 側。

### 2. serde 経路も塞ぐ

これをやらないと、JSON からの復元だけが検証を素通りする穴が残る。

```rust
#[derive(serde::Deserialize)]
#[serde(try_from = "String")]   // Deserialize が TryFrom を経由する
pub struct Email(String);
```

### 3. `Result<(), E>` を残してよい場所

**複数フィールドをまたぐ制約**は newtype 単体では表現できない。この場合も外向きは `Result<Self, E>` にし、`Result<(), E>` は private ヘルパに閉じ込める。

```rust
pub struct DateRange { start: Date, end: Date }

impl DateRange {
    pub fn new(start: Date, end: Date) -> Result<Self, RangeError> {
        Self::check(&start, &end)?;          // private なら Result<(), E> で自然
        Ok(Self { start, end })
    }

    fn check(start: &Date, end: &Date) -> Result<(), RangeError> {
        if start > end { return Err(RangeError::Inverted); }
        Ok(())
    }
}
```

**フォーム入力のエラー集約**はエコシステムの事実上の標準がまさに `Result<(), E>`。`validator` クレートの `validate()` は `Result<(), ValidationErrors>` を返し、`ValidationErrors` はフィールド名をキーとしたエラーのマップを持つ。カスタム検証関数も `Result<(), ValidationError>` を返す規約。

ただしそこで終わらせず、**検証後にドメイン型へ変換する**のが本筋。

```rust
// 境界層: エラーを集約して返す（Result<(), Errors> が向く）
#[derive(Deserialize, Validate)]
struct SignupDto {
    #[validate(email)] mail: String,
    #[validate(range(min = 18))] age: u32,
}

// ドメイン層: 検証済みであることが型で保証された値だけを受け取る
struct SignupCommand { mail: Email, age: AdultAge }

impl TryFrom<SignupDto> for SignupCommand { /* ... */ }
```

### 4. 判断表

| 状況 | 推奨シグネチャ |
|---|---|
| 単一の値の制約（範囲・書式・非空） | `Email::parse(&str) -> Result<Self, E>` / `TryFrom` / `FromStr` |
| 失敗理由が自明で 1 つだけ | `Foo::new(x) -> Option<Foo>`（std の `NonZeroU32::new` と同じ流儀） |
| 複数フィールドの相互関係 | 構造体全体の `new() -> Result<Self, E>` |
| 呼び出し側のバグ = 契約違反 | `new()` 内で `panic!`（Book の `Guess` 型） |
| フォーム入力の全エラー列挙 | `validate(&self) -> Result<(), ValidationErrors>` ＋ 後段でドメイン型へ変換 |
| 構築済みデータの不変条件確認 | `check(&self) -> Result<(), E>` |
| 単なる真偽判定、理由が不要 | `is_valid(&self) -> bool` |

### 5. Clippy の混同に注意

`Result<(), E>` を書いて Clippy に怒られた記憶があるなら、それは `result_unit_err` の可能性が高いが、あれは別物。`result_unit_err` は `Result<T, ()>`（エラー側が unit）を型付きエラーに置き換えるよう促すリントで、`Result<(), MyError>` は対象外。

### 6. 自前 newtype が面倒なら

`nutype` は通常の newtype にサニタイズと検証を追加する proc macro で、検証を通さずに値を生成することを不可能にする（serde 経路も同様）。

```rust
use nutype::nutype;

#[nutype(
    sanitize(trim, lowercase),
    validate(not_empty, len_char_max = 20),
    derive(Debug, PartialEq, Clone),
)]
pub struct Username(String);

// Username::try_new(" ") -> Err(UsernameError::NotEmptyViolated)
```

## まとめ

`Result<(), E>` は正しい型だが、「validate 関数を作る」という発想自体が OOP 言語からの持ち込みであることが多い。Rust では先に「この制約を型で表現できないか？」を問い、できるなら `Result<Self, E>` を返すコンストラクタに、できないなら `Result<(), E>` に、という順序で判断する。The Rust Book が `panic!` を選ぶ基準のひとつに「その情報を型でうまく表現する方法がない場合」を挙げているのは、裏を返せば型で表現できるならまずそちらを検討せよ、という立て付けである。

## 参考

- The Rust Programming Language ch.9.3 "To panic! or Not to panic!" — Custom Types for Validation: https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html
- Rust API Guidelines — Interoperability (C-CONV-TRAITS): https://rust-lang.github.io/api-guidelines/interoperability.html
- Rust API Guidelines — Checklist (C-NEWTYPE / C-CUSTOM-TYPE / C-CTOR): https://rust-lang.github.io/api-guidelines/checklist.html
- Alexis King, "Parse, don't validate": https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
- validator crate: https://github.com/Keats/validator
- nutype crate: https://github.com/greyblake/nutype
- Clippy `result_unit_err`: https://rust-lang.github.io/rust-clippy/master/index.html#result_unit_err
