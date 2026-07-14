---
title: Rust で肥大化した struct 処理を分割するとき、`impl` と自由関数のどちらを選ぶか
tags: [rust, architecture, idiom, impl, free-function, code-organization, api-design]
---

## TL;DR

- Rust コミュニティは **`impl` 側を圧倒的に推す**。「struct を受け取る自由関数」で分割する方向はほぼ選ばれない。
- 判断基準は **「状態を保持・再利用するか（→ `impl`）」「引数だけで完結する一回限りの計算か（→ 自由関数）」**（users.rust-lang.org の常連 H2CO3 の言）。
- ファイルが肥大化したときの慣用パターンは「`impl` を捨てて自由関数に開く」ではなく、**「同じ型に対する `impl` ブロックを複数ファイルに分割する」**。Rust は同一型に対して複数の inherent `impl` を複数ファイルに書けるため、これが素直な解になる。
- 自由関数を選ぶのは「型と結びつかない、引数だけで完結する処理」に限定される。struct のフィールドを丸ごと受け取っているなら、それは `impl` に入れるべきサイン。

## このドキュメントの射程

Rust で開発を進めるうちに、ある struct とその関連ロジックを収めた 1 ファイルが数百〜数千行に膨れることがある。このとき、分割戦略として以下の 2 択が浮かぶ:

- **A: `impl` のまま `impl` ブロックを分けて（あるいは別ファイルに分けて）整理する**
- **B: struct はデータだけにして、`&Struct` / `&mut Struct` を受け取る自由関数群に開く**

本記事は、A と B のどちらが Rust コミュニティ的に慣用（idiomatic）なのかを、公式ドキュメント・Rust API Guidelines・users.rust-lang.org の議論を根拠に整理する。

## 原因: 自由関数化は Rust の言語機能を捨てる行為になる

### 命名の劣化 — 「命令っぽさ」が消える

自由関数側で分割すると、命名は自然とこうなる:

```rust
// 自由関数だとこう書きたくなる
user_validate(&user);
user_rename(&mut user, "new");
user_to_json(&user);

// メソッドなら
user.validate();
user.rename("new");
user.to_json();
```

**なぜこれが単なる好みじゃないか**、Rust 固有の理由が 4 つある:

#### 1. `impl` が「名前空間」を無料で提供する

`user.validate()` の `validate` と `email.validate()` の `validate` は、`impl` で書けば衝突しない。自由関数だと `user_validate` / `email_validate` と型名を prefix に付けざるを得ず、これは **C 言語で構造体メソッドをエミュレートしていた時代の書き方に戻ること** になる。Rust の `impl` は、この C 的な `struct_verb` 命名を過去のものにするための機能でもある。

#### 2. UFCS の存在が思想を裏付けている

Rust には Universal Function Call Syntax があり、以下は完全に等価:

```rust
user.validate();
User::validate(&user);
<User as Trait>::validate(&user); // トレイトメソッドの曖昧性解消
```

つまり **メソッドは「型に紐づく名前空間で呼び出せる自由関数」** そのもの。逆に言えば、わざわざメソッドを自由関数に開くのは、UFCS が無料で提供してくれる利便性を捨てているだけ、ということになる。

#### 3. auto-ref / auto-deref による呼び出し側の負担軽減

`user.validate()` は `user` が `User` / `&User` / `&mut User` / `Box<User>` / `Rc<User>` のどれでも書ける（method resolution が自動で参照を調整する）。自由関数だと呼び出し側で `validate(&*boxed_user)` のように参照の面倒を見る必要が出てくる。

```rust
let boxed: Box<User> = Box::new(user);

boxed.validate();     // メソッドなら auto-deref で動く
validate(&*boxed);    // 自由関数だと明示的な deref が必要
```

#### 4. rustdoc とツーリングの恩恵

型のドキュメントページに、その型に対して行える全能力が一箇所に並ぶ。IDE で `user.` と打った瞬間に補完が全メソッドを提示する。自由関数に散らばると、「この型が何をできるか」を grep なりファイル検索なりで探し回ることになり、**発見可能性（discoverability）が壊れる**。

### 凝集度の劣化 — anemic domain model 化

命名の話に加えて、自由関数への分割は OOP でいう **anemic domain model**（貧血ドメインモデル）に近づく。データ（struct）とふるまい（関数群）が別々のファイルに散らばり、「型を通じて能力を発見できる」という体験が成立しなくなる。

```rust
// アンチパターン: struct はデータだけ、処理は自由関数に散らばる
// user.rs
pub struct User { name: String, email: String, age: u32 }

// user_validation.rs
pub fn validate_user(user: &User) -> Result<(), Error> { /* ... */ }

// user_serialization.rs
pub fn user_to_json(user: &User) -> String { /* ... */ }

// user_lifecycle.rs
pub fn deactivate_user(user: &mut User) { /* ... */ }
```

これは、後述する The Rust Book の一文（「利用者がライブラリの方々を探し回らずに済むよう、その型に対して行えることをすべて 1 つの `impl` ブロックにまとめる」）が明確に避けろと言っているパターンそのもの。

### つまり、自由関数化で失うもの

`impl` から自由関数に開くと、以下を **全部同時に** 失う:

| 失うもの | 影響 |
|---|---|
| 型ごとの名前空間 | `struct_verb` 命名への退行 |
| UFCS の利便性 | 主語が消え、命令が名詞化する |
| auto-ref / auto-deref | 呼び出し側が参照管理を強いられる |
| rustdoc / IDE の発見可能性 | 型が「自分の能力」を語れなくなる |
| 凝集度 | anemic domain model 化 |

しかも Rust の意味論としては、これらを捨てて得られる利益は基本的に存在しない。

### 公式ドキュメント: 「メソッドを使う主な理由は organization」

『The Rust Programming Language』の Method Syntax の章は、この点をそのまま明言している:

> The main reason for using methods instead of functions, in addition to providing method syntax and not having to repeat the type of self in every method's signature, is for organization.
>
> — The Rust Programming Language, ch05-03

要するに **「型に対して何ができるかを、利用者が方々を探し回らずに済むよう、1 つの `impl` ブロックにまとめるため」** にメソッドがある、と公式が言っている。これは凝集度の話そのもの。

### Rust API Guidelines: 変換系は「メソッド」で提供せよ

Rust API Guidelines の C-CONV は、`as_` / `to_` / `into_` プレフィックスの変換メソッドを規定しており、自由関数として提供する形は想定されていない。C-GETTER も `get_` プレフィックスを禁じ、`s.first()` の形（自由関数なら `get_first(&s)` になる形）を推奨している。標準ライブラリ全体がこの規約に沿って設計されている。

### users.rust-lang.org の議論: 判断基準

[When to use functions and when to define structs and use methods on them?](https://users.rust-lang.org/t/when-to-use-functions-and-when-to-define-structs-and-use-methods-on-them/84952) スレッドから、常連 H2CO3 の回答:

> Use a type if you need to store and re-use state. For one-off computations that only depend on their arguments, use a free function.

- 状態を保持・再利用するなら **型（と `impl`）** を使う
- 引数だけに依存する一回限りの計算なら **自由関数** を使う

さらに同スレッドで simonbuchan は「型は状態のリファクタリング手段、関数は命令のリファクタリング手段」と表現している。また ZiCog は「もし分割された小関数群が元の大関数の引数を全部必要としているなら、それは分割の仕方が良くない兆候。共通データは struct に入れて関数をそれにアタッチするほうがよい」と指摘。つまり **「引数が多くなってきた」＝「`impl` にすべきサイン」** というのが Rust 的な感覚。

「struct はあるが処理は自由関数側に開く」方向は、ここでは推奨されていない。

## 解決: `impl` を保ちつつファイルを分割する

Rust では **同じ型に対して inherent `impl` ブロックを複数書ける**、しかも **別ファイルに分割してよい**。これが「ファイル肥大化」への慣用的な解になる。

### パターン A: 責務ごとに `impl` を別ファイルへ

```rust
// src/user/mod.rs — 型定義のみ
mod core;
mod validation;
mod serialization;

pub struct User {
    pub name: String,
    pub email: String,
    pub age: u32,
}
```

```rust
// src/user/core.rs — ライフサイクル系
use super::User;

impl User {
    pub fn new(name: String, email: String, age: u32) -> Self {
        Self { name, email, age }
    }

    pub fn rename(&mut self, name: String) {
        self.name = name;
    }
}
```

```rust
// src/user/validation.rs — バリデーション系
use super::User;

impl User {
    pub fn is_valid_email(&self) -> bool {
        self.email.contains('@')
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        // ...
        Ok(())
    }
}
```

```rust
// src/user/serialization.rs — 直列化系
use super::User;

impl User {
    pub fn to_json(&self) -> String {
        // ...
        String::new()
    }
}
```

呼び出し側は `user.rename(...)` / `user.validate()` / `user.to_json()` と、メソッド呼び出しの見た目のまま使える。「どのメソッドがどのファイルにあるか」を意識する必要はない。

### パターン B: trait 実装を別ファイルへ

`Debug` / `Display` / `Serialize` などのトレイト実装が増えてきた場合も同じ発想で分けられる。標準ライブラリの `std::iter::adapters::*` は、各アダプタが小さな別ファイルに分かれている好例（users.rust-lang.org の afetisov も学習リソースとして推奨している）。

### 非推奨: `const _: () = { impl ... };` パターン

「ファイル内で `impl` をブロックとして囲む」ために `const _: () = { impl X {...} };` を使う方法は、H2CO3 が「マクロ生成コード以外では絶対にやるな。誰も手書きでこんなコードは書かない」と明言しているため、避けるべき（[出典](https://users.rust-lang.org/t/discussion-on-the-several-way-to-split-large-code/102853)）。

### 自由関数を選ぶべき場面

`impl` が推奨とはいえ、以下のケースは自由関数（またはトレイトの `From` 実装）のほうが自然:

1. **複数の型を横断する変換・処理**（例: `A` と `B` を受け取って `C` を返す）。ただしこのケースは `impl From<(A, B)> for C` として書くほうが慣用的なことが多い。
2. **完全に純粋なユーティリティ計算**（例: `fn clamp(x: f64, lo: f64, hi: f64) -> f64`）。
3. **struct のフィールドを引数で受けているだけで、内部状態には触れない処理**。この場合は「そもそも struct と結びつける必然性がない」というシグナル。
4. **`std::mem::swap` / `std::mem::replace` のような、特定型と結合しないプリミティブ操作**。

判定のフローとしては以下:

```rust
// 判定フロー（擬似コード）
if 処理が struct のフィールドや不変条件に依存 {
    → impl に入れる
} else if 引数の複数が同じ struct から来ている {
    → impl に入れる（引数が多い＝impl 化のサイン）
} else if 型と結びつかない純粋計算 {
    → 自由関数
} else {
    → impl から始めて、必要になったら分ける
}
```

## まとめ

Rust では **「struct を受け取る自由関数」への分割は、UFCS・auto-ref・名前空間・rustdoc の恩恵を全部捨てて C 的な `verb_noun` 命名に退行する行為** になる。ファイル肥大化への対処は **「`impl` を複数ファイルに分割する」** が慣用パターンであり、自由関数は「型と結びつかない、引数だけで完結する処理」に限定するのが Rust コミュニティのコンセンサス。

## 参考

- The Rust Programming Language, ch05-03 Method Syntax — [https://doc.rust-lang.org/book/ch05-03-method-syntax.html](https://doc.rust-lang.org/book/ch05-03-method-syntax.html)
- Rust Reference, `impl` keyword — [https://doc.rust-lang.org/std/keyword.impl.html](https://doc.rust-lang.org/std/keyword.impl.html)
- Rust API Guidelines, Naming (C-CONV, C-GETTER) — [https://rust-lang.github.io/api-guidelines/naming.html](https://rust-lang.github.io/api-guidelines/naming.html)
- users.rust-lang.org: When to use functions and when to define structs and use methods on them? — [https://users.rust-lang.org/t/when-to-use-functions-and-when-to-define-structs-and-use-methods-on-them/84952](https://users.rust-lang.org/t/when-to-use-functions-and-when-to-define-structs-and-use-methods-on-them/84952)
- users.rust-lang.org: Discussion on the several way to split large code — [https://users.rust-lang.org/t/discussion-on-the-several-way-to-split-large-code/102853](https://users.rust-lang.org/t/discussion-on-the-several-way-to-split-large-code/102853)
- users.rust-lang.org: Code structure for big `impl`s distributed over several files
