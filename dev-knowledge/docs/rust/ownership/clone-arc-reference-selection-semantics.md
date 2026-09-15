---
title: Rust で Clone / Arc / 参照渡しを選ぶ軸はコストではなくセマンティクス
tags: [rust, ownership, arc, rc, clone, borrowing, performance, api-design, false-sharing]
---

## TL;DR

- 「Clone するくらいなら Arc」はコストの話としては方向が正しいが、判断軸としては一段ずれている。
- `&T` / `T::clone()` / `Arc<T>` は代替関係ではなく、それぞれ意味が違う。`clone` は独立した値、`Arc` は共有所有権（かつ不変）。
- `Arc` も無料ではない。アトミック操作は通常のメモリアクセスより高価で、高競合下では false sharing でさらに悪化する。
- 先に決めるのは「この値は共有したいのか、独立させたいのか」。コスト比較はその後。

## このドキュメントの射程

「`.clone()` を書きそうになったら `Arc` にすべきか、参照渡しにすべきか」という所有権モデルの選択を扱う。パフォーマンスチューニングではなく、API 設計・データ構造設計の判断軸が対象。

## 原因

3 つを「同じ目的に対するコスト違いの手段」と捉えると判断を誤る。実際には表現している意味が違う。

| | 意味 | 得られるもの |
|---|---|---|
| `&T` | 借用 | 所有権なし。呼び出し側の寿命に縛られる |
| `T::clone()` | 値の複製 | **独立した別の値**。以後お互いに影響しない |
| `Arc<T>` | 共有所有権 | **同じ実体**を複数箇所が見る。ただし不変 |

`.clone()` を `Arc` に置き換えると「コピーが減る」だけでなく「独立していた値が共有になる」。独立していてほしい値を `Arc` にすると設計バグになる。

### Arc が安いとも限らない

`std::sync::Arc` のドキュメントは、アトミック操作は通常のメモリアクセスより高価であり、スレッド間で共有しないなら `Rc<T>` を検討せよと明記している。

さらに高競合下では false sharing が効く。複数スレッドが `Arc` の参照カウントを increment すると、論理的に無関係でも同じキャッシュラインを奪い合い、MESI が cache line 単位で所有権を扱うため互いの L1/L2 を無効化し合う。低競合・シングルスレッドでは、スタックへのディープコピーのほうが `Arc` 共有より速いことすらある。

参考値として、サードパーティクレートのベンチマークでは `Arc::clone()` はシングルスレッドで約 3.88ns、マルチスレッドでは競合が大きいと報告されている（環境依存なので目安）。

小さい構造体を数回 clone する程度なら、素直に clone したほうが速く読みやすい。`Arc` が効くのは大きい不変データを read-heavy に共有するときである。

## 解決

### 判断順

1. 読むだけの関数引数 → `&T`
   （`&String` / `&Vec<T>` / `&PathBuf` ではなく `&str` / `&[T]` / `&Path`）
2. 所有権が要る → 所有型を受け取り、コピーの要否は呼び出し側に決めさせる
3. スレッド / async タスクをまたぐ、寿命が静的に決まらない共有 → `Arc`
4. シングルスレッドの共有 → `Rc`

2 は Rust API Guidelines の C-CALLER-CONTROL そのもの。所有権が必要なら所有権を受け取れ、借用してから内部で `clone()` するな。所有権が不要なら借用を受け取れ。「借りてから clone」はアロケーションコストを呼び出し側から隠すので最も避けたい。

```rust
// 悪い: アロケーションがシグネチャから見えない
fn set_name(&mut self, name: &str) {
    self.name = name.to_string();
}

// 良い: 呼び出し側が String を持っていれば move で済む（コスト 0）
fn set_name(&mut self, name: String) {
    self.name = name;
}
```

### 関数引数に `Arc<T>` を取らない

`Arc<T>: Deref<Target = T>` なので、所有権を保持しない関数は `&T` を受け取れば呼び出し側が `&arc` を渡せる。`Arc` かどうかを API から隠せて再利用性が上がる。

```rust
// 悪い: 呼び出し側が Arc を持っていることを強制する
fn render(config: &Arc<Config>) { /* ... */ }

// 良い: Arc でも Box でも生の値でも渡せる
fn render(config: &Config) { /* ... */ }
```

### 不変な共有データには `Arc<str>` / `Arc<[T]>`

同じ不変文字列を多数の箇所が持ち回るなら、`String` の clone より `Arc<str>` が安い。`String` の capacity フィールド分のメタデータも減る。

### 変更が稀なら Arc::make_mut（CoW）

他に参照があるときだけ内部データを clone する clone-on-write。内部可変性なしに変更できる。

```rust
let mut data = Arc::new(vec![1, 2, 3]);
Arc::make_mut(&mut data).push(4); // 共有されているときだけコピー
```

### Arc は外側に押し出す

rust-analyzer の作者 matklad の指摘。全フィールドが `Arc` の struct は code smell で、arc は外側に押し出し「struct of Arcs」ではなく「Arc of struct」にすべき。`Arc` や `Mutex` 自体が悪いのではなく、トップレベルにある少数の `Arc`/`Mutex` こそがアーキテクチャの要になる。至る所にばら撒くと、その中心的な状態管理が見えなくなる。

## まとめ

置き換えの問題ではなく、先に「共有か独立か」を決める。共有なら `Arc`（シングルスレッドなら `Rc`）、独立なら `Clone`、寿命が呼び出し側に閉じるなら参照。

## 参考

- [std::sync::Arc - Rust](https://doc.rust-lang.org/std/sync/struct.Arc.html)
- [Flexibility - Rust API Guidelines（C-CALLER-CONTROL）](https://rust-lang.github.io/api-guidelines/flexibility.html)
- [matklad のコメント（Lobsters: How to avoid lifetime annotations in Rust）](https://lobste.rs/s/u6xokl/how_avoid_lifetime_annotations_rust)
- [Arc - Rust By Example](https://rust-lang.github.io/rust-by-example/std/arc.html)
