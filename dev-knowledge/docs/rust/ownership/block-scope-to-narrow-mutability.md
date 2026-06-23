---
title: Rust で mutable な変数の影響範囲をブロックスコープで狭めるのは正しいか
tags: [rust, ownership, mutability, mut, scope, block-expression, drop, borrow-checker, nll, shadowing, idiom]
---

## TL;DR

- **「可変性・変数の影響範囲を必要最小限のスコープに閉じ込める」考え方は正しく、慣用的**。Rust はデフォルト immutable で、`mut` は「ここは変わる」という意図表明として控えめに使うのが望ましい。
- 質問のコードのように **値を返さないブロック `{ let mut b = ...; }` も正当なパターン**。効果は「`b` をブロック外で使えなくする（可視性の限定・誤再利用の防止）」と「ブロック末尾で `b` を早期 drop する」。
- 値を取り出したいなら **ブロック式で構築して immutable に取り出す（build-then-freeze）**、または **シャドーイング `let b = b;` で不変に締め直す**。
- 注意は1点だけ: ブロックの目的が **純粋に「`&mut` 借用を切ること」だけ**なら、NLL（Non-Lexical Lifetimes）以後は不要なことが多い。ただし**値の drop タイミングや変数の可視性を狭める目的なら、NLL とは無関係に今でも有効**。

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

この「mutable な変数 `b` の影響範囲を縮めるためにブロックを足す（値は返さない）」書き方が Rust コミュニティ的に正しいのか・他に手段はないのか、を公式情報ベースで整理する。

## 前提: Rust はデフォルト immutable、`mut` は意図表明

The Book は変数がデフォルトで immutable な理由をこう説明する。

> "By default, variables are immutable. ... Adding `mut` also conveys intent to future readers of the code by indicating that other parts of the code will be changing this variable's value."
> — The Book ch.3-1

「変わる」コードは限定的であるほど読み手が安心でき、可変状態は短命・狭スコープに保つほど推論しやすい。「影響範囲を狭めたい」という動機自体は Rust の設計思想に沿っている。

## パターン(1): 値を返さないブロックで「変数のスコープそのもの」を狭める ＝ 質問の形

`{ let mut b = ...; ... }` のように値を返さずブロックで囲むのは、**変数 `b` の生存範囲・可視性をブロック内に閉じる**書き方で、正当な慣用パターンである。効果は主に 2 つ。

### (a) 可視性の限定（ブロック外で使えなくする）

`b` はブロックを抜けるとスコープ外になり、以降のコードから参照できない。「この変数はここで完結する」という意図が構造で表現でき、後続コードでの誤った再利用を防げる。一連のサブ処理を視覚的に区切る効果もある。

### (b) 早期 drop（ここが NLL と無関係に効く本質）

ブロック末尾で `b` は drop される。`b` が `Drop` を持つ型（ファイルハンドル、各種ガード、大きなバッファ等）なら、**関数末尾を待たずに資源を解放できる**。

```rust
fn a() {
    {
        let mut buf = Vec::with_capacity(1_000_000);
        fill(&mut buf);
        flush(&buf);
    } // ← ここで buf が drop され、メモリが解放される

    // この先では buf を持たずに重い処理を続けられる
    heavy_work();
}
```

ポイント: 後述の NLL が縮めるのは**借用（`&` / `&mut`）の寿命**であって、**所有値そのものの drop タイミングはレキシカルなブロックスコープのまま**。だから「値を早く落としたい／後続に持ち越したくない」目的では、ブロックは今でも素直で有効な手段になる。

## パターン(2): ブロック式で構築 → 取り出して immutable（build-then-freeze）

値を外に渡したい場合は、ブロックの末尾の式（tail expression、セミコロン無し）をブロックの値として返せる。これは言語仕様。

> "When a block contains a final operand, the block has the type and value of that final operand."
> — Rust Reference: Block expressions

「ブロック内では mutable に組み立て、外には immutable な束縛として取り出す」ことができる。

```rust
let headers = {
    let mut h = Vec::new();        // 可変はブロック内だけ
    h.push("Content-Type".to_string());
    h.push("Accept".to_string());
    h                              // tail expression で取り出す
};
// ここから headers は immutable。`h` も `mut` も外に漏れない
```

利点は「`let headers = ...` の一行で意図が明確」「中間変数 `h` で関数スコープを汚さない」「ブロック終端で中間変数が drop される」。このパターンは "block pattern" / "initialize-and-freeze" と呼ばれ、可変操作を特定ブロックに閉じ込める（mutability の消去）手段として評価されている。

## パターン(3): シャドーイングで再束縛（ネストを増やさない）

ブロックを使わず、同名で immutable に締め直すのも一般的。インデントが増えない分こちらが好まれる場面も多い。

```rust
let mut headers = Vec::new();
headers.push("Content-Type".to_string());
headers.push("Accept".to_string());
let headers = headers;   // 以降は immutable に締め直す（freeze）
```

build-then-freeze とほぼ同じ「以降は不変」効果を、ネストを増やさず得られる。ただし「早期 drop」や「変数を完全にスコープ外へ追い出す」効果は無い（同名の不変束縛が関数末尾まで残る）。それが必要ならパターン(1)を選ぶ。

## 唯一の注意点: 目的が「借用を切るだけ」なら NLL で不要なことが多い

ブロックの目的が **純粋に「`&mut` 借用を早く終わらせて後続の借用を通すこと」だけ**なら、現代の Rust ではブロックは冗長であることが多い。

NLL（Non-Lexical Lifetimes、Rust 1.63 で全 edition デフォルト）により、借用はレキシカルなスコープではなく「実際に使われる範囲（最後の使用まで）」だけ生きる。

> "a borrow can end earlier than the scope it was created in."
> — Rust Blog: NLL fully stable

NLL の RFC 自身、借用を切るためのブロック導入を「人工的でわかりにくい解決策」と評している。

> "introducing a block like this is kind of artificial and also not an entirely obvious solution."
> — RFC 2094 (Non-Lexical Lifetimes)

```rust
// 旧 Rust: &mut を切るためにブロックが必要だった
fn old(data: &mut Vec<char>) {
    {
        let slice = &mut data[..];
        capitalize(slice);
    } // ここまで &mut が生きていた
    data.push('d');
}

// NLL 下: ブロック不要。slice の最後の使用で借用が切れる
fn modern(data: &mut Vec<char>) {
    let slice = &mut data[..];
    capitalize(slice); // ここで借用終了
    data.push('d');    // OK
}
```

繰り返すと、これは **借用目的に限った話**。パターン(1)の「可視性の限定」「早期 drop」は所有値に関する効果で、NLL では代替できない。

## 使い分けの指針

| 目的 | 手段 |
|---|---|
| `b` をブロック外で使えなくしたい／早く drop したい | **値を返さないブロック**（パターン1）= 質問の形でOK |
| 可変に構築 → 値を immutable で外に渡したい | ブロック式で取り出す（パターン2）or シャドーイング（パターン3） |
| `&mut` 借用を切って後続の借用を通したいだけ | **何もしない**（NLL が最後の使用で借用を終わらせる） |
| 構築ロジックが大きい・再利用する | 関数に切り出す（ただし引数が増えすぎるならブロックの方が読みやすい） |

## デメリット・注意点

- **ネストが一段深くなる**。freeze だけが目的ならシャドーイング（`let b = b;`）の方が浅く済むこともある。一方、早期 drop や可視性の限定が目的ならブロックでないと表現できない。
- **「借用を切るためだけ」のブロックは大抵不要**（前述の NLL）。ただし目的が drop / 可視性なら別物なので、機械的に「ブロック＝古い」と決めつけない。
- シャドーイングで freeze する書き方は、Clippy の restriction 群 `shadow_same` / `shadow_reuse` / `shadow_unrelated`（いずれもデフォルト off）や `redundant_locals` と衝突しうる。これらは「好みで有効化する厳格 lint」なので、有効化しているプロジェクトでのみ意識すればよい。

## まとめ

- 質問の `{ let mut b = ...; }`（値を返さないブロック）は正当なパターン。狙いは「`b` をブロック外で使えなくする」「ブロック末尾で早期 drop する」こと。
- 値を外へ渡したいなら「ブロック式で immutable に取り出す」か「シャドーイングで締め直す」。
- 唯一気をつけるのは「目的が借用を切るだけなら NLL で不要なことが多い」点。drop・可視性が目的なら NLL とは別問題で、ブロックは今でも有効。
- 迷ったら「このブロックは何を狭めているのか？ 値の drop／変数の可視性なら有効。借用だけなら NLL で消せないか？」を確認する。

## 参考

- The Book ch.3-1 Variables and Mutability（デフォルト immutable / `mut` は意図表明）: https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html
- Rust Reference: Block expressions（ブロックは tail expression を値として返す）: https://doc.rust-lang.org/reference/expressions/block-expr.html
- RFC 2094 Non-Lexical Lifetimes（借用を切るブロックは「人工的」/ Problem Case #1）: https://rust-lang.github.io/rfcs/2094-nll.html
- Rust Blog: NLL fully stable（借用は作られたスコープより早く終わりうる、1.63 で全 edition デフォルト）: https://blog.rust-lang.org/2022/08/05/nll-by-default/
- The block pattern / initialize-and-freeze（コミュニティ）: https://notgull.net/block-pattern/
- Aim For Immutability in Rust（`mut` は控えめに・狭スコープで）: https://corrode.dev/blog/immutability/
- Clippy lint 一覧（`shadow_*`, `redundant_locals`）: https://rust-lang.github.io/rust-clippy/master/index.html
