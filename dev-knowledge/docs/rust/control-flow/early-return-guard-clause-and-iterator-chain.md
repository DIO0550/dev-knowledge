---
title: else を排除する早期 return（guard clause）と宣言的イテレータチェーンの使い分け
tags: [rust, control-flow, early-return, guard-clause, iterator, coding-style]
---

## TL;DR

- `else` を重ねると本処理がネストの奥に押し込まれる。**前提を満たさないケースを先に `return` で弾く**（guard clause）ことで、正常系をトップレベルに残せる。
- `for` ループで `Vec` に `push` していく命令的な集計・変換は、**`.iter().filter().map().collect()` の宣言的チェーン**に置き換えると意図がそのまま式として読める。
- どちらも「正常系を主役に据え、手続きではなく意図を表す」ための指針だが、対称な 2 分岐や副作用が主目的のループには無理に適用しない。

## 背景・射程

Rust の制御フローやコレクション処理では、不要な `if-else` による深いネストや、可変 `Vec` を使った命令的な `for` ループがコードの見通しを悪くしやすい。

- 対象：`Option` / `Result` や前提条件のチェックを伴う関数、およびコレクションの変換・抽出処理。
- 環境：`let ... else` 構文は Rust 1.65（2022-11）で安定化。それ以前のツールチェインでは `match` や `if let` による早期 `return` を使う。

## 判断軸・比較

### 1. `if-else` のネスト vs 早期 return（guard clause）

`else` を使うと分岐のネストが深くなり、前提チェックと本来の処理（正常系）が視覚的に混ざる。前提を満たさない条件を先頭で `return` して弾けば、以降は正常系だけを一直線に書ける。

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

- `let ... else { return ...; }` は「パターン束縛に失敗したら早期脱出する」意図をそのまま書ける。`else` ブロックは必ず発散（`return` / `break` / `continue` / `panic!` 等）する必要がある。
- 早期 `return` が先頭に並ぶことで、その関数が受け付けない前提条件が仕様のように読める。

### 2. 命令的 `for` ループ vs 宣言的イテレータチェーン

「空の `Vec` を用意 → ループで条件判定 → `push`」という手続きは、可変状態とループ本体を頭の中で追いかけないと目的が掴めない。

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

- 「アクティブなユーザーの名前を大文字にして集める」という**意図がそのまま式**になり、可変状態が消える。型注釈（`Vec<String>`）が結果の形も明示する。
- 集計・探索・畳み込みも `sum()` / `find()` / `any()` / `fold()` / `try_for_each()` などで簡潔に表現できる。

## 指針

- **ネストが深くなるとき・前提チェックが続くとき**は `let ... else` や `if !cond { return ...; }` の guard clause を優先する。
- **変換・抽出・集計が主目的のループ**はイテレータチェーンで書く。
- ただし、以下のケースでは無理に適用しない。
  - **条件が 2 分岐で対称なとき**：どちらも等価な分岐なら素直な `if / else` のほうが自然。
  - **副作用が主目的のループ**：ログ出力・I/O・複雑な状態遷移を伴う逐次処理は、無理に `for_each` にせず `for` のままにする。
  - **途中で早期脱出したいとき**：`filter().map().collect()` は全要素を走査するため、`for` ＋ `break` や短絡評価するメソッド（`find` / `position` / `any` / `try_for_each`）を選ぶ。

## 参考

- [Statements - let-else statements | The Rust Reference](https://doc.rust-lang.org/reference/statements.html#let-else-statements)
- [Processing a Series of Items with Iterators | The Rust Programming Language](https://doc.rust-lang.org/book/ch13-02-iterators.html)
