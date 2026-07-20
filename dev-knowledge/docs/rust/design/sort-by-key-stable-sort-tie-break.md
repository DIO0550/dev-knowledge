---
title: sort_by_key は stable sort だが同値の tie-break は明示すべき
tags: [rust, sort, stable-sort, tie-break, determinism]
---

## 問題

`CardOrder` の `order` 値でカラムをソートする際、`sort_by_key(|c| c.order)` で `order` のみを見ていたため、**同一 `order` を持つカラム間の順序が入力データ依存で不定**になっていた。

同じデータでも生成経路（挿入順・デシリアライズ順など）が変わると並びが変わり、結果が再現しない。

```rust
// 動かない例（同値の並びが入力依存で不定）
columns.sort_by_key(|c| c.order);
// order が同じカラム同士は「たまたまの入力順」で並ぶだけ
```

## 原因

Rust の [`slice::sort_by_key`](https://doc.rust-lang.org/std/primitive.slice.html#method.sort_by_key) / `sort_by` は **stable sort（安定ソート）**であり、キーが同値の要素同士は「ソート前の相対順序を保つ」。

ここで見落としやすいのは、stable であることは「**入力時の並びをそのまま維持する**」保証であって、「**こちらが意図した順序に並べる**」保証ではない、という点。

- キーに `order` しか渡していないと、同値要素の最終順序は入力の並びに完全に依存する。
- その入力順は仕様として保証していない（挿入順・HashMap 由来・デシリアライズ順などで揺れる）。

つまり「stable だから安定」なのは*相対順序*の話であって、*意図した決定性*は別途キーに埋め込まないと得られない。

## 解決

`sort_by` に変更し、`order` が同値のときは**カラム名の辞書順**で明示的に tie-break する。決定性の根拠をコード上に残す。

```rust
// 動く例（同値時のキーを明示して決定的にする）
columns.sort_by(|a, b| {
    a.order.cmp(&b.order)
        .then_with(|| a.name.cmp(&b.name)) // tie-break: 名前の辞書順
});
```

`sort_by_key` のまま複合キーのタプルを返しても等価に書ける。

```rust
columns.sort_by_key(|c| (c.order, c.name.clone()));
```

あわせて spec（仕様書）にも「`order` 同値時はカラム名辞書順」という tie-break ルールを追記し、コードと仕様の両方に決定性の根拠を残した。

## 教訓

- ソートキーに同値が起こりうるなら、**tie-break キーまで含めて全順序（total order）を定義する**。
- 「stable sort だから大丈夫」は、入力順そのものを仕様で保証している場合にのみ成り立つ。保証していないなら不定と同じ。
- 決定性が欲しい箇所では、`.then_with(...)` や複合キーのタプルで意図を明示する。
