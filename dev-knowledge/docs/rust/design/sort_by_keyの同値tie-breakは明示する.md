---
title: sort_by_key は stable sort だが同値の tie-break は明示すべき
tags: [rust, sort, stable-sort, tie-break, determinism]
---

## 問題

`CardOrder` の `order` 値でカラムをソートする際、`sort_by_key(|c| c.order)` で `order` のみを見ていた。その結果、**同一 `order` を持つカラム間の順序が入力データ依存で不定**になっていた。

```rust
// order だけを見ている
columns.sort_by_key(|c| c.order);
// order が等しいカラムどうしの並びは「入力の並び」次第 → 意図が表現されていない
```

## 原因

Rust の `slice::sort_by_key` / `sort` は **stable sort**（同値要素の相対順序を保つ）である。しかしこれは「入力時の並びを保つ」だけであって、**同値要素をどう並べたいかという意図を仕様として表現しているわけではない**。入力の並びが変われば結果も変わるため、決定性（determinism）が入力に依存してしまう。

## 解決

`sort_by` に変更し、`order` が同値のときは**カラム名の辞書順で明示的に tie-break** する。あわせて spec（仕様）にも tie-break ルールを追記し、「同値のときの並び」を仕様として固定する。

```rust
columns.sort_by(|a, b| {
    a.order
        .cmp(&b.order)
        .then_with(|| a.name.cmp(&b.name)) // order 同値時は name 辞書順で明示
});
```

- `Ordering::then_with` を使うと「第 1 キーが同値なら第 2 キーで比較」を素直に書ける。
- 教訓: stable sort に頼って「たまたま入力順で安定している」状態は、決定性の担保にならない。同値時の順序に意味があるなら **tie-break を明示し、仕様にも書く**。

## 環境

- Rust（`slice::sort_by` / `sort_by_key`、`std::cmp::Ordering::then_with`）
