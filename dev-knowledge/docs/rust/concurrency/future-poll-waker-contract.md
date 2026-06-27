---
title: Future::poll の契約 ― Pending を返すときに Waker を登録する暗黙のルール
tags: [rust, async, future, poll, waker, tokio]
---

## TL;DR

- `Future::poll` は `Poll::Ready(T)` か `Poll::Pending` を返す1メソッドの契約。
- **`Pending` を返すときは、引数 `Context` から取り出した `Waker` を I/O ドライバなどに登録する**ことが暗黙の義務。
- Waker が登録されていない `Pending` は「永久に再開されないタスク」になる ― バグとして気付きづらい。
- ランタイムは `Pending` を返したタスクを休眠させ、`waker.wake()` が呼ばれて初めて再 poll する。**ビジーループではない**。

## このドキュメントの射程

`async`/`await` を使う側ではなく、`Future` を**手で実装する側**または**ランタイムの挙動を理解したい側**の知識。`tokio::time::sleep` のようなライブラリ提供の Future を `.await` するだけなら、この契約を意識せずに済む。ただし、自前で `impl Future` を書くとき、あるいは「なぜ Pending を返すタスクが CPU を食わないのか」を腹落ちさせたいときに必須。

## 原因 ― poll の契約は実は2つある

`std::future::Future` トレイトの定義はシンプルだ。

```rust
pub trait Future {
    type Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>;
}

pub enum Poll<T> {
    Ready(T),
    Pending,
}
```

型シグネチャだけ見ると `Pending` を返せば終わりに思える。しかし**実行モデル上の契約**は型では表現されない。それは以下の通り:

1. **`Ready(v)` を返したら、二度と poll してはならない**（呼ぶ側の責務）。
2. **`Pending` を返すときは、再開する準備（= Waker 登録）を済ませてからにする**（実装側の責務）。

ランタイムは `Pending` を返したタスクを「キューから外して休眠」させる。再び poll キューに戻すトリガは、登録された `Waker` の `wake()` が呼ばれること**だけ**である。だから Waker を登録せずに `Pending` を返した Future は、永遠に再開されない。

```rust
// ❌ 壊れた実装: Waker を登録せずに Pending を返す
impl Future for MyFut {
    type Output = ();
    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<()> {
        if self.is_ready() {
            Poll::Ready(())
        } else {
            Poll::Pending   // ← Waker を保存していない。永久に poll されない
        }
    }
}
```

## 解決 ― 「進められない理由」を保持する側に Waker を渡す

正しい実装では、「進められない原因」になっている側（チャネルの受信側、I/O ドライバ、タイマーなど）に Waker のクローンを渡してから `Pending` を返す。原因が解消されたタイミングで、その側が `waker.wake()` を呼んでくれる。

```rust
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

struct SharedState {
    completed: bool,
    waker: Option<Waker>,
}

struct MyFut {
    state: Arc<Mutex<SharedState>>,
}

impl Future for MyFut {
    type Output = ();
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let mut s = self.state.lock().unwrap();
        if s.completed {
            Poll::Ready(())
        } else {
            // ★ Pending を返す前に、最新の Waker を保存する
            s.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}

// 別スレッド／別タスクから呼ばれる「完了通知」側
fn complete(state: &Arc<Mutex<SharedState>>) {
    let mut s = state.lock().unwrap();
    s.completed = true;
    if let Some(w) = s.waker.take() {
        w.wake();   // ← これでランタイムがタスクを再 poll する
    }
}
```

### Waker は poll のたびに更新する

注意点として、**同じタスクでも `Context::waker()` から取れる Waker は poll の呼び出しごとに変わり得る**。タスクが別のワーカースレッドへ移動するなどの理由で、古い Waker は無効になることがある。よって `Pending` を返すたびに `waker = Some(cx.waker().clone())` で**上書きするのが正しい**。古い Waker を残し続けると、wake が空振りする可能性がある。

## まとめ

`Pending` を返すコードを書くなら、その同じ行までに `Waker` をどこかに保存していること。これが守られていれば、`Pending` のタスクは CPU を一切食わずに眠り続け、外部イベントだけで起きる ― これが「協調的マルチタスキング」の根っこの仕組み。

## 参考

- [`std::future::Future` ― Rust Standard Library](https://doc.rust-lang.org/std/future/trait.Future.html)
- [`std::task::Waker` ― Rust Standard Library](https://doc.rust-lang.org/std/task/struct.Waker.html)
- [Async Book ― Under the Hood: Executing Futures and Tasks](https://rust-lang.github.io/async-book/02_execution/02_future.html)
- [Tokio Tutorial ― Async in depth](https://tokio.rs/tokio/tutorial/async)
