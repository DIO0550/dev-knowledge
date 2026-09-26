---
title: indexmap を入れるか — 挿入順保持マップの標準ライブラリ代替と依存コストの評価
tags: [rust, dependency-management, indexmap, minimal-deps, hashmap, cargo]
---

## 問題

挿入順序を保持する `HashMap` が必要な場面で、`indexmap` クレートの導入が提案された。「不要な依存を増やさない」方針のもとで、標準ライブラリで代替できないか、入れるべきかを判断したい。

判断軸は「**本当にそれ（外部 crate）でないと解決できないか**」。

## 前提: 標準の 2 つのマップは挿入順を保持しない

- `std::collections::HashMap` はイテレーション順が**不定**（ハッシュ・内部状態依存で実行ごとに変わりうる）。
- `std::collections::BTreeMap` は**キーの昇順（`Ord` 順）**でイテレートする。これは「挿入順」ではない。`1, 3, 2` の順で insert しても `1, 2, 3` で返り、挿入順は失われる。キー順が欲しい場合のみ適切で、挿入順の代替にはならない。

## 標準ライブラリでの代替パターン

### パターン A: `Vec<(K, V)>` のみ（線形探索）

最小構成。小規模 N・挿入順イテレーションが主目的なら最有力。

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

- 計算量: get/insert とも **O(n)**。イテレーションは挿入順のまま。
- 向く場面: N が小さい（数十〜数百程度）、ルックアップ頻度が低い、順序付きで舐めるのが主目的。
- 利点: 依存ゼロ。小 N ではキャッシュ効率が良く `HashMap` より速いこともある（要ベンチ）。実装が自明。

### パターン B: `Vec<(K, V)>` + `HashMap<K, usize>`（O(1) ルックアップ + 挿入順保持）

`indexmap` 相当を自前で組む定番。

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
            self.order.push((key, value)); // 末尾追加で挿入順維持: O(1) 償却
        }
    }
}
```

- ルックアップ/挿入 O(1) 償却 + 挿入順イテレーションを両立。
- **キーの二重保持**（`index` と `order` の両方に K）が発生し、K のコピー/メモリが二重にかかる。`indexmap` は内部で K を 1 回だけ持つ構造でこれを回避している。

#### 削除が最大の難所

自前実装は削除で最も間違えやすい。ここが「自前で LinkedHashMap 相当をやるコスト」の正体。

- **`Vec::swap_remove(pos)`**: 末尾要素を穴へ移動して O(1) 削除できるが、(1) `index` から削除キーを消す、(2) **移動してきた末尾要素のキーの index を `pos` に張り替える**、の 2 ステップが必須。忘れると `index` が壊れる。しかも**挿入順が崩れる**。
- **`Vec::remove(pos)`**: 後続を全シフトするので**挿入順は保たれる**が O(n)。かつ pos より後ろの全キーの index を -1 する再構築が要る。
- **tombstone（論理削除）**: 物理削除せずマークするだけ。順序も O(1) 削除も保てるが、削除が積もるとメモリと走査コストが膨らみ、定期的な compaction（穴詰め＝index 再構築）が要る。実質「自前で indexmap を再発明」になりバグの温床。

→ 挿入・参照だけなら数十行で書けるが、**削除・順序維持・index 整合を同時に満たすと一気に複雑化**する。

## indexmap を入れる／入れない判断基準

`indexmap` が提供する価値（2.x）:

- **O(1) 平均のルックアップ + 挿入順イテレーション**を、K 二重保持なし・バグなしで提供。
- 削除の 2 系統を明示的に提供:
  - `swap_remove`: **O(1)**、末尾と入れ替えるので**順序が崩れる**。
  - `shift_remove`: **O(n)**、後続をシフトして**挿入順を維持**。
  - この使い分けを API で強制してくれるのが安全性上の利点（2.x では旧 `remove` は非推奨）。
- インデックスアクセス（`get_index` 等）、`Slice` ビュー、ソート、Entry API など自前だと面倒な操作が揃う。
- デフォルトハッシャは std と同じ `RandomState`（SipHash, HashDoS 耐性）。

判断:

| 状況 | 選択 |
|---|---|
| N が小さい / 参照が低頻度 / 主目的が挿入順の走査 | **Vec で十分**（入れない） |
| 削除がない・稀・末尾中心 | **Vec で十分** |
| N が大きく**キー参照が高頻度**（O(n) が効く） | indexmap |
| **挿入順維持 + 頻繁な削除**が同時に必要 | indexmap（自前は index ずれバグが現実的リスク） |
| インデックスアクセス/ソート等の付加操作を使う | indexmap |

- ショートカット: 「参照 O(1) 必須」かつ「削除しつつ順序維持」の**両方**が要るなら indexmap。どちらか一方だけ（特に小 N）なら std/Vec で足りることが多い。

公平な事実として、`indexmap` は実質デファクト。`serde_json` の `preserve_order` フィーチャは内部で `indexmap` を使い（無効時は `BTreeMap`＝キー順）、JSON のキー入力順を保持する。多くのクレートが transitive 依存で既に `indexmap` を引いていることも多く、その場合は追加の実コストがほぼゼロになる。

## 依存コストの評価方法

crate 追加の是非は感覚でなく計測で決める。手順:

1. **`cargo tree`** — 依存ツリーと transitive deps を可視化。
   - `cargo tree -i indexmap`（逆依存）で「既に他クレート経由で入っているか」を確認。既に居るなら追加コストは実質ゼロ。
   - `cargo tree --duplicate` で同一クレートの複数バージョン混在（例: indexmap 1.x と 2.x 同居）を検出。
2. **`cargo build --timings`** — クレート単位のコンパイル時間を HTML で出力。追加前後で差分を取る。
3. **`cargo bloat --release --crates`** — バイナリサイズへの寄与をクレート単位で測る（`cargo install cargo-bloat`）。
4. **`cargo-udeps`**（nightly）— 宣言したが未使用の依存を検出。

評価の型: **追加前にビルド時間・バイナリサイズをベースライン測定 → 追加 → 同条件で再測定して差分**。まず `cargo tree -i` で「そもそも新規追加になるのか」を確認するのが費用対効果が高い。

`indexmap` 2.x 自体の依存は軽量: 必須依存は `equivalent`（極小）と `hashbrown`（std の HashMap 実装本体）のみ。`serde` / `rayon` 等は optional でデフォルト無効。「重い crate だから避ける」は少なくとも 2.x デフォルト構成では当たらない（実測で確認）。

## バージョン差異（1.x → 2.x）

- 2.0 で MSRV が 1.64 に引き上げ（最新系はさらに新しい）。
- **削除メソッドの非推奨化**: `remove` / `remove_entry` / `take` が 2.x で非推奨になり、順序への影響を明示する `swap_remove` 系・`shift_remove` 系に置き換わった。**コード例は 2.x 前提で `swap_remove` / `shift_remove` を使う**。1.x の旧 `remove` は `swap_remove` 相当（順序が崩れる）なので移植時に注意。

## まとめ・参考

- 一行まとめ: 「**挿入順の走査だけなら `Vec`、参照 O(1) と順序維持削除の両立が要るなら `indexmap`**」。判断は `cargo tree -i` で「既に依存グラフに居るか」を最初に見るのが早い。
- 参考（2026-07 時点、indexmap 2.x）:
  - IndexMap ドキュメント / crate メタデータ（メソッドと計算量・依存・MSRV）: docs.rs `indexmap` / `docs.rs/crate/indexmap/latest`。
  - indexmap `RELEASES.md`（1.x→2.x 変更点、削除メソッド非推奨）。
  - `serde_json` の `preserve_order` フィーチャ（lib.rs / serde-rs/json PR #885）。
  - コンパイル時間・サイズ計測: The Rust Performance Book "Compile Times"、corrode.dev "Tips For Faster Rust Compile Times"（`cargo tree --duplicate` / `cargo-bloat --time` / `cargo-udeps`）。
- 未検証: 本記事のコード片はコンパイル未確認（環境のネットワーク制約で rustup 取得不可）。`equivalent` 等の「厳密に依存ゼロか」、小 N で `Vec` が `HashMap` より速くなる閾値は手元での実測を推奨。
