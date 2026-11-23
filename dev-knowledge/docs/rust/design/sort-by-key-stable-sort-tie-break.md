---
title: sort_by_key は stable sort だが同値の tie-break は明示すべき
tags: [rust, sort, stable-sort, tie-break, determinism]
---

## TL;DR

- Rust の `sort_by_key` / `sort_by` は安定ソート（stable sort）だが、それが保証するのは「入力時の相対順序の維持」だけであり、入力順が不定なら結果も不定になる。
- 同値キーが起こりうるソートでは、`.then_with(...)` や複合キーのタプルでタイブレーク（第 2 キー）を明示して全順序を定義すべき。

## 遭遇した問題

`order` 値で要素をソートする際、`sort_by_key(|c| c.order)` で `order` のみを見ていたため、**同一 `order` を持つ要素間の順序が入力データ依存で不定**になっていた。

同じデータでも生成経路（挿入順・デシリアライズ順など）が変わると並びが変わり、結果が再現しない。

```rust
// 問題のある例（同値の並びが入力依存で不定）
items.sort_by_key(|c| c.order);
// order が同じ要素同士は「たまたまの入力順」で並ぶだけ
```

## 原因

Rust の [`slice::sort_by_key`](https://doc.rust-lang.org/std/primitive.slice.html#method.sort_by_key) / `sort_by` は **stable sort**（安定ソート）であり、キーが同値の要素同士は「ソート前の相対順序を保つ」。

ここで見落としやすいのは、stable であることは「**入力時の並びをそのまま維持する**」保証であって、「**こちらが意図した順序に並べる**」保証ではない、という点。

- キーに `order` しか渡していないと、同値要素の最終順序は入力の並びに完全に依存する。
- その入力順は仕様として保証していない（挿入順・`HashMap` 由来・デシリアライズ順などで揺れる）。

つまり「stable だから安定」なのは**相対順序**の話であって、**意図した決定性**は別途キーに埋め込まないと得られない。

## 解決

`sort_by` に変更し、`order` が同値のときは**名前の辞書順**などで明示的にタイブレークする。決定性の根拠をコード上に残す。

```rust
// 推奨例（同値時のキーを明示して決定的にする）
items.sort_by(|a, b| {
    a.order.cmp(&b.order)
        .then_with(|| a.name.cmp(&b.name)) // タイブレーク: 名前の辞書順
});
```

`sort_by_key` のまま複合キーのタプルを返しても等価に書ける。

```rust
items.sort_by_key(|c| (c.order, c.name.clone()));
```

あわせて仕様ドキュメントにも「`order` 同値時は名前順」といったタイブレーク規則を明記しておくと、コードと仕様の両方で決定性の根拠を保てる。

## まとめ

- ソートキーに同値が起こりうるなら、**タイブレークキーまで含めて全順序（total order）を定義する**。
- 「stable sort だから大丈夫」は、入力順そのものを仕様で保証している場合にのみ成り立つ。保証していないなら不定と同じ。
- 決定性が欲しい箇所では、`.then_with(...)` や複合キーのタプルで意図を明示する。

## 参考

- [slice::sort_by_key - Rust Standard Library](https://doc.rust-lang.org/std/primitive.slice.html#method.sort_by_key)
