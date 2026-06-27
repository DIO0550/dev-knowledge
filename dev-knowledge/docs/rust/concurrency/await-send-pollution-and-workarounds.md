---
title: .await を跨いで Send を汚染する型と回避パターン
tags: [rust, async, send, sync, tokio, spawn, rc, mutex-guard]
---

## TL;DR

- `async fn` が生成するステートマシンの `Send` 性は、**`.await` を跨いで生存するローカル変数の型**で決まる。
- `Rc` や `RefCell` を `.await` の前後で使うと、ステートマシン全体が `!Send` になり `tokio::spawn` に渡せない。
- 解決策は2つ: ①`Arc` / `tokio::sync::Mutex` などの `Send` な型に置き換える、②`.await` の前にスコープで囲ってドロップする。
- `std::sync::MutexGuard` を `.await` を跨いで保持するのは、Send 問題に加えて**スレッド移動によるロック誤動作**の温床になる。

## 遭遇した問題

マルチスレッドランタイム（`tokio::spawn` など）にタスクを投げたら、次のようなエラーが出た。

```text
error: future cannot be sent between threads safely
   |
   |     tokio::spawn(task());
   |                  ^^^^^^ future returned by `task` is not `Send`
   |
note: future is not `Send` as this value is used across an await
   |
   |     let rc = Rc::new(42);
   |         -- has type `Rc` which is not `Send`
   |     some_io().await;
   |               ^^^^^ await occurs here, with `rc` maybe used later
```

該当コード:

```rust
async fn task() {
    let rc = Rc::new(42);
    some_io().await;
    println!("{}", rc);
}

#[tokio::main]
async fn main() {
    tokio::spawn(task());   // ← !Send で蹴られる
}
```

環境: `tokio = "1"`（マルチスレッドランタイム既定）。

## 原因 ― ステートマシンに「.await を跨ぐ変数」が埋め込まれる

`async fn` はコンパイラによって enum ベースのステートマシンへ変換される。各バリアント（= 中断ポイント間の状態）は、**その時点で生存しているローカル変数**をフィールドとして保持する。

```rust
// 概念的に生成されるもの
enum TaskState {
    AwaitingIo {
        rc: Rc,        // ← Rc が状態に焼き込まれる
        fut: SomeIoFut,
    },
    Done,
}
```

`Rc` は内部の参照カウンタを非アトミックに操作するため `!Send`。フィールドに `!Send` な型を持つ構造体は、auto trait の伝播で構造体ごと `!Send` になる。よってステートマシン全体が `!Send` になり、`tokio::spawn` の `F: Send + 'static` 境界に合わなくなる。

**ポイント**: `Rc` を `.await` の**後**で使ったかどうかではない。コンパイラはフロー解析で「`.await` を跨いで `rc` が生存し得るか」を見ている。`drop(rc)` を `.await` の前に明示する、あるいは下のようにスコープで囲うことで、生存範囲を中断ポイントの前に閉じ込められる。

## 解決

### 解1: 型を `Send` なものに置き換える

そもそも別スレッドへ渡る可能性のあるタスクで `Rc` を使うのが間違い。`Arc` は同じインタフェースで `Send + Sync` を満たす。

```rust
async fn task() {
    let arc = Arc::new(42);
    some_io().await;
    println!("{}", arc);   // ✅ Arc は Send
}
```

| `.await` 跨ぎで NG | 同等の Send な代替 | 注意 |
|---|---|---|
| `Rc` | `Arc` | 原子的カウンタになる分わずかにコストあり |
| `RefCell` | `tokio::sync::Mutex` | 非同期対応の Mutex。lock も `.await` する |
| `Cell` | `AtomicXxx` / `Arc<Mutex>` | 値の種類による |
| `std::sync::MutexGuard` | （後述: スコープで閉じる） | 型を変えるより使い方を変える |

### 解2: スコープでドロップさせ、`.await` 前に手放す

たまたま `Rc` を一時的に使いたいだけなら、`.await` の前で生存を終わらせれば良い。

```rust
async fn task() {
    {
        let rc = Rc::new(42);
        println!("{}", rc);
    }                          // ← rc はここでドロップ
    some_io().await;           // 以降のステートに rc は含まれない
}                              // ✅ Send になる
```

ステートマシンの各バリアントは**生存している変数だけ**を持つので、`.await` の前にドロップさせれば中断ポイントを跨ぐ状態から消える。

### 落とし穴: `std::sync::MutexGuard` を跨いではいけない

`std::sync::MutexGuard` は `Send` であっても、`.await` を跨いで保持するのは設計上の地雷である。

```rust
// ❌ ロックを持ったまま .await する
async fn bad(m: &std::sync::Mutex) {
    let guard = m.lock().unwrap();
    some_io().await;            // ← この間ロックを保持し続けている
    *guard += 1;
}
```

タスクが `.await` で中断され、再開時に別のワーカースレッドに移ったとしよう。`std::sync::Mutex` は「ロックを取ったスレッドが解放する」を前提に作られている。スレッドをまたぐ動きが起きると未定義動作にはならないものの、デッドロックやロング・ホールド・タイムを誘発しやすい。さらに `.await` 中に他のタスクが同じロックを取ろうとして全員ブロック ― と、スループットが致命的に落ちる。

対処は2通り:

```rust
// ✅ ロックは短いスコープに閉じ、.await 前に手放す
async fn good1(m: &std::sync::Mutex) {
    {
        let mut guard = m.lock().unwrap();
        *guard += 1;
    }
    some_io().await;
}

// ✅ どうしても .await を跨ぎたいなら tokio::sync::Mutex に変える
async fn good2(m: &tokio::sync::Mutex) {
    let mut guard = m.lock().await;   // 非同期ロック
    some_io().await;                  // 跨いで保持してよい
    *guard += 1;
}
```

`tokio::sync::Mutex` はロック取得自体が `.await` で、待っている間スレッドを占有しない。代わりに通常の操作が少し重いので、`.await` を跨がない用途では `std::sync::Mutex` のままで良い。

## まとめ

`Send` エラーが出たら「`.await` を跨いで生きている `!Send` の型は何か」を最初に疑う。`Rc` → `Arc`、`RefCell` → `tokio::sync::Mutex` という置換、または**スコープで囲ってドロップを早める**のが基本対処。`MutexGuard` の `.await` 跨ぎは別の地雷 ― 必ずスコープに閉じるか、async 用 Mutex を使う。

## 参考

- [`std::marker::Send` ― Rust Standard Library](https://doc.rust-lang.org/std/marker/trait.Send.html)
- [Tokio Tutorial ― Shared state](https://tokio.rs/tokio/tutorial/shared-state)
- [`tokio::sync::Mutex`](https://docs.rs/tokio/latest/tokio/sync/struct.Mutex.html)
- [Async Book ― `Send` Approximation](https://rust-lang.github.io/async-book/07_workarounds/03_send_approximation.html)
