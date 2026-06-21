---
title: Rust の loop と while let の使い分け
tags: [rust, control-flow, loop, while-let, clippy, while_let_loop, idiom, pattern-matching]
---

## TL;DR

- **停止条件が「パターンが一致しなくなること（データの不在）」なら `while let`**。
- **停止条件が「複雑なロジック」なら `loop` + `match`**。
- `while let` は `loop { match EXPR { PATS => {...}, _ => break } }` の糖衣構文（Rust Reference 公式）。ネストが 1 段浅くなる。
- 単純な `loop` + `match` + `break` を Clippy の `while_let_loop`（`style` グループ・デフォルト warn）が検出し、`while let` への書き換えを提案する。
- ただし `break` 前後に無条件の文があるケースなど、機械的に書き換えられない形では lint は発火しない＝そこは `loop` のままが正解。
- `loop` だけが `break value` で値を返せる。`while` / `while let` は常に `()` 評価。

## このドキュメントの射程

「`loop` を使うべきか `while let` を使うべきか」。`loop` + `match` を書くとネストがだんだん深くなる問題への対処として、どちらをいつ選ぶかを公式情報ベースで整理する。

## 判断基準

| 観点 | `while let` | `loop` (+ `match`) |
|---|---|---|
| 停止条件 | データの不在（パターン不一致） | 複雑なロジック・複数の break 条件 |
| 典型例 | `Vec::pop`、キューのドレイン、async ストリーム消費、リソースを使い切るまでのポーリング | エラー時リトライ、不正値スキップ、break 位置が本体中間/末尾、`break value` |
| 値を返す | 不可（常に `()`） | `break expr` で可能 |
| ネスト | 浅い | 深くなりがち |

要点は「**停止条件がデータの不在なら `while let`、停止条件がロジックなら `loop`**」。Rust コミュニティでは `Option` を返すメソッドを消費する慣用的な手段として `while let` を扱う。

## 原因（なぜ `loop` + `match` はネストが深くなるか）

`while let` は次の糖衣構文であることが Rust Reference に明記されている。

```rust
// これは
'label: while let PATS = EXPR {
    /* loop body */
}

// この loop + match と等価
'label: loop {
    match EXPR {
        PATS => { /* loop body */ },
        _ => break,
    }
}
```

つまり「`Some`/`Ok` が来る間だけ回し、来なくなったら抜ける」という単純パターンを `loop` で手書きすると、`match`（or `if let ... else { break }`）の分岐が常に 1 段挟まる。break の記述、非一致ケースの処理がボイラープレートになり、本来の意図が制御フローに埋もれる。`while let` はこのノイズを畳んでネストを 1 段下げる。

## 解決（書き分けの具体例）

### データの不在で止まる → `while let`

```rust
// Good: pop が None を返したら自然に終わる
let mut stack = vec![1, 2, 3];
while let Some(top) = stack.pop() {
    println!("{top}");
}
```

```rust
// 冗長: 上と等価だが 1 段深い。Clippy が while let を提案
let mut stack = vec![1, 2, 3];
loop {
    match stack.pop() {
        Some(top) => println!("{top}"),
        None => break,
    }
}
```

### ロジックで止まる・値を返す → `loop`

```rust
// loop でないと書けない: break で値を返す
let mut i = 1;
let result = loop {
    i *= 2;
    if i > 100 {
        break i; // loop だけが break value で値を返せる
    }
};
```

```rust
// ロジックが本質的: エラーはリトライ、特定値で break、それ以外は処理
loop {
    match next_event() {
        Err(_) => continue,          // リトライ
        Ok(Event::Quit) => break,    // 終了条件
        Ok(ev) => handle(ev),        // 通常処理
    }
}
```

### Clippy `while_let_loop`

- `style` グループ・デフォルトで warn。「この loop は while let で書ける」と検出する。
- 一方、`break` の手前に無条件で実行される文がある等、`while let` へ機械変換できない形では発火しない。発火しない＝その `loop` は妥当、というシグナルにもなる。
- 書き換えたくない正当な理由があれば `#[allow(clippy::while_let_loop)]` で抑止できる（Effective Rust 的には refactor を基本とし、抑止は理由があるときだけ）。

### 補足: ネスト削減には `let-else` も

ループ内で「必須の値が取り出せなければ continue/return」したい場合、`let ... else { break; }` でネストを増やさず早期離脱できる。

```rust
loop {
    let Some(x) = source.next() else { break; };
    process(x);
}
```

## まとめ

「不在で止まる」なら `while let`、「ロジックで止まる／値を返す」なら `loop`。迷ったら Clippy の `while_let_loop` が機械的に書き換え可能かを教えてくれる。

## 参考

- The Rust Reference – Loop expressions（`while let` の desugar、`loop` のみ break value 可）: https://doc.rust-lang.org/reference/expressions/loop-expr.html
- std `while` キーワード（`while` は常に `()` 評価）: https://doc.rust-lang.org/std/keyword.while.html
- Clippy lint `while_let_loop`（style グループ）: https://rust-lang.github.io/rust-clippy/master/index.html
- rust-clippy issue #1693 / #16393（書き換え不可な false positive 境界）: https://github.com/rust-lang/rust-clippy/issues/1693
- Effective Rust – Item 29: Listen to Clippy: https://effective-rust.com/clippy.html
