---
title: Rust で Mutex のロック範囲を狭めるためのブロックスコープは正しいか
tags: [rust, concurrency, mutex, mutexguard, raii, drop, deadlock, async, await, tokio, clippy, significant_drop_tightening, edition-2024]
---

## TL;DR

- **結論: ブロックスコープ `{ ... }` でロック範囲を狭めるのは「邪道」ではなく、公式（std / The Book / tokio）がそろって示す慣用的（idiomatic）なパターン**。
- 仕組みは RAII + `Drop`。`MutexGuard` はスコープを抜けると `Drop` され、そこで初めてロックが解放される。手動 `unlock()` API は存在せず、解放忘れが型システム上起き得ない。
- ブロックで狭める動機は主に 3 つ: **ロック競合（contention）削減 / デッドロック回避 / `.await` をまたいでロックを持たない（`Send` 制約）**。
- 範囲を狭める手段はブロックだけではない。**①ブロック ②明示 `drop(guard)` ③関数抽出（ガードでなく所有値を返す）④値だけ clone して即手放す**、を場面で使い分ける。
- 注意点: `match` / `if let` の被検査式（scrutinee）で直接 `lock()` すると、ガードが式全体の末尾まで生き、**ロックを握りっぱなしで自己デッドロック**しうる。Rust 2024 で `if let` は改善されたが `match` / `while let` は依然要注意。

## このドキュメントの射程

```rust
fn a() {
    // ...処理（ロック不要）
    {
        let mut b = shared.lock().unwrap();
        // ...ロックが必要な処理
    } // ← ここでガードが drop され、ロックが解放される
    // ...処理（ロック不要）
}
```

この「ロック保持区間を縮めるためだけにブロックを足す」書き方が、Rust コミュニティ的に正しいのか・他に手段はないのか、を公式情報ベースで整理する。

## 前提: ロックは「ガードのスコープが尽きるまで」保持される

`Mutex::lock()` が返すのは値ではなく RAII ガード `MutexGuard` で、これが `Drop` されたときに初めてロックが解放される。std 公式が明記している。

> "An RAII guard is returned to allow scoped unlock of the lock. **When the guard goes out of scope, the mutex will be unlocked.**"
> — std::sync::Mutex

The Book も同様に、「ロック解放はスコープ末尾で自動的に起こる＝解放を忘れようがない」と説明する。Rust には `unlock()` のような明示 API が無く、ロック解放は drop に一本化されている。

> "the type also has a `Drop` implementation that releases the lock automatically when a `MutexGuard` goes out of scope ... we don't risk forgetting to release the lock."
> — The Book ch.16-03

したがって**「ロック範囲を狭める」＝「ガードを早く drop させる」**であり、ブロックはそのための最も素直な手段の一つ、という位置づけになる。

## ブロックスコープは公式が示す慣用パターン

3 つの公式ソースがいずれもブロックの例を載せている。

The Book は端的なブロック例を示す。

```rust
let m = Mutex::new(5);
{
    let mut num = m.lock().unwrap();
    *num = 6;
} // ← MutexGuard が drop され、ロックが解放される
println!("m = {m:?}");
```

std は「ブロックでロックガードの寿命を限定する」例を、クリティカルセクションの早期終了として推奨している。

```rust
let result = {
    let mut data = data_mutex.lock().unwrap();
    let result = data.iter().fold(0, |acc, x| acc + x * 2);
    data.push(result);
    result
    // The mutex guard gets dropped here.（公式コメント）
};
```

> "Here we use a block to limit the lifetime of the lock guard."
> — std::sync::Mutex

つまりブロックで囲むのは**公認の書き方**であって、何ら奇異なことではない。

## なぜ狭めるのか（動機）

### 1. ロック競合の削減
保持時間を必要最小限に抑えれば、同じ mutex を待つ他スレッドの待ち時間が減る。std がこの区間を「クリティカルセクション」と呼んで最小化を促している。

### 2. デッドロック回避
std は、別スレッドの `.join()` を待つ前にロックを解放しないとデッドロックする例を挙げ、その解決として内部ブロックや `drop()` を使っている。

### 3. `.await` をまたいでロックを持たない（最重要・async）
`std::sync::MutexGuard` は `!Send`。これを `.await` をまたいで保持すると future 全体が `Send` でなくなり、`tokio::spawn`（タスクがスレッド間を移動しうる）でコンパイルエラーになる。tokio 公式の推奨形がまさにブロックである。

```rust
async fn increment_and_do_stuff(mutex: &Mutex<i32>) {
    {
        let mut lock = mutex.lock().unwrap();
        *lock += 1;
    } // ← ここで lock が drop される

    do_something_async().await; // ロック非保持で await
}
```

**注意: ここでは `drop(lock)` ではなくブロックが必要。** tokio は、コンパイラの future の `Send` 判定が「スコープ情報のみ」に基づくため、明示 `drop()` では `Send` 解析が解放を認識しないことがある、と警告している。await をまたぐケースは `drop()` よりブロックが確実。

> "the compiler currently calculates whether a future is `Send` based on scope information only."
> — tokio tutorial: Shared state

なお、ロックを await 全体で持ちたい正当な理由があるなら、guard が `Send` な `tokio::sync::Mutex` を使う、という設計上の選択肢もある。

## ブロック以外の手段と使い分け

ロック範囲を狭める手段はブロックだけではない。場面で選ぶ。

| 手段 | 向く場面 | 注意点 |
|---|---|---|
| (a) ブロック `{ let g = ...; }` | ロック下で複数ステップ（読み→計算→書き戻し）。区間を視覚的に区切りたい | ネストが 1 段深くなる。ブロックを長くすると結局保持が伸びる |
| (b) 明示 `drop(guard)` | フラットなまま特定行以降で手放したい。解放の意図を明示したい | 後続コード追加で解放位置がずれやすい。**await をまたぐ判定には効かないことがある** |
| (c) 関数に切り出す | クリティカルセクションに名前を付けたい／再利用したい | **ガードや `&mut T` を返すと逆に保持が延びる**。返すのは所有値に限る |
| (d) 値だけ取り出して即手放す | 単一値を一瞬読む／書くだけ | `clone()` コスト。取得値はスナップショット。read-modify-write を 2 回に割ると TOCTOU |

```rust
// (d) ガードは式末尾で drop される一時値。保持は実質この 1 行だけ
let snapshot = m.lock().unwrap().clone();
// 書き込みも同様に 1 文で使い切れる
*counter.lock().unwrap() += 1;
```

指針: **単一値の読み書きなら (d) が最短で最良。複数ステップなら (a)。フラットさを保ちたい／async なら (b)。意味的にまとまり命名したいなら (c)（ただしガードを返さない）。** std はブロックと明示 drop の両方を「正しいやり方」として併記しており、どちらか一方だけが正解という立場は取っていない。

## 落とし穴: `match` / `if let` の scrutinee で `lock()` する

被検査式（scrutinee）が生んだ一時ガードは、**そのアーム本体を含む式全体が終わるまで drop されない**。ロックを握ったまま match 全体を実行するため、アーム内で同じロックを取ると自己デッドロックする。

```rust
// NG: ガードが match 全体で生きている → アーム内の再ロックでデッドロック
let result = match a_mutex.lock().unwrap().to_string().as_str() {
    "5" => {
        do_some_long_calculation(); // まだロック保持中
        // ここで a_mutex.lock() を呼ぶと自己デッドロック
        "five".to_owned()
    }
    _ => "other".to_owned(),
};
```

```rust
// OK: 先に値だけ取り出してガードを文末で drop。match 中はロック非保持
let unfenced = a_mutex.lock().unwrap().to_string();
let result = match unfenced.as_str() {
    "5" => "five".to_owned(),
    _ => "other".to_owned(),
};
```

### エディションによる差（重要）

- **Rust 2021 以前**: `if let` の scrutinee の一時値は `else` ブロックを含む式全体の末尾まで保持される。`if let Some(x) = *rwlock.read().unwrap()` の `else` 内で write ロックを取るとデッドロック。
- **Rust 2024（Rust 1.85〜）**: `if let` の一時値は then ブロック終了時・`else` 進入時に drop されるよう短縮された。移行 lint は `if_let_rescope`。
- **`match` / `while let` は未変更**: scrutinee の一時値は 2021 でも 2024 でも式全体の末尾まで保持される。**「if let は 2024 で改善されたが、match は依然として罠が残る」** と覚える。

## 関連する Clippy lint

- **`clippy::significant_drop_tightening`**（`nursery`・既定 allow）: ロックガードなど「drop に意味がある型」が、もっと早く drop できるのにスコープ末尾まで保持されている箇所を検出し、**値だけ取り出して早期解放するスタイル (d)** を提案する。ただしループでの再利用を壊す誤検知、手動 `drop()` を認識しない等の既知問題があり nursery 止まり。提案を鵜呑みにせず再利用やループを自分で確認するのが実務的合意。
- **`clippy::significant_drop_in_scrutinee`**（`nursery`・既定 allow）: 上記「match の scrutinee でガードを握る罠」を検出する。
- **`clippy::let_and_return`**（`pedantic`・既定 allow）: `let x = expr; x` を直接返却に直すよう促すが、`expr` がロックガードを生む場合は drop タイミングが変わるため、ロック絡みでは機械適用しない方がよい（clippy 自身もローカルに significant drop 型があると発火を抑制する）。
- 補足: `let _ = m.lock()` でガードを即 drop してしまう罠を検出する `clippy::let_underscore_lock` もある。

## まとめ

- ブロックでロック範囲を狭めるのは公式公認の慣用パターン。「これでいいのか」と心配する必要はない。
- ただしブロックは唯一解ではない。単一値なら値を取り出して即手放す (d)、フラットに解放したいなら `drop` (b)、命名したいなら関数抽出 (c) を使い分ける。
- 真に注意すべきは「ブロックを使うか」より「scrutinee でロックを握って式全体に保持が延びる」罠。`match` では値を先に取り出す。`if let` は 2024 で改善済み。

## 参考

- std::sync::Mutex（RAII / ブロックで寿命限定 / 明示 drop / 一時値）: https://doc.rust-lang.org/std/sync/struct.Mutex.html
- std::sync::MutexGuard（`Drop` でロック解放）: https://doc.rust-lang.org/std/sync/struct.MutexGuard.html
- The Book ch.16-03 Shared-State Concurrency: https://doc.rust-lang.org/book/ch16-03-shared-state.html
- tokio tutorial: Shared state（`!Send` ガード / await をまたがない / `drop()` ではなくブロック）: https://tokio.rs/tokio/tutorial/shared-state
- Rust 2024: `if let` temporary scope: https://doc.rust-lang.org/edition-guide/rust-2024/temporary-if-let-scope.html
- RFC 3606（tail expression temporary lifetimes）: https://rust-lang.github.io/rfcs/3606-temporary-lifetimes-in-tail-expressions.html
- Clippy lint 一覧: https://rust-lang.github.io/rust-clippy/master/index.html
- clippy `significant_drop_tightening` 実装: https://github.com/rust-lang/rust-clippy/blob/master/clippy_lints/src/significant_drop_tightening.rs
- 既知問題: https://github.com/rust-lang/rust-clippy/issues/12121 , https://github.com/rust-lang/rust-clippy/issues/13429
- 解説（コミュニティ）: https://fasterthanli.me/articles/a-rust-match-made-in-hell , https://dev.to/nsengupta/rust-notes-on-temporary-values-scope-of-mutexguard-and-match-expressions-3-4c85
