---
title: Rust で自作関数に `collect` と名付けない（Iterator::collect との衝突）
tags: [rust, naming, api-guidelines, iterator, collect, method-resolution, clippy]
---

## TL;DR

- Rust における `collect` は `Iterator::collect`（`FromIterator` によるイテレータ終端）を指す語として強く予約された語感を持つ。
- 「外部からデータを取得する」処理に無修飾の `collect` を付けると、読み手の期待と実装がズレる。
- `Iterator` を実装した型に固有メソッド `collect(self)` を生やすと、**同じレシーバ段階では固有メソッドがトレイトメソッドより先に探索される**ため、`Iterator::collect` を静かに隠す。
- 代替は「何をどこから取るか」を名前に出す（`read_` / `fetch_` / `load_` / `list_` / `query_` / `walk_`）か、名詞ゲッターにする。
- 「収集」の語感がどうしても要るときは `collect_<目的語>` と目的語を付ける。rustc 本体も `rustc_hir_analysis::collect` としてこの形を使っている。

## このドキュメントの射程

Rust のメソッド／関数の命名のうち、「データを集めてくる」処理に `collect` を使ってよいかという一点に絞る。イテレータの `collect` の使い方そのもの（ターボフィッシュ、`FromIterator` 実装）は扱わない。

他言語（Python / Go など）の「collect data」という一般語の感覚をそのまま Rust に持ち込むと事故る、というのが背景。

## 原因

### 1. `collect` は std で「イテレータ → 器」の専用語になっている

`Iterator::collect` はイテレータの所有権を奪い、要求した任意のコレクション型を生成するメソッド。コレクションに `iter` を呼び、変換を重ね、最後に `collect()` する、という定型の終端に置かれる。

汎用性が高すぎて型推論が効かない場面が多く、ターボフィッシュ `::<>` を目にする数少ない場面のひとつでもある。この特異さのおかげで、Rust プログラマにとって `collect` という単語は反射的に `FromIterator` を連想させる。

### 2. 固有メソッドがトレイトメソッドを隠す

メソッド解決では、同じレシーバ段階において固有メソッド（inherent method）がトレイトメソッドより先に探索される。したがって `Iterator` を実装した型に同名の固有メソッドを生やすと、コンパイルエラーにならずに呼び先が変わる。

```rust
struct Metrics {
    raw: Vec<u32>,
}

impl Iterator for Metrics {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        self.raw.pop()
    }
}

impl Metrics {
    // 「データを集めてくる」つもりで付けた名前
    fn collect(self) -> Vec<u32> {
        self.raw
    }
}

let m = Metrics { raw: vec![1, 2, 3] };
let v: Vec<u32> = m.collect(); // ← Iterator::collect ではなく固有メソッドが呼ばれる
```

読み手は `Iterator::collect` のつもりで読むのに、実際は別物が走る。エラーが出ないぶん質が悪い。

### 3. Rust API Guidelines の方向性と合わない

ガイドラインは「取得する行為」より「取得される物」で名付ける方向を示している。

- **C-GETTER**: わずかな例外を除き、ゲッターに `get_` プレフィックスは使わない。
- **C-ITER**: 要素型 `U` のコンテナには `iter` / `iter_mut` / `into_iter`。
- **C-CONV**: 所有権が動くなら `as_`（無料・借用→借用）/ `to_`（高コスト）/ `into_`（所有→所有）。
- **C-WORD-ORDER**: 語順はクレート内で一貫させ、std の類似機能と揃える。

std の実例も名詞寄りに寄っている。

| やりたいこと | std の実例 | パターン |
|---|---|---|
| 保持している値を返す | `Vec::iter`, `BTreeMap::keys`, `BTreeMap::values` | 名詞 |
| 別の見方で列挙 | `str::chars`, `str::bytes` | 名詞（複数形） |
| I/O を伴う取得 | `fs::read_dir`, `fs::read_to_string` | `read_*` |
| 外部プロセスから結果取得 | `Command::output` | 名詞 |
| 環境から一覧取得 | `env::vars`, `env::args` | 名詞（複数形） |

## 解決

### 「何をどこから」を名前に出す

```rust
// ❌ 意味が広すぎ & Iterator::collect と衝突
fn collect(&self) -> Vec<Metric>;

// ✅ データソースと行為を明示する
fn read_metrics(&self)  -> io::Result<Vec<Metric>>;              // ファイル / IO から
fn fetch_metrics(&self) -> Result<Vec<Metric>, ApiError>;        // ネットワーク越し
fn load_config(&self)   -> Result<Config, ConfigError>;          // 永続化層から読み込み
fn list_entries(&self)  -> io::Result<Vec<DirEntry>>;            // 一覧取得
fn query_users(&self, f: &Filter) -> Result<Vec<User>, DbError>; // 問い合わせ
fn walk_files(&self)    -> impl Iterator<Item = PathBuf>;        // 走査（遅延）
fn metrics(&self)       -> &[Metric];                            // 単なるゲッター
```

### どうしても「収集」の語感が要るなら目的語を付ける

`collect` という語自体がタブーなわけではない。**rustc 本体には `rustc_hir_analysis::collect` モジュールが存在し**、HIR から型情報を収集するフェーズを指している（配下に `collect::type_of`、`collect::dump::predicates_and_item_bounds` など）。

問題は無修飾の `collect` をメソッド名にすることであって、目的語で修飾すれば読み違えられない。

```rust
fn collect_diagnostics(&self) -> Vec<Diagnostic>;
fn collect_dependencies(&self) -> BTreeSet<PackageId>;
```

`collect_` で始めると決めたら、C-WORD-ORDER に従いクレート全体で語順を揃えること。

### 関連: そもそも `collect` が要るか疑う（`clippy::needless_collect`）

命名とは別軸だが根は同じ。Clippy には `collect` が不要な場面でイテレータを collect している箇所を検出する `needless_collect` lint がある。

```rust
// ❌ 中間 Vec が無駄
let names: Vec<_> = users.iter().map(|u| &u.name).collect();
for n in names {
    println!("{n}");
}

// ✅ 器が要らないなら collect しない
for n in users.iter().map(|u| &u.name) {
    println!("{n}");
}
```

「器として保持する必要があるか」を毎回問う。要らないのに collect する癖と、要らないのに `collect` と名付ける癖は、どちらも「データ処理＝集める」という他言語的な発想から来ている可能性がある。

## まとめ

`collect` は `Iterator::collect` 専用の予約語のような扱い。自作関数には無修飾で使わず、`read_` / `fetch_` / `load_` / `list_` / `query_` のようにデータソースと行為を明示するか名詞ゲッターにする。収集の語感が必要なら `collect_metrics` のように必ず目的語を付ける。

## 参考

- [Iterator::collect — std ドキュメント](https://doc.rust-lang.org/std/iter/trait.Iterator.html)
- [FromIterator — std ドキュメント](https://doc.rust-lang.org/std/iter/trait.FromIterator.html)
- [Rust API Guidelines — Naming（C-CONV / C-GETTER / C-ITER / C-WORD-ORDER）](https://rust-lang.github.io/api-guidelines/naming.html)
- [The Rust Programming Language — Processing a Series of Items with Iterators](https://doc.rust-lang.org/book/ch13-02-iterators.html)
- [rustc_hir_analysis::collect](https://doc.rust-lang.org/nightly/nightly-rustc/rustc_hir_analysis/collect/index.html)
- [Clippy — needless_collect](https://rust-lang.github.io/rust-clippy/master/index.html#needless_collect)
