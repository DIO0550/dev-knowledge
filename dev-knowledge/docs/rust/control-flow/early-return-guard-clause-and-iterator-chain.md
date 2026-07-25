---
title: else を排除する早期 return（guard clause）と命令的 for を宣言的イテレータチェーンに
tags: [rust, coding-style, guard-clause, early-return, iterator, declarative, control-flow]
---

## TL;DR

- `else` を使うと本処理が分岐のネストの奥に押し込まれる。**前提を満たさないケースを先に `return` で弾く（guard clause）**と、本処理がトップレベルに残り読みやすい。
- `for` ループで `push` していく命令的パターンは、**`.iter().filter().map().collect()` の宣言的チェーン**に置き換えると「何をしたいか」が式で表せる。
- どちらも「正常系を主役に、逸脱系を先に処理する」という同じ発想。

## 問題

PR レビューで、不要な `if-else` が多くネストが深いコードと、`for` ループを命令的に回すコードが目立った。

## 原因

- **`else` を使うと分岐のネストが深くなる。** 本来の処理（正常系）が `if` のブロックの奥に入り、前提チェックと本処理が視覚的に混ざる。
- **`for` の命令的パターンも同様。** 「空の `Vec` を用意 → ループで条件判定 → `push`」という手続きは、可変状態とループ本体を読み手が頭の中で実行しないと意図が掴めない。

## 解決

### 1. `else` 排除 + 早期 return（guard clause）

前提を満たさない条件を先頭で `return` して弾き、以降は正常系だけを一直線に書く。

```rust
// NG: else でネストが深くなり、本処理が奥に入る
fn summarize(user: Option<&User>) -> Result<Summary, Error> {
    if let Some(user) = user {
        if user.is_active {
            Ok(build_summary(user)) // 本処理が二重ネストの奥
        } else {
            Err(Error::Inactive)
        }
    } else {
        Err(Error::NotFound)
    }
}
```

```rust
// OK: guard clause で逸脱系を先に弾き、本処理はトップレベルに残す
fn summarize(user: Option<&User>) -> Result<Summary, Error> {
    let Some(user) = user else {
        return Err(Error::NotFound);
    };
    if !user.is_active {
        return Err(Error::Inactive);
    }

    Ok(build_summary(user)) // ネストなし・正常系が主役
}
```

- `let ... else { return; }`（let-else 構文）は「束縛に失敗したら早期脱出」を素直に書ける。パターンが合わなければ `else` ブロックへ入り、そこは必ず発散（`return` / `break` / `continue` / `panic!` 等）する必要がある。
- 早期 return が並ぶことで「この関数が受け付けない条件」が先頭に列挙され、契約がドキュメントのように読める。

### 2. 命令的 `for` を宣言的イテレータチェーンに

```rust
// NG: 可変 Vec + for + push の命令的パターン
let mut names = Vec::new();
for user in &users {
    if user.is_active {
        names.push(user.name.to_uppercase());
    }
}
```

```rust
// OK: filter → map → collect の宣言的チェーン
let names: Vec<String> = users
    .iter()
    .filter(|u| u.is_active)
    .map(|u| u.name.to_uppercase())
    .collect();
```

- 「アクティブなユーザーの名前を大文字にして集める」という**意図がそのまま式**になる。可変状態が消え、型注釈（`Vec<String>`）が結果の形を明示する。
- 集計・探索・畳み込みもメソッドで表現できる（`sum()` / `find()` / `any()` / `fold()` / `try_for_each()` 等）。

## 適用しないほうがよいケース（注意）

- **副作用が主目的のループ**（ログ出力・I/O・複雑な分岐を伴う逐次処理）は、無理に `for_each` にせず素直な `for` のままのほうが読みやすいことがある。
- **途中で早期脱出したい**場合は、`for` + `break` か、`find` / `position` / `any` / `try_for_each`（`ControlFlow` / `Result`）などループを畳む形を選ぶ。`filter().map().collect()` は全要素を走査する点に注意。
- guard clause も、条件が 2 分岐で対称なら素直な `if/else` のほうが自然なこともある。**ネストが深くなる・正常系が奥に押し込まれるときに効く**指針として使う。

## 環境

- `let ... else` 構文は Rust 1.65（2022-11）で安定化。それ以前のツールチェインでは `match` / `if let` での早期 return に置き換える。
