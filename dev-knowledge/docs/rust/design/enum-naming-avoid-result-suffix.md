---
title: 結末・分岐を表す enum の命名 — `Result` サフィックスと汎用サフィックスを避け、概念名そのものを使う
tags: [rust, naming, enum, api-design, result, naming-convention, std]
---

## TL;DR

- 自前の型に `~Result` を付けるのは、**`std::result::Result` のエイリアス**に限ってイディオマティック（例: `io::Result`, `fmt::Result`）。
- 「成功/失敗」を意味しない「処理の結末」や「分岐の判定」を表す enum には、`~Result` を付けない。Rust では `Result` という単語は強く `Result` を連想させるため、混乱の元になる。
- 代わりに `~Outcome` / `~Decision` / `~Status` のような汎用サフィックスも避け、**std スタイル：その enum が「何であるか」を表す概念名そのもの**を型名にする（`ControlFlow`, `Cow`, `Entry`, `Ordering`, `Poll`）。

## このドキュメントの射程

「何かの結果・分岐を表す型」を作るときの命名指針。具体的には以下のケース:

- 関数の戻り値が「処理が成功して X した / 何もしなかった / スキップした」のような複数の結末を持つとき
- enum で「次に何をするか」「どう分岐するか」を呼び出し側に伝えたいとき
- `bool` では情報が足りないが、`Result` でもない（失敗の概念が無い）とき

## 原因 — なぜ `Result` サフィックスがミスリーディングか

`Result` は prelude で自動インポートされ、Rust コードを読む人は `Result` という単語を見た瞬間「`Ok` / `Err` の二択」を期待する。`std::io::Result` のドキュメントも以下を明記している:

> While usual Rust style is to import types directly, aliases of `Result` often are not, to make it easier to distinguish between them. `Result` is generally assumed to be `std::result::Result`.

つまり Rust では `~Result` という名前は **`std::result::Result` のエイリアスである** という強い慣習に縛られている。それ以外の意味で使うと、API を読む人が誤解する。

実際、標準ライブラリで `Result` と名の付く型は **すべて `Result` の特殊化**になっている:

| 型 | 実体 |
|---|---|
| `std::io::Result` | `Result` |
| `std::fmt::Result` | `Result<(), fmt::Error>` |
| `std::thread::Result` | `Result` |

## 解決 — std スタイル：概念名そのものを型名にする

std ライブラリは「処理の分岐・状態を表す enum」に対して、サフィックスを付けず**その概念を表す名詞そのもの**を一貫して使っている。

| 型 | バリアント | 表す概念 |
|---|---|---|
| `std::ops::ControlFlow` | `Continue(C)` / `Break(B)` | 処理を続けるか抜けるか |
| `std::borrow::Cow<'a, B>` | `Borrowed(&B)` / `Owned(B::Owned)` | 借用のままか所有するか |
| `std::collections::hash_map::Entry` | `Occupied(...)` / `Vacant(...)` | エントリが埋まってるか空か |
| `std::cmp::Ordering` | `Less` / `Equal` / `Greater` | 比較の関係 |
| `std::task::Poll` | `Ready(T)` / `Pending` | poll の状態 |

`ControlFlow` の公式ドキュメントは設計理由を明記している:

> Used to tell an operation whether it should exit early or go on as usual. Having the enum makes it clearer – no more wondering "wait, what did false mean again?" – and allows including a value.

「何の意味だったっけ?」と悩まないために、**enum 名がその概念そのもの**を語る形になっている。

### 判断フロー

ある型を作るとき:

1. それは「失敗しうる処理の戻り値」を表す `Result` のエイリアスか？
   - **Yes**: `FooResult` または `type Result = ...` でモジュール内 `Result` として定義 ✅
2. それは「成功時に複数の値を持つ構造体」か（失敗は別途 `Result` で表現）？
   - `Foo` 自体に `Result` は付けない。`FooOutput`, `FooReport`, または単に `Foo` 等、内容を表す名詞 ✅
3. それは「処理の分岐・判定を表す enum」か？
   - `~Result` / `~Outcome` / `~Decision` / `~Status` などの汎用サフィックスを付けず、**概念そのものの名詞**を型名にする ✅

### 適用例: TOML 編集の判定 enum

`edit_toml_str(input)` が「書き換えるべき新内容」「冪等スキップ」「ユーザー意思尊重スキップ」のいずれかを返すケース。

**❌ 良くない命名**:

```rust
// `Result` と勘違いされる
enum TomlEditResult {
    Changed(String),
    Unchanged,
    SkippedFalse,
}
```

**✅ std スタイルの命名**:

```rust
enum TomlEdit {
    Changed(String),
    Unchanged,
    SkippedFalse,
}

fn edit_toml_str(input: &str) -> TomlEdit { ... }
```

呼び出し側も自然に読める:

```rust
match edit_toml_str(&content) {
    TomlEdit::Changed(new) => fs::write(path, new)?,
    TomlEdit::Unchanged => {}
    TomlEdit::SkippedFalse => log::info!("user opted out"),
}
```

`ControlFlow` の語感（「これは制御フローを表す値だ」）と同じく、「これは TOML の編集を表す値だ」と一読で伝わる。

### 代替命名の候補

- 編集そのもの: `TomlEdit`（汎用、無難）
- ドメイン語彙を残す: `CodexHookEdit`, `HookConfig`
- 「変更したか / しなかったか」をフラットにし、理由をサブ enum に切り出す:

  ```rust
  enum TomlEdit {
      Changed(String),
      NotChanged(SkipReason),
  }

  enum SkipReason {
      AlreadyEnabled,      // codex_hooks = true 既にあり
      ExplicitlyDisabled,  // codex_hooks = false ユーザー明示
  }
  ```

  呼び出し側で「とにかく書き込み不要だったか」を `matches!(edit, TomlEdit::NotChanged(_))` で問える。

## まとめ

- `~Result` は `Result` のエイリアス専用と心得る。
- それ以外の「結末・分岐を表す enum」は、汎用サフィックスを付けず、std の `ControlFlow` / `Cow` / `Entry` / `Ordering` / `Poll` に倣って **概念名そのもの**を型名にする。
- 「この値は何であるか」を型名一語で語れているかを基準に選ぶ。

## 参考

- [Rust API Guidelines - Naming](https://rust-lang.github.io/api-guidelines/naming.html)
- [Rust By Example - aliases for `Result`](https://doc.rust-lang.org/rust-by-example/error/result/result_alias.html)
- [`std::io::Result`](https://doc.rust-lang.org/std/io/type.Result.html)
- [`std::ops::ControlFlow`](https://doc.rust-lang.org/std/ops/enum.ControlFlow.html)
- [`std::borrow::Cow`](https://doc.rust-lang.org/std/borrow/enum.Cow.html)
- [`std::collections::hash_map::Entry`](https://doc.rust-lang.org/std/collections/hash_map/enum.Entry.html)
- [`std::cmp::Ordering`](https://doc.rust-lang.org/std/cmp/enum.Ordering.html)
- [`std::task::Poll`](https://doc.rust-lang.org/std/task/enum.Poll.html)
