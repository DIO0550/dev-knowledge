---
title: Rust で mutable な変数の影響範囲をブロックスコープで狭めるのは正しいか
tags: [rust, ownership, mutability, mut, scope, block-expression, drop, nesting, borrow-checker, nll, shadowing, clippy, idiom]
---

## TL;DR

- 「可変性・変数の影響範囲を狭めたい」動機は正しい。だが **Rust は「フラット（浅いネスト）」を価値として推奨**しており、そのためだけにブロックでネストを増やすのは**第一選択ではない**。質問者の「ブロックは無しよりでは？」という直感はおおむね正しい。
- 目的別のフラットな代替を先に検討する:
  - **借用を切りたいだけ** → 何もしない（NLL が最後の使用で借用を終わらせる）
  - **以降 immutable にしたい** → シャドーイング `let b = b;`（mut→非mut なので Clippy に怒られない）
  - **早く drop したい** → `drop(b);` の1行（公式が推す早期解放の正規手段）
  - **構築して結果を渡したい** → 値を返すブロック式（build-then-freeze）
- ブロックが正当化されるのは主に **値を返す形（build-then-freeze）** と、**`drop()` で表現しづらい「複数の中間変数を一括解放／名前をスコープ外に漏らさない」** ケース。単一の変数を狭めるだけならフラットな手段が勝つ。

## このドキュメントの射程

```rust
fn a() {
    // ...処理
    {
        let mut b = something();
        // ...処理（b を変更する）
    }
    // ...処理
}
```

この「mutable な変数 `b` の影響範囲を縮めるためにブロックを足す（値は返さない）」書き方は、ネストが増える割に見合うのか。Rust はフラットとブロックのどちらを良しとするのか、を公式情報ベースで整理する。

## 前提: Rust は「フラット（浅いネスト）」を価値として推奨している

質問の核心はここ。Rust 公式は、ネストを浅く保つことを明確に良しとしており、そのための言語機能まで用意している。

- **`?` 演算子 / `let-else` / early-return** はいずれも「ネスト（rightward drift＝右に流れていくインデント）を減らす」ための機能。`let-else` の RFC は、`if let` が「本体内でしか束縛を作れず、rightward drift を強制し過剰なネストを招く」ことを動機に挙げている（RFC 3137）。The Book も `let...else` を「happy path に留まれる」書き方として推す。
- **Clippy `excessive_nesting`**（`complexity` グループ・warn-by-default）はネストの深さそのものを問題視する公式 lint で、Why bad に「可読性を著しく損なう」と書かれ、対処として「関数へ抽出」を勧める。
  - ただし温度感に注意: この lint は `clippy.toml` に `excessive-nesting-threshold`（デフォルト `0`＝無効）を明示設定しない限り発火しない。**「ネストは浅く」を公式が価値として認めつつ、強制まではしていない**、というのが実態。

つまり「可変性を狭めたい」動機は正しいが、その実現に**ネストを増やす方向（ブロック）はRust の美意識に逆行しやすい**。まずフラットな手段を検討するのが筋。

## フラットな代替を目的別に

### 借用を切りたいだけ → 何もしない（NLL）

`&mut` 借用を早く終わらせて後続の借用を通したいだけなら、ブロックは不要。NLL（Non-Lexical Lifetimes、Rust 1.63 で全 edition デフォルト）により借用は「最後の使用」で終わる。

> "a borrow can end earlier than the scope it was created in."
> — Rust Blog: NLL fully stable

RFC 2094 自身、借用を切るためのブロック導入を「人工的でわかりにくい解決策」と評している。

```rust
// NLL 下: ブロック不要。slice の最後の使用で借用が切れる
fn modern(data: &mut Vec<char>) {
    let slice = &mut data[..];
    capitalize(slice); // ここで借用終了
    data.push('d');    // OK
}
```

### 以降 immutable にしたい → シャドーイング `let b = b;`

同名で immutable に締め直す。ネストを増やさず「以降は不変」を表現できる。

```rust
let mut headers = Vec::new();
headers.push("Content-Type".to_string());
headers.push("Accept".to_string());
let headers = headers;   // mut → 非mut に凍結（freeze）
```

**Clippy の `redundant_locals`（`suspicious` グループ）と衝突しないのがポイント。** この lint は `let x = x;` を冗長として検出するが、発火するのは「前の束縛と mutability が同じ」ときだけ。`let mut x = ...; let x = x;` は mut→非mut で mutability が異なるため**対象外**になる（実装でこのケースを除外）。
- ただし `let mut` でない `let x = ...; let x = x;`（同 mutability で純粋にライフタイムを縮めるだけ）は `redundant_locals` の警告対象になりうる。freeze 目的（mut→非mut）でだけ安全に使える。

### 早く drop したい → `drop(b);`

公式が早期解放の正規手段として第一に挙げるのは、ブロックではなく `std::mem::drop`。std ドキュメントは `RefCell` の可変借用を `drop(mutable_borrow);` で手放してから再借用する例を示している。

```rust
let mut b = acquire();
use_mut(&mut b);
drop(b);          // ここで明示的に解放。フラットで「ここで捨てる」意図も明確

heavy_work();     // b を持たずに続行
```

ブロックで囲って末尾 drop させるより、`drop(b);` 1行のほうがフラットで意図も声高に伝わる。**単一の値・ガードを早く落とすだけなら `drop()` が慣用。**

補足（重要）: NLL が縮めるのは**借用の寿命だけ**で、**所有値そのものの drop タイミングは NLL 後もレキシカルスコープ依存**（束縛位置で決まる）。だから「値を早く落とす」には `drop()` やスコープ操作という明示手段がいる。`std::mem::drop` が存在すること自体がその裏返し。

## ブロックが正当化される場面

ネストを増やしてでもブロックを使う価値があるのは、主に次の2つ。

### (1) 値を返すブロック式（build-then-freeze）

ブロックは式で、末尾の式（tail expression）を値として返せる。「中で mutable に組み立て、外には immutable で取り出す」形は、ネスト1段と引き換えに「結果が一行で見える」「中間変数を閉じ込める」メリットが得られ、慣用として受け入れられている。

```rust
let headers = {
    let mut h = Vec::new();        // 可変はブロック内だけ
    h.push("Content-Type".to_string());
    h.push("Accept".to_string());
    h                              // tail expression で取り出す
};
// ここから headers は immutable。`h` も `mut` も外に漏れない
```

（"block pattern" / "initialize-and-freeze" と呼ばれる。一次の決定打的ドキュメントは薄く、解説は notgull.net など二次情報。仕様面はブロックが式であること＝Rust Reference に基づく。）

### (2) `drop()` で表現しづらい一括解放・名前隠し

`drop(a); drop(b); drop(c);` と並べるより、**複数の中間変数をまとめてスコープ外に追い出したい**、あるいは**中間変数名を後続コードに漏らしたくない**ときは、ブロックのほうが意図が明確になりうる。Rust by Example も「ブロック `{}` で変数の lifetime を限定できる」用法を正当なものとして例示している。質問のコードがこの性格（複数の作業変数を `b` 周辺で完結させたい）なら、ブロックは妥当な選択。

## 使い分けの早見表

| 目的 | 第一選択（フラット） | ブロックを使うなら |
|---|---|---|
| `&mut` 借用を切るだけ | 何もしない（NLL） | — |
| 以降 immutable | シャドーイング `let b = b;` | build-then-freeze |
| 単一値を早く drop | `drop(b);` | （基本不要） |
| 複数中間変数を一括解放／名前隠し | — | bare block が妥当 |
| 構築して結果を渡す | — | build-then-freeze が妥当 |
| 大きいロジックの分離 | 関数に切り出す | — |

## まとめ

- 結論はフラット第一。Rust は浅いネストを良しとし（`?`/`let-else`/early-return、`excessive_nesting`）、可変変数を狭めるだけなら **シャドーイング `let b = b;` / `drop(b);` / 何もしない（NLL）** といったフラットな手段が先に来る。質問者の「ブロックは無しより」という感覚は妥当。
- ブロックがネストの元を取れるのは **値を返す（build-then-freeze）** ときと、**`drop()` で書きづらい複数変数の一括解放・名前隠し** のとき。
- 迷ったら「このブロックは値を返すか？返さないなら、`drop()`／シャドーイング／NLL で平らにできないか？ できないだけの理由（複数変数の一括解放等）があるか？」を順に確認する。

## 参考

一次情報:
- The Book ch.6-3 `if let` / `let...else`（happy path・ネスト削減）: https://doc.rust-lang.org/book/ch06-03-if-let.html
- RFC 3137 let-else（rightward drift・過剰ネストが動機）: https://rust-lang.github.io/rfcs/3137-let-else.html
- Rust by Example: Early returns（rightward shift 削減）: https://doc.rust-lang.org/rust-by-example/error/result/early_returns.html
- Rust by Example: Scope（ブロックで変数の lifetime を限定）: https://doc.rust-lang.org/rust-by-example/variable_bindings/scope.html
- Clippy `excessive_nesting`（complexity・閾値設定でオプトイン）: https://rust-lang.github.io/rust-clippy/master/index.html#excessive_nesting
- Clippy lint configuration（`excessive-nesting-threshold`, default 0）: https://doc.rust-lang.org/clippy/lint_configuration.html
- `std::mem::drop`（早期解放の正規手段・RefCell 例）: https://doc.rust-lang.org/std/mem/fn.drop.html
- Clippy `redundant_locals`（`let x = x;`・mutability 違いは除外）: https://rust-lang.github.io/rust-clippy/master/index.html#redundant_locals
- redundant_locals 実装・PR（mut→非mut の freeze は対象外、drop order はレキシカル）: https://github.com/rust-lang/rust-clippy/pull/10885
- RFC 2094 Non-Lexical Lifetimes（借用を切るブロックは「人工的」）: https://rust-lang.github.io/rfcs/2094-nll.html
- Rust Blog: NLL fully stable（借用は早く終わりうる。NLL は借用のみ）: https://blog.rust-lang.org/2022/08/05/nll-by-default/
- The Book ch.3-1 Variables and Mutability（デフォルト immutable / `mut` は意図表明）: https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html

二次情報:
- The block pattern / initialize-and-freeze: https://notgull.net/block-pattern/
