---
title: Box::pin(async move { ... }) の4つの役割 ― なぜこの1行で済むのか
tags: [rust, async, pin, box, dyn-future, trait-object, plugin-architecture]
---

## TL;DR

- `Box::pin(async move { ... })` という1行のイディオムには **4つの独立した役割**が同時に詰まっている。
- ① `async move { ... }` で匿名 Future を生成、② `Box` でヒープに置きサイズ不定(DST)を解消、③ `Pin` で位置固定し自己参照を保護、④ trait オブジェクト境界で `dyn Future` として型消去。
- AFIT / RPITIT が安定化した現代でも、**trait オブジェクト(`Box`)として格納したい文脈**では今もこの形が必要。
- 普通の `async fn` を `.await` するだけなら `Box::pin` は不要。要るのは「型を統一したいとき」(trait object, `Vec` に詰める, 再帰 async fn)。

## このドキュメントの射程

`trait` で非同期メソッドを定義し、その実装を `Box` のようにトレイトオブジェクトとして保持するアーキテクチャ(プラグイン管理、ハンドラ登録、ミドルウェアチェーンなど)で頻出するイディオムの分解。

## 原因 ― なぜそのまま `async fn` を trait に書けないことがあるのか

まず、現代の Rust では trait 内で直接 `async fn` を書くこと自体は可能になっている(AFIT: Async Fn In Trait)。

```rust
// AFIT: 通常の trait なら問題なく書ける
trait Plugin {
    async fn on_event(&self, ev: Event) -> Result<(), Error>;
}
```

しかし**これを `dyn Plugin` として持ちたい瞬間に壁にぶつかる**。AFIT は戻り型が impl ごとに違う匿名 Future になるため、現状そのままではオブジェクト安全(dyn-safe)ではない。

```rust
// ❌ dyn Plugin として保持できない
let plugins: Vec<Box<dyn Plugin>> = vec![...];
//                   ^^^^^^^^^^ async fn を持つ trait はオブジェクト安全でない
```

プラグイン管理のように**異なる実装を統一インタフェースで扱いたい**場面では、戻り型を**手動で型消去**してそろえる必要がある。これが `BoxFuture` パターンの存在理由。

```rust
type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

trait Plugin {
    fn on_event(&self, ev: Event) -> BoxFuture<'_, Result<(), Error>>;
}

impl Plugin for LoggerPlugin {
    fn on_event(&self, ev: Event) -> BoxFuture<'_, Result<(), Error>> {
        Box::pin(async move {
            log_to_disk(&ev).await?;
            Ok(())
        })
    }
}
```

このとき書く `Box::pin(async move { ... })` には4つの問題が同時に乗っている。

## 解決 ― 4役を1行に圧縮する仕組み

### ① `async move { ... }` ― 匿名 Future の生成

`async` ブロックは関数境界なしに、その場で `impl Future` を生成する。`move` を付けると外側の変数(ここでは引数 `ev`)を**所有権ごとキャプチャ**する。`move` が無いと参照キャプチャになり、関数戻り後にスコープが終わって参照が無効になる ― 戻り値として返す Future では `move` が事実上必須。

### ② `Box` ― ヒープに置いてサイズを確定させる

各 impl が生成する Future は**全部異なる匿名型**になる。`dyn Future` というトレイトオブジェクトでまとめたいが、`dyn Future` は **DST(Dynamically Sized Type)**でサイズ不定。値として直接スタックに置けず、関数からそのまま返せない。

`Box::new` でヒープにアロケートすると、戻り値はポインタ＋メタデータ(fat pointer)として**サイズが固定**される。これで関数戻り値や `Vec` の要素にできるようになる。

### ③ `Pin` ― ヒープ上のメモリ位置を固定

`async` ブロック由来のステートマシンは、`.await` を跨いで内部参照を持ち得るため `!Unpin` の可能性がある。ヒープに置いただけでは、ヒープ上のオブジェクトを別の場所へムーブされる余地が残る。`Pin` で包むことで「この `Box` が指すヒープ上のアドレスから動かない」ことを型レベルで宣言する。

`Box::pin(x)` は `Pin::new(Box::new(x))` 相当の便利コンストラクタ。`Box` 越しのピン留めは、ヒープに置けばオブジェクトのアドレスは外から動かしようがないので安全に成立する。

### ④ `dyn Future + Send + 'a` ― 型消去

最後の `dyn Future` は、戻り型の位置で書く側の責任。`BoxFuture` 型エイリアスがこれを担う。`+ Send` は `tokio::spawn` で使うため、`'a` は引数の参照を Future がキャプチャするため。

```rust
type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
//                      ^^^     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                      ③      ④(dyn Future + 境界 + lifetime)
//                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                          ②(Box)
```

構築フローで見ると、内側から外側へ:

```
async move { ... }                   // ① 匿名 Future を作る
        ↓
Box::new(...)                        // ② ヒープへ。サイズ確定
        ↓
Pin::from(box)                       // ③ 位置固定。!Unpin な中身を守る
        ↓
as Pin<Box<dyn Future<Output = T>>>  // ④ 型消去。trait object 戻り型に合わせる
```

## いつ `Box::pin` が要らないか

`Box::pin` が必要なのは**型を統一したいとき**だけ。次のケースでは不要。

- 普通の `async fn` を別の async から `.await` するだけ → コンパイラがすべて推論する。
- AFIT が使える場面で、trait オブジェクト化を必要としない → AFIT のまま書く。
- スタックに置いた Future を pin するだけで良い → `tokio::pin!` や `std::pin::pin!` マクロでスタックピンする方が軽い。

逆に必要なケース:

- `Vec<Box<dyn Future<Output = T>>>` のように動的なコレクションに詰める。
- `trait` の戻り型を統一して `Box` で受ける。
- 再帰 async fn(自分自身を `.await` する。サイズが無限になるため明示的にヒープ化が必須)。

## まとめ

`Box::pin(async move { ... })` は「**匿名 Future 生成・ヒープ化・位置固定・型消去**」の4役を1行で果たすイディオム。trait オブジェクトでプラグインを束ねたい場面では、AFIT が安定化した現代でも依然として主役。各役割を分解できれば、型エイリアス `BoxFuture<'a, T>` の中身を見ても怖くなくなる。

## 参考

- [`std::pin::Pin` ― `Pin::new` / `Box::pin`](https://doc.rust-lang.org/std/pin/struct.Pin.html)
- [Async Book ― Returning from async fn](https://rust-lang.github.io/async-book/07_workarounds/02_err_in_async_blocks.html)
- [Inside Rust Blog ― Async fn in trait](https://blog.rust-lang.org/inside-rust/2022/11/17/async-fn-in-trait-nightly.html)
- [`futures::future::BoxFuture` 型エイリアスの定義](https://docs.rs/futures/latest/futures/future/type.BoxFuture.html)
- [Rust Reference ― Object safety](https://doc.rust-lang.org/reference/items/traits.html#object-safety)
