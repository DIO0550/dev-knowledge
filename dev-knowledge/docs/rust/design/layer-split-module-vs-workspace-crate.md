---
title: 層の分割は mod で始め、境界の強制やビルド時間が必要になったら workspace の crate に切り出す
tags: [rust, cargo-workspace, module-system, architecture, compile-time, project-structure]
---

## TL;DR

- Rust で層（domain / application / infrastructure など）を分ける方法は、1 crate 内の `mod` で分けるか、Cargo workspace の複数 crate に分けるかの 2 つ。
- 依存方向を**コンパイラで強制できる**のは crate 分割だけ。`mod` は `crate::` 経由でどこからでも参照でき、循環も書けてしまう。可視性（`pub(in path)`）では兄弟モジュール間の許可リストは表現できない。
- crate はコンパイル単位なので、分割すると部分リビルドと並列化が効く。ただし generic を境界に置くと下流ごとに単相化され、orphan rule で層をまたいだ `impl` が書けなくなるなどのコストがある。
- 指針は「まず `mod` で分け、`pub(crate)` / `pub(super)` で境界を整えて循環をなくしておく。逆向き参照が紛れ込む・ビルドが直列化する・一部を再利用したい、のどれかが出たら crate に切り出す」。

## 背景・射程

クリーンアーキテクチャやヘキサゴナルのような層構成を Rust で組むとき、層をどの単位で分けるかの判断軸を整理する。対象は Rust 2021 / 2024 edition、Cargo 1.64 以降（workspace 継承が使える版）。層の中身や置き方そのものは扱わない。

## 判断軸・比較

| 軸 | 1 crate + `mod` | workspace の複数 crate |
|---|---|---|
| 依存方向の強制 | できない（`crate::` でどこでも参照でき、循環も可） | Cargo が crate グラフの非巡回を保証。`Cargo.toml` に書かない依存は書けない |
| 可視性 | `pub(crate)` / `pub(super)` / `pub(in path)`。path は祖先モジュールに限られる | 層間で共有する item は `pub` が必要。`pub(crate)` は crate の外から見えない |
| ビルド | crate 全体が 1 コンパイル単位。小さな修正でも crate 全体を再コンパイルしうる | 変更のない crate は再コンパイルされない。独立した crate は並列にビルドされる |
| inline・単相化 | crate 内は本体が見えるので inline しやすい | 非 generic 関数は `#[inline]` がないと crate をまたいで inline されにくい。generic は呼び出し側 crate ごとに単相化される |
| orphan rule | 全部が local なので、どの `impl` も書ける | 外部の型に外部の trait を実装できない（例：infra 側で domain の型に外部 trait を実装する）。newtype や拡張 trait で回避が必要 |
| 手間 | `mod` 宣言だけ | crate ごとの `Cargo.toml`、`pub` API の設計、re-export が必要 |

### 依存方向は mod では守れない

`pub(in path)` の path は、宣言した item の祖先モジュールでなければならない。つまり「親より外に出さない」は書けるが、「`application` からは使えて `infrastructure` からは使えない」のような兄弟間の制限は書けない。

```rust
// src/domain/user.rs
pub(in crate::domain) fn normalize(name: &str) -> String { /* ... */ }  // domain 配下に閉じる

// src/infrastructure/db.rs
// domain が infrastructure を参照する逆向きの依存も、コンパイラは止めない
use crate::infrastructure::db::Pool;  // domain/ の中に書いても通る
```

crate に分けていれば、`domain` の `Cargo.toml` に `infrastructure` を書かない限り、この `use` はコンパイルエラーになる。

1 crate のまま検査したい場合は、`cargo-modules` の `dependencies --acyclic` でモジュール間の循環を検出できる。層の許可・禁止を宣言して検査するツール（`layered-crate`、`mille` など）もあるが、いずれも若い小規模プロジェクトで、ArchUnit のような定番はない。

### crate 分割のビルド上の効果は形次第

- 一本の鎖（`domain` ← `application` ← `infrastructure` ← `app`）に分けても、上流を変えると下流が全部再コンパイルされ、並列化も効かない。
- 効くのは「共通の語彙 crate」「互いに独立した機能 crate 群」「全部を束ねる leaf crate」という幅のある形。serde や DB ドライバなど重い依存は leaf 寄りに置く。
- crate 境界に generic 関数を置くと、具体型が決まる下流 crate ごとに同じコードが生成される。境界の API は非 generic にするか、薄い generic ラッパーから非 generic の内部関数に委譲する。
- 効果は事前に読みにくい。`cargo build --timings` で crate ごとの Gantt チャートを見て、1 つの大きな crate がビルドを直列化しているかを確認してから判断する。

## 指針

1. **小〜中規模はまず `mod`**。層をトップレベルのモジュールにし、`pub(crate)` / `pub(super)` で外に漏らさないようにしておく。循環をなくしておけば、後から crate に切り出しやすい。
2. **次のシグナルが出たら crate に切り出す**。
   - `crate::` 経由の逆向き参照や循環がレビューをすり抜けるようになった。
   - `cargo build --timings` で巨大な crate がビルドを直列化している、または小さな修正のたびに全体が再コンパイルされる。
   - 一部を別のバイナリやツールから再利用したい、一部だけ crates.io に公開したい。
   - 重い外部依存を一部の層だけに閉じ込めたい。
3. **切り出すときの注意**。境界の API は非 generic に寄せる。層をまたぐ `impl From` などが多いと orphan rule で newtype だらけになるので、変換関数をどちらの crate に置くかを先に決める。
4. 公式な行数の閾値はない。matklad は 1 万〜100 万行規模の workspace を前提に推奨構成を書いており、数千行規模で層ごとに crate を作るのは割に合わないことが多い。

## 参考

- [Inline In Rust（matklad, 2021-07-09）](https://matklad.github.io/2021/07/09/inline-in-rust.html)
- [Fast Rust Builds（matklad, 2021-09-04）](https://matklad.github.io/2021/09/04/fast-rust-builds.html)
- [Large Rust Workspaces（matklad, 2021-08-22）](https://matklad.github.io/2021/08/22/large-rust-workspaces.html)
- [Rust's Huge Compilation Units（PingCAP, 2020-06-22）](https://pingcap.com/blog/Rust-s-Huge-Compilation-Units)
- [The Rust Performance Book - Compile Times](https://nnethercote.github.io/perf-book/compile-times.html)
- [Cargo Book - Reporting build timings](https://doc.rust-lang.org/cargo/reference/timings.html)
- [The Rust Reference - Visibility and privacy](https://doc.rust-lang.org/reference/visibility-and-privacy.html)
- [RFC 2451 re-rebalancing coherence（orphan rule）](https://rust-lang.github.io/rfcs/2451-re-rebalancing-coherence.html)
- [rust-analyzer architecture.md（crate を API 境界として使う例）](https://fuchsia.googlesource.com/third_party/github.com/rust-lang/rust-analyzer/+/HEAD/docs/dev/architecture.md)
- [cargo-modules](https://github.com/regexident/cargo-modules)
- [Soft question: scaling codebase 50k → 500k loc（Rust Users Forum, 2023-12）](https://users.rust-lang.org/t/soft-question-scaling-codebase-50k-loc-500k-loc/104129)
