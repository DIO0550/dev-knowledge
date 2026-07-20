---
title: else を使わず早期 return（guard clause）＋宣言的イテレータチェーンで統一する
tags: [rust, coding-style, guard-clause, early-return, iterator, declarative]
---

## 問題

PR レビューで、不要な `if-else` が多く、`for` ループも命令的な書き方だった。

```rust
// 動かない…わけではないが、ネストが深く読みにくい例
fn process(items: &[Item]) -> Vec<Output> {
    let mut result = Vec::new();
    for item in items {
        if item.is_valid() {
            if item.score > threshold {
                result.push(transform(item));
            } else {
                // 何もしない
            }
        } else {
            // 何もしない
        }
    }
    result
}
```

## 原因

- `if-else` で `else` を使うと分岐がネストし、「正常系がどれか」を追うのにインデントを目で辿る必要が出る。
- `for` + `push` の命令的パターンは、「何をしたいか（変換・絞り込み）」より「どう繰り返すか」が前面に出て、意図が埋もれる。

## 解決

**`else` を排除して早期 return（guard clause）で弾く**、**`for` ループを iterator chain（`.iter().filter().map()...`）に書き換える**、の 2 点で統一した。

### guard clause（早期 return）

条件を満たさないケースを先に `return`（クロージャ内なら `continue` / 早期の値）で弾き、本筋のロジックをネストの外に出す。

```rust
// 動く例：else を消し、正常系を最外周に出す
fn classify(item: &Item) -> Option<Output> {
    if !item.is_valid() {
        return None;      // guard: 無効はここで打ち切り
    }
    if item.score <= threshold {
        return None;      // guard: 閾値未満も打ち切り
    }
    Some(transform(item)) // 本筋。ネストしていない
}
```

- ネストが 1 段になり、「この関数の本題」が最後の 1 行に集約される。
- `else` の空ブロックや「何もしない」コメントが消える。

### iterator chain（宣言的）

`for` + 可変 `Vec` の蓄積を、`filter` / `map` のチェーンに置き換える。

```rust
// 動く例：命令的ループ → 宣言的チェーン
fn process(items: &[Item]) -> Vec<Output> {
    items
        .iter()
        .filter(|item| item.is_valid())
        .filter(|item| item.score > threshold)
        .map(transform)
        .collect()
}
```

- 可変状態（`let mut result`）が消え、各ステップが「絞り込み」「変換」と一目で分かる。
- `filter_map` を使えば「変換しつつ弾く」も 1 ステップにできる。

```rust
items.iter().filter_map(classify).collect()
```

## 教訓

- `else` は「両分岐に意味がある」ときだけ使う。片方が「弾くだけ」なら guard clause で早期 return する。
- ループが「集めて返す」形なら、まず iterator chain で書けないか検討する。可変 `Vec` の手動蓄積は最後の手段。
- どちらも「制御フローの形」ではなく「やりたいこと（意図）」がコードの表面に出るのが狙い。過度なチェーンで 1 行が長くなりすぎるなら、途中で `let` に束ねて可読性を優先する。
