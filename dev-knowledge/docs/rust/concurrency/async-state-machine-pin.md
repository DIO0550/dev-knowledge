---
title: async fn のステートマシン変換と Pin が必要になる理由
tags: [rust, async, await, state-machine, pin, self-referential, unpin]
---

## TL;DR

- `async fn` はコンパイラによって**匿名のステートマシン構造体**に変換される。`.await` ごとに「中断ポイント」になる enum バリアントが作られる。
- `.await` を跨いでローカル変数への参照を保持すると、生成された構造体は**自己参照（self-referential）**になる。
- 自己参照構造体は**ムーブされるとポインタがダングリングする**。これを防ぐために `Pin<&mut Self>` を `poll` の受け取り型に強制している。
- ほぼ全ての普通の型は `Unpin` で、Pin の中でも動かせる。動かせないのは `async fn` 由来のステートマシンなど一部だけ。

## このドキュメントの射程

「`Pin` という型がなぜ存在するのか」を、async/await の表面構文ではなく**コンパイラが生成する中間表現**から理解するための知見。`poll` のシグネチャが `self: Pin<&mut Self>` になっている理由がここに集約される。

## 原因 ― async fn は実は enum を生成している

次のような単純な async fn を考える。

```rust
async fn fetch_and_save(url: &str) -> Result<(), Error> {
    let body = http_get(url).await?;        // 中断ポイント ①
    let path = format_path(url);
    write_file(&path, &body).await?;        // 中断ポイント ②
    Ok(())
}
```

コンパイラはこれを、各 `.await` で状態を区切った enum へ概念的に書き換える。

```rust
// 概念図（実際には匿名・名前なし）
enum FetchAndSaveState<'a> {
    Start { url: &'a str },
    AwaitingGet {
        url: &'a str,
        fut: HttpGetFut<'a>,          // 待っている内側の Future
    },
    AwaitingWrite {
        body: Vec,
        path: String,
        fut: WriteFileFut,
    },
    Done,
}
```

各バリアントは「その時点で生存しているローカル変数」と「待機中の内側の Future」をフィールドとして持つ。`poll` が呼ばれるたびに、内側の `fut` を `poll` し、`Ready` になったら次のバリアントへ遷移する ― これがステートマシンの実体。

### 自己参照が生まれる瞬間

問題は、`.await` を跨いでローカル変数への参照を保持するケースだ。

```rust
async fn example() {
    let data = vec![1u8, 2, 3];
    let slice = &data[..];              // data を借りる
    some_future(slice).await;           // ← 中断ポイント（slice を跨ぐ）
    println!("{:?}", slice);
}
```

生成される構造体は `data` と `slice` の**両方**を同じバリアント内に持つ。`slice` は `data` のメモリ位置を指すポインタ ― つまり**構造体が自分自身の内部を指している**。

```
[ data: Vec @ 0x100 ][ slice: &[u8] → 0x100 ]
         ↑___________________________↓ 自己参照
```

もしこの構造体がメモリ上でムーブされて別アドレス（例: `0x200`）に移ると、`data` のバイト列は新アドレスへコピーされるが、`slice` の中のポインタは**`0x100` を指したまま**になる。これはダングリングポインタであり、Rust の安全性が崩壊する。

```
ムーブ後:
[ data: Vec @ 0x200 ][ slice: &[u8] → 0x100 ]  ← 0x100 はもう無効
```

## 解決 ― Pin で「動かせない」ことを型で保証する

そこで Rust は `Pin<P>` を導入した。`Pin<&mut T>` は「**この参照を経由している間、T はメモリ上で動かないことを約束する**」というラッパ。`Future::poll` のシグネチャを `self: Pin<&mut Self>` にすることで、「ステートマシンが poll されるときには既にピン留めされている」とランタイム側に要求している。

### Unpin が「動かしてもOK」の例外マーカー

すべての型を動かせなくしてしまうと、`i32` や `String` のような自己参照を持たない型まで Pin の制約に縛られて困る。そこでマーカートレイト `Unpin` が用意されている。

- `Unpin` を実装している型は、`Pin` の中でも自由にムーブできる（Pin の意味がない）。
- ほとんどの型は **auto trait** として自動的に `Unpin` を実装する。
- 自己参照を含み得る型（`async` ブロック由来のステートマシン、`Generator` など）だけが `!Unpin` になる。

```rust
// String は Unpin。Pin に包んでも普通に動く
let mut s = Box::pin(String::from("hello"));
*s = String::from("world");   // ← OK（Unpin なのでムーブ可能）

// async ブロック由来の Future は !Unpin の可能性。
// Pin したら原則動かせない（中の自己参照を守るため）
let mut fut = Box::pin(async { /* 自己参照を含むかも */ });
// *fut = ...; ← ❌ コンパイルエラー
```

### Pin はあくまで「契約」、力ずくの保護ではない

`Pin` は型システム上の契約であって、メモリ管理のハードウェア機構ではない。安全な Rust の範囲では、`Pin<&mut T>` から `&mut T` を取り出して `mem::replace` するような抜け道が塞がれている、というだけ。`unsafe` を使えば破れるが、その瞬間に契約違反になり未定義動作になる。

## まとめ

`async fn` → コンパイラが enum ステートマシンへ変換 → `.await` 跨ぎの借用で自己参照が生まれる → ムーブされたら死ぬ → Pin でメモリ位置を固定する型契約を導入、という一連の因果連鎖が `Pin<&mut Self>` の正体。`Unpin` でないのは特殊な型だけ、と覚えておけば普段は怖がる必要はない。

## 参考

- [`std::pin` ― Rust Standard Library](https://doc.rust-lang.org/std/pin/)
- [`std::marker::Unpin` ― Rust Standard Library](https://doc.rust-lang.org/std/marker/trait.Unpin.html)
- [Async Book ― Pinning](https://rust-lang.github.io/async-book/04_pinning/01_chapter.html)
- [RFC 2349: Pin](https://rust-lang.github.io/rfcs/2349-pin.html)
- [RFC 2394: async/await](https://rust-lang.github.io/rfcs/2394-async_await.html)
