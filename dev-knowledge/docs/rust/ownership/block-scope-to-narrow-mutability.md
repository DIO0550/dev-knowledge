---
title: Rust で mutable な変数の影響範囲をブロックスコープで狭めるのは正しいか
tags: [rust, ownership, mutability, mut, scope, block-expression, borrow-checker, nll, shadowing, idiom]
---

## TL;DR

- **「可変性を必要最小限のスコープに閉じ込める」という考え方自体は正しく、慣用的**。Rust はデフォルト immutable で、`mut` は「ここは変わる」という意図表明として控えめに使うのが望ましい。
- ただし手段が重要。本筋は **①ブロック式で構築し tail expression で immutable に取り出す（build-then-freeze）** か、**②シャドーイングで `let b = b;` と不変に締め直す**。
- 質問のコードのように **「借用を切るためだけに空ブロックで囲む」だけなら、NLL（Non-Lexical Lifetimes）以後は多くの場合不要**。借用は「最後の使用」で終わるので、ブロックを書かなくても後続の借用が通る。
- ブロックは値を外に取り出してこそ価値が出る。値を返さない `{ let mut b = ...; }` は「`b` の名前と可変性を関数スコープに漏らさない」効果はあるが、ネストが一段増えるコストと釣り合うか要検討。

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

この「mutable な変数 `b` の影響範囲を縮めるためだけにブロックを足す」書き方が Rust コミュニティ的に正しいのか・他に手段はないのか、を公式情報ベースで整理する。

## 前提: Rust はデフォルト immutable、`mut` は意図表明

The Book は変数がデフォルトで immutable な理由をこう説明する。

> "By default, variables are immutable. ... Adding `mut` also conveys intent to future readers of the code by indicating that other parts of the code will be changing this variable's value."
> — The Book ch.3-1

つまり「変わる」コードは限定的であるほど読み手が安心でき、可変状態は短命・狭スコープに保つほど推論しやすい。「可変性を狭めたい」という動機自体は Rust の設計思想に沿っている。問題は**その実現手段**である。

## 本筋(1): ブロック式で構築 → 取り出して immutable（build-then-freeze）

ブロックは式であり、末尾の式（tail expression、セミコロン無し）をブロックの値として返す。これは言語仕様。

> "When a block contains a final operand, the block has the type and value of that final operand."
> — Rust Reference: Block expressions

これを使うと「ブロック内では mutable に組み立て、外には immutable な束縛として取り出す」ことができる。**ブロックは値を取り出してこそ本領を発揮する。**

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

## 本筋(2): シャドーイングで再束縛（ネストを増やさない）

ブロックを使わず、同名で immutable に締め直すのも一般的。インデントが増えない分こちらが好まれる場面も多い。

```rust
let mut headers = Vec::new();
headers.push("Content-Type".to_string());
headers.push("Accept".to_string());
let headers = headers;   // 以降は immutable に締め直す（freeze）
```

build-then-freeze とほぼ同じ「以降は不変」効果を、ネストを増やさず得られる。

## 注意: 「借用を切るためだけのブロック」は NLL 以後ほぼ不要

質問のコードのように **値を取り出さない空ブロックの目的が「`&mut` 借用を早く終わらせて後続の借用を通すこと」なら、現代の Rust ではブロックは冗長**であることが多い。

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

つまり「後で別の借用をしたいだけ」なら、ブロックを書かなくてもコンパイルが通る。借用目的のブロックは古い Rust の名残になりやすい。

## 使い分けの指針

| 目的 | 手段 |
|---|---|
| `&mut` 借用を切って後続の借用を通したいだけ | **何もしない**（NLL が最後の使用で借用を終わらせる） |
| 可変に構築 → 以降 immutable にしたい | ブロック式で取り出す or シャドーイング `let b = b;` |
| 中間変数の名前を関数スコープから隠したい | ブロック式（中間変数はブロック内に閉じる） |
| 構築ロジックが大きい・再利用する | 関数に切り出す（ただし引数が増えすぎるならブロックの方が読みやすい） |

## デメリット・注意点

- **ネストが一段深くなる**。freeze 目的だけなら、ブロックよりシャドーイング（`let b = b;`）の方が浅く済むことが多い。
- **借用目的のブロックは大抵不要**（前述の NLL）。「借用を切るためだけの空ブロック」を見たら、まず削れないか疑う。
- シャドーイングで freeze する書き方は、Clippy の restriction 群 `shadow_same` / `shadow_reuse` / `shadow_unrelated`（いずれもデフォルト off）や `redundant_locals` と衝突しうる。これらは「好みで有効化する厳格 lint」なので、有効化しているプロジェクトでのみ意識すればよい。

## まとめ

- 「可変性を狭スコープに閉じ込める」動機は正しい。だが質問の `{ let mut b = ...; }`（値を返さない空ブロック）が**借用を切るため**なら、NLL のおかげで多くの場合そのブロックは不要。
- 本当に効くのは「**ブロック式で構築して immutable に取り出す**」か「**シャドーイングで `let b = b;` と締め直す**」。ブロックは値を外に出してこそ価値がある。
- 大きい構築ロジックは関数抽出も選択肢。迷ったら「このブロックは値を返しているか？返していないなら借用目的か？借用目的なら NLL で消せないか？」を順に確認する。

## 参考

- The Book ch.3-1 Variables and Mutability（デフォルト immutable / `mut` は意図表明）: https://doc.rust-lang.org/book/ch03-01-variables-and-mutability.html
- Rust Reference: Block expressions（ブロックは tail expression を値として返す）: https://doc.rust-lang.org/reference/expressions/block-expr.html
- RFC 2094 Non-Lexical Lifetimes（借用を切るブロックは「人工的」/ Problem Case #1）: https://rust-lang.github.io/rfcs/2094-nll.html
- Rust Blog: NLL fully stable（借用は作られたスコープより早く終わりうる、1.63 で全 edition デフォルト）: https://blog.rust-lang.org/2022/08/05/nll-by-default/
- The block pattern / initialize-and-freeze（コミュニティ）: https://notgull.net/block-pattern/
- Aim For Immutability in Rust（`mut` は控えめに・狭スコープで）: https://corrode.dev/blog/immutability/
- Clippy lint 一覧（`shadow_*`, `redundant_locals`）: https://rust-lang.github.io/rust-clippy/master/index.html
