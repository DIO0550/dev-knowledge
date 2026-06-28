---
title: Rust の #[expect(lint)] は『無効化』ではなく『監視の入れ替え』
tags: [rust, lint, attribute, expect, allow, cfg_attr, dead_code, rust-1.81]
---

## TL;DR

- `#[expect(lint)]` は Rust 1.81.0（2024-09）で安定化された lint レベル。
- `#[allow(lint)]` と違い、**期待した lint が発生しなくなった瞬間に `unfulfilled_lint_expectations` 警告を出す**。
- つまり「lint を黙らせる」と同時に「黙らせる必要がなくなったら教えてくれ」という監視を仕込む属性。
- 一時的な抑制（リファクタ中・呼び出し元が後から追加される予定・段階的な lint 導入）に使い、消し忘れを防げる。
- `#[cfg_attr(not(test), expect(...))]` のように `cfg_attr` と組み合わせると、特定ビルド構成だけに expect を効かせられる。

## このドキュメントの射程

未使用予定の method に `#[allow(dead_code)]` を貼ると、後から呼び出し元を追加しても属性が残ったまま腐る。これを防ぐための `#[expect(...)]` 属性の挙動と、`cfg_attr` と組み合わせたときの意味を整理する。

対象: Rust 1.81.0 以降。

## 原因（なぜ `allow` だと困るのか）

`#[allow(dead_code)]` は対象 lint を**恒久的に**抑制する。

- 後で method が呼ばれるようになっても警告は出ない。
- 属性自体が陳腐化したことを誰も検知しない。
- 「Issue が解消されたら外す」というコメントは grep でしか拾えず、抜ける。

つまり「一時的な抑制」を**人間の善意とコメント**だけで管理することになる。

## 解決（`#[expect(lint)]` で監視に切り替える）

`#[expect(lint)]` は `allow` と同様に lint を抑制するが、**`expect` 属性によって実際に抑制された lint emission がなければ、その期待は満たされていない**と判定される（Rust Reference）。

期待が満たされない場合は `unfulfilled_lint_expectations` lint が `expect` 属性側に発火する。結果として:

| 状態 | `#[allow]` | `#[expect]` |
|---|---|---|
| 対象 lint が発生する | 抑制（何も起きない） | 抑制（何も起きない） |
| 対象 lint が発生しない | 何も起きない | **警告: この expect は不要** |

```rust
// 動かない例（呼び出し元が後で追加されたとき allow は腐る）
#[allow(dead_code)]
fn delete_task() { /* ... */ }
// → 後で呼び出されても allow は黙って残り続ける

// 動く例（呼び出し元が追加されたら警告が出る）
#[expect(
    dead_code,
    reason = "delete_task IPC (Issue #90) で本 method を呼び出す予定"
)]
fn delete_task() { /* ... */ }
// → 呼び出されるようになった瞬間に unfulfilled_lint_expectations が発火
```

### `cfg_attr` との組み合わせ

```rust
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "delete_task IPC (Issue #90) で本 method を呼び出す予定"
    )
)]
fn delete_task() { /* ... */ }
```

`cfg_attr(条件, 属性)` は条件が真のときだけ属性を付ける構文。上記は「**テストビルドでないとき**だけ `expect(dead_code)` を効かせる」という意味になる。

なぜ `not(test)` で限定するか:

- テストビルドでは method がテストから既に呼ばれており、`dead_code` が発生しない可能性がある。
- そのまま `#[expect(dead_code)]` だけだと、テストビルド時に「期待した dead_code が出ないぞ」と `unfulfilled_lint_expectations` が逆に発火してしまう。
- ビルド構成によって lint の発生有無が変わる場合は、`cfg_attr` で expect の適用範囲を絞る必要がある。

### `reason` パラメータ

`expect` / `allow` / `warn` / `deny` / `forbid` すべての lint 属性は `reason = "..."` を受け取れる（RFC 2383 で導入）。

- 人間向けのドキュメント。
- lint が定義レベルで発火したとき、メッセージの一部として表示される。
- `#[expect]` の場合、外し忘れ警告が出たときに「なぜ付けたか」を即座に思い出せる。

## 関連 Clippy lint

`expect` 移行を促す Clippy lint がある:

- `clippy::allow_attributes`: `#[allow]` を禁止して `#[expect]` への移行を促す。
- `clippy::allow_attributes_without_reason`: `#[allow]` に `reason` を必須化する。

## まとめ

`#[expect(lint)]` は「lint を黙らせる」属性ではなく、「黙らせる必要がなくなったら教えてくれ」という**監視の入れ替え**。一時的な抑制を**コンパイラに管理させる**ための仕組みであり、`#[allow]` の消し忘れ問題を構造的に解決する。

## 参考

- The Rust Reference - Diagnostic attributes (Lint check attributes): <https://doc.rust-lang.org/reference/attributes/diagnostics.html#lint-check-attributes>
- The rustc book - Lint Levels: <https://doc.rust-lang.org/rustc/lints/levels.html>
- RFC 2383 - Lint Reasons (`expect`): <https://rust-lang.github.io/rfcs/2383-lint-reasons.html>
- Announcing Rust 1.81.0: <https://blog.rust-lang.org/2024/09/05/Rust-1.81.0.html>
- Clippy `allow_attributes`: <https://rust-lang.github.io/rust-clippy/master/index.html#allow_attributes>
