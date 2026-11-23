---
title: indexmap を入れるか — 挿入順保持マップの標準ライブラリ代替と依存コストの評価
tags: [rust, indexmap, hashmap, dependency-management, cargo]
---

## TL;DR

- 標準ライブラリの `HashMap` は走査順が不定、`BTreeMap` はキー昇順（`Ord` 順）であり、どちらも**挿入順は保持しない**。
- **要素数が小さい・走査が主目的なら `Vec<(K, V)>` のみで十分**。一方、**参照 `O(1)` と順序維持を保った削除を両立したいなら `indexmap`** を選ぶ（自前の `Vec` ＋ `HashMap` は削除時の index 整合がバグの温床になりやすい）。
- 外部クレート追加の是非は感覚ではなく計測で決める。まず `cargo tree -i indexmap` で既に推移的依存（transitive dependency）に含まれていないかを確認するのが最も早い。

## 背景・射程

挿入順序を保持するマップが必要な場面で、`indexmap` クレートを導入するか、標準ライブラリだけで済ませるかの判断軸と、外部クレートの依存コストを定量評価する手順を整理する。

- 対象：`indexmap` 2.x 前提。
- 前提として、標準ライブラリの 2 つのマップは挿入順の代替にならない。
  - `std::collections::HashMap`：イテレーション順が**不定**（ハッシュと内部状態に依存し実行ごとに変わりうる）。
  - `std::collections::BTreeMap`：**キーの昇順**（`Ord` 順）でイテレートする。`1, 3, 2` の順で挿入しても `1, 2, 3` で返るため、挿入順は失われる。

## 判断軸・比較

### 標準ライブラリでの代替パターン

#### パターン A：`Vec<(K, V)>` のみ（線形探索）

最小構成。小規模なデータで挿入順の走査が主目的なら最有力になる。

```rust
struct VecMap<K, V> {
    items: Vec<(K, V)>,
}

impl<K: PartialEq, V> VecMap<K, V> {
    fn get(&self, key: &K) -> Option<&V> {
        // 線形探索: O(n)
        self.items.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    fn insert(&mut self, key: K, value: V) {
        // 既存キーは更新、なければ末尾追加で挿入順を保つ: O(n)
        if let Some(slot) = self.items.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = value;
        } else {
            self.items.push((key, value));
        }
    }
}
```

- **計算量**：`get` / `insert` とも `O(n)`。イテレーションは挿入順のまま。
- **向く場面**：要素数が小さい（数十〜数百程度）、ルックアップ頻度が低い、順序付き走査が主目的。
- **利点**：依存ゼロで実装が自明。小規模データではキャッシュ局所性が高く、`HashMap` より速いこともある（閾値はベンチマークで確認）。

#### パターン B：`Vec<(K, V)>` ＋ `HashMap<K, usize>`（`O(1)` 参照 ＋ 挿入順保持）

`indexmap` 相当を標準ライブラリだけで組む定番構成。

```rust
use std::collections::HashMap;
use std::hash::Hash;

struct OrderedMap<K, V> {
    order: Vec<(K, V)>,       // 挿入順にデータを保持
    index: HashMap<K, usize>, // key -> order 内の添字
}

impl<K: Eq + Hash + Clone, V> OrderedMap<K, V> {
    fn get(&self, key: &K) -> Option<&V> {
        let &i = self.index.get(key)?; // O(1)
        Some(&self.order[i].1)
    }

    fn insert(&mut self, key: K, value: V) {
        if let Some(&i) = self.index.get(&key) {
            self.order[i].1 = value; // 既存キーは値だけ更新
        } else {
            self.index.insert(key.clone(), self.order.len());
            self.order.push((key, value)); // 末尾追加で挿入順維持: 償却 O(1)
        }
    }
}
```

- 償却 `O(1)` の参照・挿入と挿入順イテレーションを両立できる。
- **キーの二重保持**（`index` と `order` の両方に `K` を持つ）が発生する。`indexmap` は内部構造で `K` を 1 回だけ保持してこれを回避している。
- **削除が最大の難所**：挿入と参照だけなら数十行で書けるが、削除・順序維持・index 整合を同時に満たそうとすると一気に複雑化する。
  - `Vec::swap_remove(pos)`：`O(1)` で削除できるが、(1) `index` から削除キーを消す、(2) 末尾から移動してきた要素の `index` を `pos` へ張り替える、の 2 手が必須。しかも**挿入順が崩れる**。
  - `Vec::remove(pos)`：後続をシフトするため挿入順は保たれるが `O(n)` になり、`pos` より後ろの全キーの `index` を -1 する再構築が要る。
  - tombstone（論理削除）：順序と `O(1)` 削除は保てるが、削除が積もるとメモリと走査コストが膨らみ定期的な compaction が必要になる。

### `indexmap`（2.x）との比較

`indexmap` は実質的なデファクトスタンダードであり、`serde_json` の `preserve_order` フィーチャも内部で `indexmap` を使用している（無効時は `BTreeMap` によるキー順）。主な特徴は次の通り。

- `O(1)` 平均のルックアップと挿入順イテレーションを、キーの二重保持なしで提供。
- 削除を 2 系統の API で明示的に分離（2.x では旧 `remove` は非推奨）：
  - `swap_remove`：`O(1)`、末尾と入れ替えるため**順序が崩れる**。
  - `shift_remove`：`O(n)`、後続をシフトして**挿入順を維持する**。
- インデックスアクセス（`get_index` 等）、スライスビュー、ソート、Entry API などが揃っており、デフォルトハッシャも標準と同じ `RandomState`（SipHash）。

| 状況 | 選択 |
|---|---|
| 要素数が小さい・参照が低頻度・主目的が挿入順の走査 | **`Vec<(K, V)>` で十分** |
| 削除がない・稀・末尾削除のみ | **`Vec<(K, V)>`（または自前 `OrderedMap`）で十分** |
| 要素数が大きく**キー参照が高頻度** | `indexmap` |
| **挿入順維持 ＋ 頻繁な削除**が同時に必要 | `indexmap`（自前は index ずれバグのリスクが高い） |
| インデックスアクセスやソート等の付加操作を使う | `indexmap` |

## 指針

### 採否のショートカット

「参照 `O(1)` が必須」かつ「削除しつつ順序維持が必要」の**両方**を満たすなら `indexmap` を入れる。どちらか一方だけ（特に要素数が小さい場合）なら標準ライブラリで足りることが多い。

### 依存コストの計測手順

クレート追加の是非は感覚ではなく、ベースライン測定 → 追加 → 再測定の差分で判断する。

1. **`cargo tree`**：依存ツリーと推移的依存を確認する。
   - `cargo tree -i indexmap`（逆依存）で他クレート経由ですでに導入済みかを確認する。すでに依存グラフに存在する場合、追加の実コストはほぼゼロになる。
   - `cargo tree --duplicate` で同一クレートの複数バージョン混在（例：`indexmap` 1.x と 2.x の同居）を検出する。
2. **`cargo build --timings`**：クレート単位のコンパイル時間を HTML で出力し、追加前後の差分を見る。
3. **`cargo bloat --release --crates`**：リリースバイナリへのサイズ寄与をクレート単位で測る（`cargo install cargo-bloat`）。
4. **`cargo-udeps`**（nightly）：宣言済みだが未使用の依存を検出する。

なお `indexmap` 2.x の必須依存は `equivalent` と `hashbrown`（標準 `HashMap` の実装本体）のみで、`serde` / `rayon` 等はデフォルト無効のオプショナル依存であるため、2.x のデフォルト構成自体は軽量。

### `indexmap` 1.x → 2.x のバージョン差異

- 2.0 で MSRV が引き上げられた（2.0.0 時点で Rust 1.63 以降、マイナーアップデートで随時引き上げ）。
- `remove` / `remove_entry` / `take` が 2.x で非推奨となり、順序への影響を明示する `swap_remove` 系・`shift_remove` 系へ置き換わった。1.x の旧 `remove` は `swap_remove` 相当（順序が崩れる）だったため、移行時は意図を確認して使い分ける。

## まとめ

- 挿入順の走査だけなら `Vec<(K, V)>`、`O(1)` 参照と順序維持削除の両立が必要なら `indexmap` を選ぶ。
- 依存コストの判断はまず `cargo tree -i indexmap` で既に依存グラフに入っているかを確認し、新規追加になる場合は `cargo build --timings` と `cargo bloat` で実測する。

## 参考

- [indexmap - Rust Documentation（docs.rs）](https://docs.rs/indexmap/latest/indexmap/)
- [indexmap RELEASES.md（GitHub）](https://github.com/indexmap-rs/indexmap/blob/main/RELEASES.md)
- [Compile Times | The Rust Performance Book](https://nnethercote.github.io/perf-book/compile-times.html)
- [Tips For Faster Rust Compile Times | corrode Rust Consulting](https://corrode.dev/blog/tips-for-faster-rust-compile-times/)
