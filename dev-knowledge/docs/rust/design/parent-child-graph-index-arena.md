---
title: Rust で親子グラフを表すなら index ベース arena が基本 — Rc/RefCell を避ける理由
tags: [rust, graph, tree, arena, index, newtype, rc, refcell, weak, hashmap, btreemap, sort, dfs, stack-overflow, data-structure]
---

## TL;DR

- Rust で親子グラフを持つなら、まず **`Vec<Node>` + 型付き index（arena）**。`Rc<RefCell<Node>>` + `Weak` は「動くが割に合わない」。
- index が推奨される最大の理由は性能ではなく**借用チェッカとの相性**。「index だけでは変更できず `&mut self` が要る」ので、可変性の追跡・`Send`/`Sync`・反復中変更の静的禁止がすべて無料で付いてくる。
- 裸の `usize` ではなく **newtype**（`struct NodeId(usize)`）にする。rustc の `IndexVec` / `newtype_index!` は「間違った index 型はコンパイル時に落ちる」ことを明示的な目的に挙げている。
- **`Rc` の深い連鎖は、走査せず drop するだけでスタックオーバーフローする**（実測: debug ビルドで 10 万段）。しかも debug と release で閾値が違うので再現性の低いバグになる。
- `HashMap` の反復順は**実行ごとに変わる**（実測）。出力の安定性が要るなら `BTreeMap` にするか出力直前にソート。キーが連番 id なら `Vec<Vec<NodeId>>` が最速かつ決定的。
- 「同じ隣接情報を並び順違いで 2 本持つ」は避ける。`sort_by_key` が**安定ソート**なので、挿入順を保った 1 本 + 安定ソートで 2 本目の情報は復元できることが多い。
- 深い木では再帰 DFS ではなく明示スタックの反復 DFS。`#![recursion_limit]` は**コンパイル時**の話で実行時再帰とは無関係（よくある誤解）。

## このドキュメントの射程

- Rust で「各ノードが親への 1 本のリンクを持つ」データから木・グラフを組み立て、走査する場面の実装選択。
- 表現（arena / `Rc<RefCell>` / arena crate）、隣接リストのマップ型選択、並び順の持ち方、走査方法。
- 「親リンクのみ → 木」の変換が計算量的になぜ隣接リストなのか、という言語非依存の一般論は別記事（`algorithm/親リンクだけのデータから木を組むときの隣接リスト`）に分ける。

## 遭遇した問題

親リンクだけを持つノード集合から木を組む処理を Rust で書くとき、選択肢が多くて決め手がわからない。

- ノードの持ち方: `Vec` + index か、`Rc<RefCell<Node>>` + `Weak` か、arena crate か。
- 隣接リストのマップ型: `HashMap` か `BTreeMap` か `Vec<Vec<_>>` か。
- 同じ隣接情報を並び順違いで 2 種類持つ設計は妥当か。
- 走査は再帰 DFS でよいか。

## 原因（なぜ Rust では選択が難しくなるのか）

グラフは本質的に「複数の所有者」「循環」を持ちうる構造で、Rust の所有権モデルと最も相性が悪い。素直に参照で書こうとすると借用チェッカに阻まれ、`Rc<RefCell<T>>` に逃げると今度はコンパイル時の保証を実行時チェックに引き換えることになる。この緊張が選択肢の多さの正体。

## 解決

### 1. 表現: index ベース arena を既定にする

Rust コミュニティでこの主張の原典に近いのが Niko Matsakis の "Modeling graphs in Rust using vector indices"（2015）。挙げられている利点:

- **an index alone is not enough to mutate the graph: you must use one of the `&mut self` methods** — index だけでは変更できないので、グラフ全体の可変性を Rust が他のデータ構造と同じように追跡できる。
- **graphs implemented this way can easily be sent between threads and used in data-parallel code** — `Send` / `Sync` になりやすい。
- **statically prevented from modifying the graph while iterating over it** — 反復中の変更を静的に防げる。
- 構造がコンパクトで、ノードごとのアロケーションが不要。追加は償却 O(1)。

同記事は欠点も明示している。削除が難しく、フリーリストで再利用すると「dangling indices」（別物を指す古い index）が生じ、プレースホルダを残すとリークになる。要は「malloc/free の問題を再発明する」形になる。著者自身が「**作って捨てるだけのグラフでは理論上の問題にすぎないが、長寿命で頻繁に変更されるグラフでは実際的な問題になる**」と条件付けている点は重要で、無条件に「arena が常に正しい」とする根拠にはならない。

rustc 本体も同じ方針。`rustc_index::IndexVec` のドキュメントが型安全性の論拠を直接述べている。

> An `IndexVec` allows element access only via a specific associated index type, meaning that trying to use the wrong index type (possibly accessing an invalid element) **will fail at compile time**.
> It also documents what the index is indexing: in a `HashMap<usize, Something>` it's not immediately clear what the `usize` means, while a `HashMap<FieldIdx, Something>` makes it obvious.

つまり「裸の `usize` ではなく newtype を使え」は rustc の実践そのもの。

### 2. なぜ `Rc<RefCell<Node>>` を避けるのか

The Rust Book 15.6 が公式に紹介する形ではある。

```rust
struct Node {
    value: i32,
    parent: RefCell<Weak<Node>>,
    children: RefCell<Vec<Rc<Node>>>,
}
```

親を `Weak` にするのは循環参照によるリークを防ぐため（「the reference count of each item in the cycle will never reach 0」）。ただし "Learn Rust With Entirely Too Many Linked Lists" の第 4 章は、この形を扱う章の冒頭で **this chapter is basically a demonstration that this is a very bad idea** と明言している。理由:

- `RefCell` は借用規則を静的にではなく**実行時**に強制する。破れば panic してクラッシュする。
- `Ref` / `RefMut` はスコープを抜けるまで `RefCell` を借用したままなので、内部の借用がスコープ越しに漏れる。
- 同章の結論は「a nightmare to implement, leaks implementation details, and doesn't support several fundamental operations」。

**そして Rust 固有の最大の地雷が drop の再帰。** 深いポインタ連鎖は、走査しなくても drop するだけでスタックが溢れる。Box のデストラクタは中身を drop した「後で」メモリを解放するため末尾呼び出しにならない。

実測（rustc 1.94.1 / Linux / メインスレッド、`ulimit -s` = 8 MiB）:

| ケース | 10 万 | 20 万 | 100 万 |
|---|---|---|---|
| 反復 DFS（明示スタック） | OK | OK | OK（500 万でも OK） |
| 再帰 DFS（`-O`） | OK | **stack overflow** | stack overflow |
| 再帰 DFS（debug） | OK | **stack overflow** | stack overflow |
| `Rc` 連鎖の drop（`-O`） | OK | OK | **stack overflow** |
| `Rc` 連鎖の drop（debug） | **stack overflow** | stack overflow | stack overflow |

最後の 2 行が効く。**debug では 10 万段で落ち、release では 20 万段でも生き残る**ので、「開発中は落ちるが本番は通る／その逆」という再現性の低いバグになる。全ノードが単一の `Vec` にあり drop が線形ループになる index ベース arena では、原理的に起きない。

### 3. arena crate の選び分け — 分岐点は「削除が要るか」

| crate | ハンドル | 削除 | 特徴 |
|---|---|---|---|
| `typed-arena` | `&'arena T` | 不可 | 全オブジェクトが同じライフタイムを持つので**安全に循環を作れる**。arena ごと一括破棄 |
| `id-arena` | `Id<T>`（型付き ID） | **非対応** | 「does not support deletion, which makes its implementation simple and allocation fast」。削除が要るなら generational-arena を使えと明記 |
| `generational-arena` | index + generation | 対応 | 素の index は「obj1 が index i の obj2 を取りに行ったら obj3 が返る」ABA 問題を起こす。世代カウンタで検出 |
| `slotmap` | versioned key | 対応 | 各スロットが `(value, version)`。`SecondaryMap` で付随データをハッシュなし直接 index 管理。「Great for ... graph nodes」 |
| `indextree` | `NodeId` | 世代付き再利用 | 木専用。単一 `Vec` に全ノード。`RefCell` を排して通常の `&mut` にでき、`Vec` のようにスレッド間で送れる |
| `petgraph` | `NodeIndex` / `EdgeIndex` | `Graph` は削除で index がずれる | 汎用グラフアルゴリズム。index 安定性が要るなら `StableGraph`（ただし O(e') の削除コストと穴あき） |

一時的に組んで捨てるだけなら、crate を足さず自前の `Vec` + newtype で十分（このリポジトリの「新しいライブラリは基本入れない」方針とも整合する）。

### 4. 隣接リストのマップ型: `HashMap` の順序に注意

構築イディオムは `entry().or_default().push()`。`Vec` は `Default` を実装するのでそのまま書ける。ポイントは**ルックアップが 1 回で済む**こと（`contains_key` → `get_mut` の二度引きを避ける）。

問題は反復順。`HashMap` のドキュメントは全反復系メソッドに「in arbitrary order」と明記し、ハッシュは DoS 耐性のため**ランダムにシードされる**とある。

実測（同一バイナリを 3 回実行）:

```
hash : ["f", "a", "g", "e", "c", "d", "b", "h"]
hash : ["f", "h", "c", "a", "g", "b", "e", "d"]
hash : ["d", "g", "b", "e", "c", "f", "h", "a"]
btree: ["a", "b", "c", "d", "e", "f", "g", "h"]   <- 3回とも同じ
```

つまり `HashMap` を反復してログ・スナップショット・生成コード・ハッシュ値を出力すると、**実行するたびに出力が変わる**。テストの golden 比較や再現ビルドでは致命的。

- 出力の安定性が要る → `BTreeMap`（「produce their items in key order」）。計算量は O(log n) だが決定的。
- キーが 0..n の連番 `NodeId` → `HashMap` も `BTreeMap` も不要。`Vec<Vec<NodeId>>` が最速かつ決定的。マップが要るのはキーが疎な場合だけ。
- `HashMap` のまま出力する → 出力直前にキーをソートして安定化。

### 5. 「並び順違いの隣接リストを 2 本持つ」は避ける

| 方式 | 利点 | 欠点 |
|---|---|---|
| 都度ソート | 単一の真実源。同期ズレなし | 呼ばれるたび O(n log n) |
| 2 本持つ | 参照は O(1)。両順序が常に使える | 更新経路が 2 つ。片方だけ更新するバグ。メモリ 2 倍 |
| 1 本持ち + 必要時のみソート（メモ化可） | 単一の真実源を保ちつつコストも抑えられる | キャッシュ無効化のロジックが要る |

「single source of truth を保て」は Rust 固有ではなく一般的な設計原則だが、**Rust 側の技術的な後押しがある**。`sort_by_key` は安定ソートで、`sort_unstable_by_key` は不安定だが in-place。

| メソッド | 安定性 | アロケーション |
|---|---|---|
| `sort_by_key` | 安定 | しうる |
| `sort_unstable_by_key` | 不安定 | なし（in-place） |
| `sort_by_cached_key` | 安定 | する（キー計算が高価なとき有利） |

`sort_by_key` が安定であることは「1 本持ち + 必要時ソート」の裏付けになる。挿入順（＝ソース順）を保った 1 本があれば、別基準で `sort_by_key` した結果は「別基準 → 同着は元の挿入順」という決定的な順序になる。**2 本目が表現していた情報は安定ソートで復元できることが多い**。逆に `sort_unstable_by_key` を使うと同着要素の順序が実装依存になり再現性が壊れる（キーが一意なら安定性は無意味なのでこちらが有利）。

2 本持つ場合、両方を `pub` にすると不変条件を型で守れない。`&mut` で片方だけ触れる API を作った時点で同期ズレは避けられなくなる。1 本を private にして「ソート済みビューを返すメソッド」だけ公開するのが、Rust の可視性・借用と噛み合う。

### 6. 走査: 明示スタックの反復 DFS

`Vec` をスタックにして `while let Some(x) = stack.pop()` で回すのが定石（`Vec::pop` が LIFO）。子を `iter().rev()` で積むと訪問順が元の並びと一致する。行きがけ・帰りがけ両方が要るなら `enum Visit { Pre(NodeId), Post(NodeId) }` を積む。

再帰が実際に危ないことの最も強い証拠は rustc 自身の対処。`rustc_data_structures::stack::ensure_sufficient_stack` は:

> Grows the stack on demand to prevent stack overflow. Call this in strategic locations to "break up" recursive calls. E.g. almost any call to `visit_expr` or equivalent can benefit from this.

実装は `stacker::maybe_grow(RED_ZONE = 100KB, STACK_PER_RECURSION = 1MB, f)`。rustc は AST/HIR の再帰走査を反復に書き換える代わりに、スタックを動的に伸ばすという別解を採っている。

スタックサイズの前提も押さえておく。`std::thread` のドキュメントによれば spawn したスレッドの既定は Tier-1 プラットフォームで 2 MiB、そして **メインスレッドのスタックサイズは Rust の管轄外**（Linux では `ulimit -s`、通常 8 MiB）。「spawn したスレッドで再帰したら 2 MiB で溢れた」がよくある形。

**注意（よくある誤解）**: `#![recursion_limit = "256"]` は実行時の再帰深度とは無関係。Rust Reference によれば、これはマクロ展開・自動 deref・トレイト解決といった**コンパイル時**の再帰の上限（既定 128）。

### 7. まとめたコード例

rustc 1.94.1 でコンパイル・実行確認済み。

```rust
use std::collections::BTreeMap;

/// 裸の usize を避けるための newtype。誤った index の混入をコンパイル時に防ぐ。
/// rustc の newtype_index! と同じ発想。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct NodeId(usize);

#[derive(Debug)]
pub struct Node {
    pub name: String,
    /// 親。ルートは None。`Weak` も `RefCell` も要らない。
    pub parent: Option<NodeId>,
}

#[derive(Debug, Default)]
pub struct Arena {
    nodes: Vec<Node>,
}

impl Arena {
    /// 追加は償却 O(1)。返る `NodeId` が唯一のハンドル。
    pub fn push(&mut self, name: &str, parent: Option<NodeId>) -> NodeId {
        let id = NodeId(self.nodes.len());
        self.nodes.push(Node { name: name.to_owned(), parent });
        id
    }

    pub fn get(&self, id: NodeId) -> &Node {
        &self.nodes[id.0]
    }

    /// `NodeId` だけでは書き換えられず `&mut self` が要る = 借用チェッカが可変性を追える。
    pub fn get_mut(&mut self, id: NodeId) -> &mut Node {
        &mut self.nodes[id.0]
    }

    pub fn ids(&self) -> impl Iterator<Item = NodeId> + '_ {
        (0..self.nodes.len()).map(NodeId)
    }

    /// 親リンクから子リストを導出する。`entry().or_default().push()` が定番イディオム。
    /// `BTreeMap` にすると反復順が NodeId 昇順に決まり、出力が再現可能になる。
    pub fn children_map(&self) -> BTreeMap<NodeId, Vec<NodeId>> {
        let mut map: BTreeMap<NodeId, Vec<NodeId>> = BTreeMap::new();
        for id in self.ids() {
            if let Some(p) = self.get(id).parent {
                map.entry(p).or_default().push(id);
            }
        }
        map
    }

    /// 再帰ではなく明示スタックによる反復 DFS。深い木でもスタックオーバーフローしない。
    pub fn dfs(&self, root: NodeId, children: &BTreeMap<NodeId, Vec<NodeId>>) -> Vec<NodeId> {
        let mut out = Vec::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            out.push(id);
            if let Some(kids) = children.get(&id) {
                // Vec のスタックは LIFO なので、逆順に積むと訪問順が元の並びになる。
                stack.extend(kids.iter().rev().copied());
            }
        }
        out
    }
}
```

並び順が 2 種類欲しくなったら、2 本目を持つのではなく 1 本を安定ソートする:

```rust
// 2 本持つのではなく、必要な場所で 1 本をソートして使う。
// sort_by_key は stable なので、同キーの要素は元の（= NodeId 昇順の）並びが保たれる。
let mut by_name: Vec<NodeId> = children.get(&root).cloned().unwrap_or_default();
by_name.sort_by_key(|&id| arena.get(id).name.clone());
```

## まとめ

- Rust で親子グラフを持つなら `Vec<Node>` + newtype index が既定。`Rc<RefCell<Node>>` は公式にも紹介される形だが、実行時 panic・借用の漏れ・**drop だけでスタックが溢れる**という Rust 固有の地雷を抱える。
- 削除が要るかどうかが arena crate 選択の分岐点。削除不要なら自前 `Vec` か `id-arena`、要るなら `slotmap` / `generational-arena`。
- `HashMap` の反復順は実行ごとに変わる。出力の安定性が要るなら `BTreeMap` か出力直前のソート。連番 id なら `Vec<Vec<_>>`。
- 隣接情報を並び順違いで 2 本持つより、1 本 + 安定ソート。`sort_by_key` が安定であることがその技術的根拠。
- 深い木は反復 DFS。`#![recursion_limit]` はコンパイル時の話なので混同しない。

## 参考

- Niko Matsakis「Modeling graphs in Rust using vector indices」（index ベースの原典。利点と欠点の両方）: https://smallcultfollowing.com/babysteps/blog/2015/04/06/modeling-graphs-in-rust-using-vector-indices/
- Catherine West「My RustConf 2018 Closing Keynote」（世代付き index、`Rc<RefCell>` 回避）: https://kyren.github.io/2018/09/14/rustconf-talk.html
- rustc dev guide「Memory Management in Rustc」（arena allocation と interning）: https://rustc-dev-guide.rust-lang.org/memory.html
- `rustc_index::IndexVec`（型付き index がコンパイル時に誤用を弾く）: https://doc.rust-lang.org/beta/nightly-rustc/rustc_index/vec/struct.IndexVec.html
- `newtype_index!` マクロ: https://doc.rust-lang.org/stable/nightly-rustc/rustc_index/macro.newtype_index.html
- The Rust Book 15.6「Reference Cycles Can Leak Memory」（`Weak` による親リンク）: https://doc.rust-lang.org/book/ch15-06-reference-cycles.html
- 「Learn Rust With Entirely Too Many Linked Lists」第 4 章（`Rc<RefCell>` 批判）: https://rust-unofficial.github.io/too-many-lists/fourth.html
- 同 Drop の章（深い連鎖の drop が再帰する）: https://rust-unofficial.github.io/too-many-lists/first-drop.html
- `std::collections::HashMap`（反復順は arbitrary、ランダムシード）: https://doc.rust-lang.org/std/collections/struct.HashMap.html
- `std::collections::BTreeMap`（キー順で反復）: https://doc.rust-lang.org/std/collections/struct.BTreeMap.html
- `Entry::or_default`: https://doc.rust-lang.org/std/collections/hash_map/enum.Entry.html
- slice のソート（`sort_by_key` は安定、`sort_unstable_by_key` は in-place）: https://doc.rust-lang.org/std/primitive.slice.html
- `rustc_data_structures::stack::ensure_sufficient_stack`（rustc が `stacker` でスタックを伸ばしている）: https://doc.rust-lang.org/stable/nightly-rustc/rustc_data_structures/stack/fn.ensure_sufficient_stack.html
- `std::thread`（spawn したスレッドの既定スタックは 2 MiB、メインスレッドは対象外）: https://doc.rust-lang.org/std/thread/index.html
- Rust Reference「Limits」（`recursion_limit` はコンパイル時の再帰の上限）: https://doc.rust-lang.org/reference/attributes/limits.html
- arena crate: `typed-arena` https://docs.rs/typed-arena/latest/typed_arena/ ／ `id-arena` https://docs.rs/id-arena/latest/id_arena/ ／ `generational-arena` https://docs.rs/generational-arena/latest/generational_arena/ ／ `slotmap` https://docs.rs/slotmap/latest/slotmap/ ／ `indextree` https://docs.rs/indextree/latest/indextree/ ／ `petgraph` https://docs.rs/petgraph/latest/petgraph/

### 検証環境

- rustc 1.94.1 / Linux 6.18.5。コード例はコンパイル・実行確認済み。スタック深度と `HashMap` 反復順は同環境での実測（メインスレッド、`ulimit -s` = 8 MiB）。
