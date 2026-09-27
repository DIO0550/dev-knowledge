---
title: Rust で関数内部に struct / enum を定義するのは避けるべきか
tags:
  [
    rust,
    design,
    struct,
    enum,
    scope,
    item-declaration,
    non-local-definitions,
    rustdoc,
    rust-analyzer,
    clippy,
    coding-style,
    typescript,
    go,
    java,
  ]
---

## TL;DR

- **公式には禁止も推奨もされていない**。Rust API Guidelines / Style Guide / clippy のいずれにも「関数内 struct / enum を避けよ」という規約は無い。設計判断（＝チームのローカル規約）の領域。
- 公式が明確に線を引いているのは **「外側で定義された型 / trait に対する `impl` を関数内に書くこと」** だけ（`non_local_definitions` lint、Rust 1.83 から warn-by-default）。**型と impl をセットで関数内に閉じる分には警告されない**。
- std / rustc / tokio は関数内 struct を **積極的に使っている**。アダプタ、`-> impl Display` ヘルパ、Drop ガード、使い捨て Visitor が定番パターン。
- 「見つけにくい」は半分だけ正しい。**rustdoc には一切載らない**が、**rust-analyzer のシンボル検索は（同一ワークスペースなら）拾える**。
- 実務上の分岐点は **外側のジェネリクスに依存するか / その関数の外でも使うか / 単体テストしたいか** の 3 つ。どれか 1 つでも Yes ならモジュールレベルへ出す。

## このドキュメントの射程

反復 DFS で「組み立て途中の 1 段」を表す `Frame` のような型を、関数の内部に書くかモジュールレベルに置くかの判断基準を整理する。

```rust
fn build_forest_node(&self, /* ... */) -> TaskTreeNode {
    // これを関数内に書くべきか、モジュールレベルへ出すべきか
    struct Frame {
        task_index: usize,
        cursor: usize,
        children: Vec<TaskTreeNode>,
    }
    // ...
}
```

対象バージョン: Rust 1.83 以降（`non_local_definitions` の warn-by-default 化）。ツール挙動の検証は rustc / rustdoc / rust-analyzer 1.94.1 で確認したもの。

## 原因

### 仕様上、関数内アイテムは「名前を持たないモジュールレベル定義」

The Rust Reference の [Item declarations](https://doc.rust-lang.org/reference/statements.html#item-declarations) が挙動を明記している。

> Declaring an item within a statement block restricts its **scope** to the block containing the statement. The item is **not given a canonical path** nor are any sub-items it may declare.
>
> There is **no implicit capture of the containing function's generic parameters, parameters, and local variables**.

つまり関数内定義は「意味的にはモジュール内に書いたのと同一。ただし canonical path が付かず、外側の文脈を一切引き継がない」。ここから実務上の性質がすべて導かれる。

```rust
fn outer() {
    let outer_var = true;

    fn inner() { /* outer_var is not in scope here */ }

    inner();
}
```

### ジェネリクスを継承できない（E0401）

これが最も硬い制約。外側の関数がジェネリックだと、その型引数を関数内アイテムから参照できない。

```rust
// 動かない例
fn foo<T>(x: T) {
    struct Foo {
        x: T, // error[E0401]: can't use generic parameters from outer item
    }
}

// 動く例（内側で宣言し直す）
fn foo<T>(x: T) {
    struct Foo<T> {
        x: T,
    }
}
```

出典: [E0401](https://doc.rust-lang.org/error_codes/E0401.html) / [Reference: Generic parameters](https://doc.rust-lang.org/reference/items/generics.html)

### 公式に非推奨なのは「非ローカルな impl」だけ

RFC 3373 由来の `non_local_definitions` lint が Rust 1.83.0 で warn-by-default になった。対象は **`impl` ブロックと `#[macro_export]` マクロのみ**で、plain な `struct` / `enum` / `type` の関数内定義は対象外。

> An `impl` definition is non-local if it is nested inside an item and **neither the type nor the trait are at the same nesting level** as the `impl` block.

rustc 1.94.1 で実際に確認した挙動:

| パターン                                                             | 結果                            |
| -------------------------------------------------------------------- | ------------------------------- |
| 関数内で `struct Local` を定義し、**同じ関数内で** `impl Display for Local` | 警告なし                        |
| 関数内で、**外側で定義された型**に `impl MyTrait for Outer`          | `warning: non-local 'impl' definition` |
| トップレベルの `const _: () = { impl Display for S {...} };`（serde 方式） | 警告なし                        |

孤児ルール回避のために関数内へ `impl` を隠すのは lint 対象で、エディション 2024 以降で deny 化される可能性がある（[tracking issue #120363](https://github.com/rust-lang/rust/issues/120363)）。

### lint / スタイルガイドには規約が無い

確認した結果「無い」ことを明示しておく。

- **Rust API Guidelines**: 該当項目なし。命名・trait 実装・ドキュメントが対象で、型定義の配置場所は扱っていない。
- **Rust Style Guide**: 関数内にアイテムを書けることを前提に、整形ルールだけを定めている。是非には言及しない。
  > Rust also allows some items to appear within some other types of items, such as within a function. The same formatting conventions apply whether an item appears at module level or within another item.
- **clippy**: 「関数内で型を定義するな」という lint は存在しない。近いのは `clippy::items_after_statements`（pedantic ＝ デフォルト allow）だが、これは「**文の後に**アイテムを書くこと」が対象で、ブロック先頭にまとめれば発火しない。
- **rustfmt**: 関連する設定オプションは見つからなかった。
- **The Rust Book**: このトピックをまとまった形では扱っていない。

### 「見つけにくい」仮説の検証

当初の仮説は半分だけ正しかった。rustc / rustdoc / rust-analyzer 1.94.1 で実機確認した結果:

| 仮説                                   | 結果                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `cargo doc` に出ない                   | **正しい**。`pub struct` を関数本体に置いても `struct.*.html` は生成されない。`--document-private-items` でも変わらない |
| IDE のシンボル検索で見つけにくい       | **誤り**。rust-analyzer の `workspace/symbol` は拾う。`containerName` に囲っている関数名が入る                          |
| テストから参照できない                 | **正しい**。canonical path が無いので、その型を単体で検証することはできない                                            |
| 名前空間を汚さない利点は実質的か       | **実質的**。std は「名前の漏洩を防ぐため」に意図的に body 内へ置いている例がある（`thread_local!` の展開）              |

rust-analyzer 側の裏付けは `SymbolCollector::collect_from_body` が body 内の block def map まで降りる実装になっていること。ただし **依存クレートは `collect_pub_only = true` で early return する**ため、ワークスペース外の関数内定義型は検索に出てこない。

なお RFC 3373 の動機自体が「IDE などのクロスリファレンスツールが全関数本体を舐める必要がある」という点だった。少なくとも rust-analyzer では、その懸念は実装で解消されている。

## 解決

### 使うタイミング: 5 つの定番パターン

std / rustc / tokio での実例を「なぜ関数内でなければならないか」の軸で整理する。共通するのは **その型が「関数の実装詳細そのもの」であり、外に出すと嘘になる** という構造。

#### (a) trait を別の trait に橋渡しするアダプタ / シム

**使うタイミング**: ある trait を要求する API に、別の trait を実装した値を渡したい。変換用の型はその 1 箇所でしか意味を持たない。

`core::io::Write::default_write_fmt` は `io::Write` を `fmt::Write` に見せかけつつ、`fmt::Write` が捨ててしまう I/O エラーを拾う。

```rust
fn default_write_fmt<W: Write + ?Sized>(this: &mut W, args: fmt::Arguments<'_>) -> Result<()> {
    // Create a shim which translates a `Write` to a `fmt::Write` and saves off
    // I/O errors, instead of discarding them.
    struct Adapter<'a, T: ?Sized + 'a> { inner: &'a mut T, error: Result<()> }
    impl<T: Write + ?Sized> fmt::Write for Adapter<'_, T> { /* ... */ }

    let mut output = Adapter { inner: this, error: Ok(()) };
    // ...
}
```

**外に出すと困ること**: `Adapter` はモジュールの語彙ではない。トップレベルに置くと「このモジュールが提供する概念」に見えてしまい、`pub(crate)` にすれば他所から誤用されうる。エラーを保持する `error` フィールドは「`fmt::write` を呼んだ直後に取り出す」という手順とセットでしか正しく使えず、その手順は関数の中にしかない。

#### (b) `-> impl Display` / `-> impl Debug` を返すためのヘルパ型

**使うタイミング**: 整形処理を遅延させたい（`format!` で先に `String` を作りたくない）。rustc 本体で最も多いパターン。

```rust
fn display(&self, idx: usize) -> impl '_ + fmt::Display {
    struct D<'a>(FnParam<'a>, usize);
    impl fmt::Display for D<'_> { /* ... */ }
    D(*self, idx)
}
```

**外に出すと困ること**: 戻り値は `impl Display` なので**呼び出し側は型名を知る必要がない**。名前が要らない型に名前空間を消費させる理由がない。`D` という 1 文字名がトップレベルで許されるのも、スコープが閉じているからこそ。

このパターンは「(a) の需要が API 境界に現れた形」でもある。std の `sys::backtrace` の `DisplayBacktrace` は、ロックを保持したまま整形を遅延させるため `unsafe { _print_fmt(...) }` を呼ぶ必要があり、**そもそも関数の外に出せない**。

#### (c) RAII / Drop ガード

**使うタイミング**: この関数を抜けるときだけ実行したい後始末がある。early return や panic の経路が複数あって、手で書くと漏れる。

```rust
fn with_scoped_value<T, R>(cell: &Cell<*const T>, value: &T, f: impl FnOnce() -> R) -> R {
    // 関数を抜けるとき（panic 含む）に必ず元へ戻す
    struct Reset<'a, T> { cell: &'a Cell<*const T>, prev: *const T }
    impl<T> Drop for Reset<'_, T> {
        fn drop(&mut self) { self.cell.set(self.prev); }
    }

    let _reset = Reset { cell, prev: cell.get() };
    cell.set(value);
    f()
}
```

実例は `std::sys::process::unix` の `PosixSpawnFileActions` / `Reset`、tokio の `runtime/context/scoped.rs` の `Reset`、tokio の `harness.rs`（`catch_unwind` に渡すクロージャの**さらに内側**に `Guard` を定義している）。

**外に出すと困ること**: ガードが復元する「前の値」はこの関数のローカル状態。トップレベルに出すと、その不変条件を型のドキュメントで説明し直す羽目になる。ガードは `let _guard = ...` と書いた行の直後に定義が見えるのが最も読みやすい。

#### (d) 使い捨ての Visitor / Iterator

**使うタイミング**: trait を実装しないと呼べない API（`Visitor`、`Iterator`、serde の `Deserialize`）に対して、この 1 回の走査のためだけに状態を持たせたい。

```rust
fn collect_spans(node: &Node) -> Vec<Span> {
    struct MyVisitor(Vec<Span>);
    impl<'v> Visitor<'v> for MyVisitor { /* 訪問中に self.0 へ push */ }

    let mut v = MyVisitor(Vec::new());
    v.visit(node);
    v.0
}
```

serde 公式ドキュメントの手動 `Deserialize` 実装も、`enum Field` と `struct DurationVisitor`、およびそれぞれの impl を**すべて `deserialize` 関数の中**に定義している。型と impl が同じネストレベルにあるので `non_local_definitions` にも引っかからない。

**外に出すと困ること**: Visitor はクロージャの代用品であり、「クロージャで書けるならクロージャで書く」ものが trait 制約でやむなく型になっただけ。クロージャをモジュールレベルに置かないのと同じ理由で、外に出す動機がない。

#### (e) テスト関数内のダミー型 / ガード

**使うタイミング**: そのテストケース専用のスタブ、フィクスチャ、後始末。

```rust
#[test]
fn child_is_killed_on_failure() {
    struct DropGuard(Child);
    impl Drop for DropGuard {
        fn drop(&mut self) { let _ = self.0.kill(); }
    }

    let _guard = DropGuard(spawn_child());
    // assert が落ちても子プロセスは確実に kill される
}
```

**外に出すと困ること**: テストモジュールの先頭に並べると、どのテストが使うものか分からなくなる。テストが増えるほど「使われていないヘルパ型」が溜まる。

### 判断フロー

上から順に見て、最初に該当したところで決める。

1. **外側の関数がジェネリックで、その型引数を使いたいか** → Yes ならモジュールレベル（E0401 で詰む。内側で宣言し直せば回避できるが、二重管理になるなら出したほうがよい）
2. **外側で定義された型 / trait に `impl` を書こうとしているか** → Yes ならモジュールレベル（`non_local_definitions` で warn。将来 deny 化の可能性あり）
3. **その型が関数の引数型 / 戻り値型として名前で露出するか** → Yes ならモジュールレベル（`-> impl Trait` なら露出しないので該当しない）
4. **その型自体を単体テストしたいか** → Yes ならモジュールレベル（canonical path が無いのでテストから参照できない）
5. **rustdoc に載せたいか** → Yes ならモジュールレベル（`--document-private-items` でも出ない）
6. **同じ定義が 2 箇所目に現れたか / 現れそうか** → Yes ならモジュールレベル
7. **既存コードがモジュールレベルに型を並べる流儀で統一されているか** → Yes なら揃える
8. ここまで全部 No → **関数内に閉じてよい**

### 使わないタイミング（避けるべきケース）

```rust
// 動かない例: 外側のジェネリクスを使おうとする
fn process<T: Clone>(items: Vec<T>) {
    struct Frame {
        item: T, // error[E0401]: can't use generic parameters from outer item
    }
}

// 動く例: 内側で宣言し直す（ただし二重管理になるなら外に出す）
fn process<T: Clone>(items: Vec<T>) {
    struct Frame<T> {
        item: T,
    }
}
```

```rust
// 警告される例: 外側で定義された型への impl を関数内に隠す
struct Outer;
trait MyTrait { fn f(&self); }

fn setup() {
    impl MyTrait for Outer { // warning: non-local `impl` definition
        fn f(&self) {}
    }
}

// 動く例: 型と impl をセットで関数内に閉じる（警告なし）
fn setup() {
    struct Local;
    impl MyTrait for Local {
        fn f(&self) {}
    }
}
```

孤児ルール回避のために関数内へ `impl` を隠すのは、この lint がまさに狙っている用法。**関数内定義を「回避策」として使い始めたら赤信号**と考えてよい。

### 冒頭の `Frame` はどちらか

`Frame` は「反復 DFS の途中状態」なので、上の判断フローでは 1〜6 がすべて No。**仕様上は関数内に閉じて問題ない**し、パターンとしては (c)(d) に近い「アルゴリズムの実装詳細」に当たる。

それでもモジュールレベルへ出す判断が妥当だったのは、**7 の「既存コードの流儀に揃える」が効いたから**であり、「関数内定義が Rust の慣習に反するから」ではない。ここは区別して覚えておく。

なお Reference が「モジュール内に宣言したのと意味的に同一」と言っている通り、**後から外に出すリファクタは容易**（`impl` ごと切り出して貼るだけ）。迷ったら関数内に閉じておいて、判断フローの 3〜6 に引っかかった時点で出す、という運用でも破綻しない。逆方向（外から中へ）も同じくらい安い。

### 他言語での同じ議論

この問題は Rust 固有ではなく、どの言語でも同じ 4 軸に収束する。

| 言語           | 関数内型定義                     | 主な制約                                                                 |
| -------------- | -------------------------------- | ------------------------------------------------------------------------ |
| **TypeScript** | 可（TS 1.6 で正式導入、ブロックスコープ） | 呼び出し側から名前で参照できない（構造的マッチのみ）。関数シグネチャには使えない |
| **Go**         | 可（`type` 宣言）                | **メソッドを定義できない** → インタフェースを実装できない（緩和提案は not planned） |
| **C++**        | 可（ローカルクラス）             | static データメンバ不可、メンバ関数はクラス内定義のみ、テンプレート不可   |
| **Java**       | 可（ローカル class / enum / record / interface） | ローカル record / enum / interface は暗黙 static                          |

共通の判断軸:

1. **到達可能性** — 名前で参照させたい瞬間（引数型、テスト、他モジュール）にローカル型は破綻する。これが最大の分岐点。
2. **意図の伝達** — 「この型はここでしか意味を持たない」をスコープで強制的に伝える手段。Go の匿名 struct は "communication tool"、Java のローカル record は「クラスの増殖を防ぎ可読性を上げる」目的で言語に追加された。
3. **繰り返しが出たら名前付きに昇格** — 同じ定義が複数箇所に現れたら named type にする（Go コミュニティのガイダンス）。
4. **言語ごとの機能的天井** — ローカル型は多くの言語で「二級市民」で、機能制限が実質的な上限を決める。

注目すべきは、**どの言語でも公式スタイルガイドやリンタがこれを機械的に裁定していない**こと（Effective Go、Go Code Review Comments、golangci-lint、typescript-eslint、Google TS Style Guide、C++ Core Guidelines をいずれも確認）。唯一 Java だけが、ローカル record という形で「中間値のモデリング」を言語仕様側が公式に祝福している。

## まとめ

関数内 struct / enum は Rust の慣習に反するものではなく、std も rustc も tokio も日常的に使っている。公式に非推奨なのは「外側の型 / trait への非ローカルな `impl`」だけ。実際の判断は **外側ジェネリクスへの依存・関数外での再利用・テスト可能性** の 3 点で決まり、それ以外は既存コードの流儀に揃えるのが妥当。

## 参考

- [The Rust Reference: Item declarations](https://doc.rust-lang.org/reference/statements.html#item-declarations)
- [The Rust Reference: Generic parameters](https://doc.rust-lang.org/reference/items/generics.html)
- [Error code E0401](https://doc.rust-lang.org/error_codes/E0401.html)
- [RFC 3373: Avoid non-local definitions in functions](https://rust-lang.github.io/rfcs/3373-avoid-nonlocal-definitions-in-fns.html)
- [`non_local_definitions` lint](https://doc.rust-lang.org/nightly/nightly-rustc/rustc_lint/non_local_def/static.NON_LOCAL_DEFINITIONS.html) / [tracking issue #120363](https://github.com/rust-lang/rust/issues/120363) / [warn-by-default 化 PR #127117](https://github.com/rust-lang/rust/pull/127117)
- [Rust Style Guide: Items](https://doc.rust-lang.org/style-guide/items.html)
- [Rust API Guidelines: Checklist](https://rust-lang.github.io/api-guidelines/checklist.html)
- [`clippy::items_after_statements`](https://rust-lang.github.io/rust-clippy/master/index.html#items_after_statements)
- [rust-analyzer: `SymbolCollector`](https://github.com/rust-lang/rust-analyzer/blob/master/crates/hir/src/symbols.rs)
- [Serde: Implementing Deserialize](https://serde.rs/deserialize-struct.html)
- [`core::io::Write` の `Adapter`](https://github.com/rust-lang/rust/blob/master/library/core/src/io/write.rs)
- [tokio: `runtime/context/scoped.rs` の `Reset`](https://github.com/tokio-rs/tokio/blob/master/tokio/src/runtime/context/scoped.rs)
- [TypeScript 1.6 Release Notes: Local type declarations](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-1-6.html)
- [Go spec: Declarations and scope](https://go.dev/ref/spec#Declarations_and_scope) / [golang/go#71562（ローカル型のメソッド定義提案・not planned）](https://github.com/golang/go/issues/71562)
- [Java: Record Classes（ローカル record）](https://docs.oracle.com/en/java/javase/17/language/records.html)
- [C++ [class.local]](https://timsong-cpp.github.io/cppwp/n4861/class.local)
