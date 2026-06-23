---
title: ネストした関数呼び出しで &mut を渡すと borrow エラーになる理由 — 10パターン実験つき
tags: [rust, ownership, borrow-checker, mutable-reference, E0502, E0499, nested-call, argument-evaluation, NLL]
---

## TL;DR

- `outer(&x, inner(&mut x))` のように関数呼び出しをネストし、引数のどれかで `&mut x` を作ると `error[E0502]: cannot borrow x as mutable because it is also borrowed as immutable` が出ることがある。
- 原因は、引数評価が左から右に進む途中で作った借用（例: 第一引数の `&x`）が**外側 `outer` の呼び出しが終わるまで生き続ける**こと。そのあいだに別の引数で `&mut x` を作ろうとすると、`&mut` の排他ルールで衝突する。
- 同じ構造でも、`&` だけなら共存できるので通る。エラーは「`mut` だから」起きている。
- 直し方の基本は「**先に `&mut` 側を文として実行し、借用を握らない型（所有権ある値）に変換して変数に束ね、その後で `outer` を呼ぶ**」。
- ただし「変数に入れれば直る」は万能ではない。**`inner` が借用を返す型のままだと、変数に入れても借用は続く**。
- 以下、rustc 1.75 で実測した10パターンの結果つき。

## 遭遇した問題

`A(B(&mut x))` の形で関数をネストして呼んだら borrow 系のコンパイルエラーが出た。「内側の `B(...)` を抜けたら借用も消える」と思っていたのに、そうならなかった。一度変数に入れる形に書き換えたら直った…が、ケースによっては変数に入れても直らないことがある。

## 検証したパターン一覧

| # | コード（要約） | 結果 | 出たエラー |
|---|---|---|---|
| 1 | `inner: ()` / `outer(inner(&mut x), &x)` | ✅ 通る | — |
| 2 | `inner: ()` / `outer(inner(&mut x), &mut x)` | ✅ 通る | — |
| 3 | `inner -> &mut i32` / `outer(inner(&mut x), &x)` | ❌ NG | E0502 |
| 3-fix | case 3 を `let tmp = inner(&mut x); outer(tmp, &x);` | ❌ 直らない | E0502 |
| 4 | `v.push(*v.last().unwrap())` | ✅ 通る | — |
| 5 | `let last = v.last().unwrap(); v.push(*last);` | ✅ 通る | — |
| 6 | `let first = v.first().unwrap(); v.push(42); println!("{}", first);` | ❌ NG | E0502 |
| 7 | `v.push(*v.first().unwrap())` | ✅ 通る | — |
| 8 | `inner -> &mut i32` / `outer(&x, inner(&mut x))` | ❌ NG | E0502 |
| 8-fix | case 8 を `let a_ref = &x; let b_ref = inner(&mut x); outer(a_ref, b_ref);` | ❌ 直らない | E0502 |
| 9 | `inner -> i32`（所有権ある値）/ `outer(inner(&mut x), &x)` | ✅ 通る | — |
| 10 | `inner -> i32` / `outer(&x, inner(&mut x))` | ❌ NG | E0502 |
| 10-fix | case 10 を `let val = inner(&mut x); outer(&x, val);` | ✅ 通る | — |

ポイント:
- ❌になるのは「`inner` が借用を返す型」or「他の引数で同じ `x` を借りる」**どちらかが効いた**とき。
- ✅にする鍵は、`inner` の戻り値を **借用を握らない型** にしてから、文として実行して借用を切ること。

## 検証したパターン詳細

### Case 1: `inner` が `()`、第二引数は独立した `&x`

```rust
fn inner(_x: &mut i32) {}
fn outer(_a: (), _b: &i32) {}

let mut x = 0;
outer(inner(&mut x), &x); // ✅ 通る
```

`inner` は `()` を返すので、第一引数の評価が終わった時点で `&mut x` の借用は消える。続けて `&x` を作って OK。

### Case 2: `inner` が `()`、第二引数も `&mut x`

```rust
fn inner(_x: &mut i32) {}
fn outer(_a: (), _b: &mut i32) {}

let mut x = 0;
outer(inner(&mut x), &mut x); // ✅ 通る
```

これも通る。NLL のおかげで第一引数の `&mut x` が引数評価後に消え、第二引数で改めて `&mut x` を取れる。

### Case 3: `inner` が `&mut` を返す、第二引数で `&x`

```rust
fn inner(x: &mut i32) -> &mut i32 { x }
fn outer(_a: &mut i32, _b: &i32) {}

let mut x = 0;
outer(inner(&mut x), &x);
// ❌ error[E0502]: cannot borrow `x` as immutable because it is also borrowed as mutable
//   |     outer(inner(&mut x), &x);
//   |     -----       ------   ^^ immutable borrow occurs here
//   |     |           |
//   |     |           mutable borrow occurs here
//   |     mutable borrow later used by call
```

`inner(&mut x)` が `&mut i32` を返すため、`outer` の呼び出しが終わるまで `&mut x` の借用が続く。そのあいだに `&x` を作ろうとして衝突。

### Case 3-fix-attempt: 変数に入れても直らない

```rust
let tmp = inner(&mut x); // tmp は &mut i32。借用を握ったまま
outer(tmp, &x);
// ❌ E0502。tmp が &mut を握り続けているので &x と衝突
```

`tmp` の型が `&mut i32` のままなので、変数に束ねても借用は続く。**「変数に入れれば直る」が成立しない例**。

### Case 4: `v.push(*v.last().unwrap())`

```rust
let mut v = vec![1, 2, 3];
v.push(*v.last().unwrap()); // ✅ 通る
```

`*v.last().unwrap()` で値が `i32` にコピーされた時点で `&v` の借用は終わる。続けて `&mut v` を取って `push` できる。

### Case 5: 参照を変数に入れてから push（コピー型）

```rust
let mut v: Vec<i32> = vec![1, 2, 3];
let last = v.last().unwrap();
v.push(*last); // ✅ 通る
```

`*last` を評価した時点で `last` の借用は使い切られ、`&mut v` を取れる。NLL の活躍例。

### Case 6: 借用を後で使うとアウト

```rust
let mut v: Vec<i32> = vec![1, 2, 3];
let first = v.first().unwrap();
v.push(42);
println!("{}", first);
// ❌ error[E0502]: cannot borrow `v` as mutable because it is also borrowed as immutable
//   first が println! で使われるので、push までその借用が生きてしまう
```

`first` を後で使うため、`&v` の借用が `println!` まで生き残る。その間に `&mut v` を取ろうとして衝突。これは「ネスト」ではないが、関連パターン。

### Case 7: メソッドチェーンでネスト

```rust
let mut v: Vec<i32> = vec![1, 2, 3];
v.push(*v.first().unwrap()); // ✅ 通る
```

`v.push(...)` のレシーバ `&mut v` を取るのは**引数評価の後**。だから `*v.first().unwrap()` で `&v` を作って `i32` にコピーするまで `&mut v` は取らない。順序的に衝突しない。

### Case 8: 第二引数で `inner`、`inner` が `&mut` を返す

```rust
fn inner(x: &mut i32) -> &mut i32 { x }
fn outer(_a: &i32, _b: &mut i32) {}

let mut x = 0;
outer(&x, inner(&mut x));
// ❌ error[E0502]
//   |     outer(&x, inner(&mut x));
//   |     ----- --        ^^^^^^ mutable borrow occurs here
//   |     |     |
//   |     |     immutable borrow occurs here
//   |     immutable borrow later used by call
```

第一引数で作った `&x` が `outer` の呼び出しまで生きる。第二引数で `&mut x` を作ろうとして衝突。

### Case 8-fix: 順序を入れ替えても直らない

```rust
let a_ref = &x;
let b_ref = inner(&mut x); // ここで &x がまだ生きている → ❌
outer(a_ref, b_ref);
```

逆順でも結果は同じ。両方の借用が `outer` まで生きるなら、どちらの順でも衝突は避けられない。

### Case 9: `inner` が所有権ある値を返す、第二引数で `&x`

```rust
fn inner(x: &mut i32) -> i32 { *x += 1; *x }
fn outer(_a: i32, _b: &i32) {}

let mut x = 0;
outer(inner(&mut x), &x); // ✅ 通る
```

`inner` が `i32`（所有権ある値）を返すので、第一引数の評価後に `&mut x` の借用は消える。続けて `&x` を作って OK。

### Case 10: 同じ `inner` を第二引数に置くとエラー

```rust
fn inner(x: &mut i32) -> i32 { *x += 1; *x }
fn outer(_a: &i32, _b: i32) {}

let mut x = 0;
outer(&x, inner(&mut x));
// ❌ error[E0502]
//   |     outer(&x, inner(&mut x));
//   |     ----- --        ^^^^^^ mutable borrow occurs here
//   |     |     |
//   |     |     immutable borrow occurs here
//   |     immutable borrow later used by call
```

`inner` の戻り値が借用を握らなくても、第一引数で先に `&x` を作っていれば、第二引数の `&mut x` と衝突する。**ネストの位置が変わるだけでエラーになる/ならないが反転する。**

### Case 10-fix: 変数に入れて直す（本命）

```rust
let val = inner(&mut x); // &mut x はこの文で使い切られて終わり
outer(&x, val);          // 改めて &x を作る
// ✅ 通る
```

`inner` を先に文として実行し、`&mut x` の借用をこの文の中で完結させる。`val` は所有権ある `i32` なので借用を握らない。続いて `&x` を取って OK。

## 原因

ふたつのルールが噛み合っている。

**ルール1: `&mut` の排他性。** ある値に有効な `&mut` が1本あるあいだ、その値への他の `&mut` や `&` を作れない。`&` は何本でも共存できる。これが「`mut` じゃなければエラーにならない」感覚の正体。

**ルール2: 引数として評価された借用は、関数呼び出しが終わるまで生き続ける。** Rust は関数引数を**左から右の順**に評価し、各引数の結果を一時的に保持してから関数を呼ぶ。その「一時的な保持」のあいだ、引数が握る借用は有効なまま。`outer(&x, inner(&mut x))` であれば、第一引数で作った `&x` は **`outer` が呼ばれ終わるまで生きる**。

この組み合わせで、`outer(&x, inner(&mut x))` は次のような順序で評価される。

```
1. &x を作る                       ← immutable borrow が始まる
2. inner(&mut x) を評価する        ← ここで &mut x を作ろうとする → ❌
3. outer(arg1, arg2) を呼ぶ
4. outer の呼び出しが終わる        ← ここまで immutable borrow が生きる
```

ステップ2の時点で `&x`（immutable borrow）がまだ生きている。そこに `&mut x` を作ろうとするので、`&mut` の排他ルールに違反する。エラー注記の `immutable borrow later used by call` は「immutable borrow が後で（call で）使われる」という意味。**「mutable が後で使われる」と読み違えないよう注意。**

「内側の `B(...)` を抜けたら借用が消える」と思っていたのに消えないのは、消えるのは内側で**作った**借用の話で、すでに**作った別の借用**（第一引数の `&x`）は外側 `outer` まで生きるから。

### 「ビルドするとこういう形になる」（脱糖イメージ）

`outer(&x, inner(&mut x))` は概ねこう展開して考えられる。

```rust
let _result = {
    let arg1 = &x;             // 第一引数: &x（immutable borrow 開始）
    let arg2 = inner(&mut x);  // 第二引数: &mut x を作ろうとする ← ❌
    outer(arg1, arg2)
};                              // arg1（= &x）はここまで生きる
```

`arg1` が外側ブロックの末尾まで生きるので、その途中で `&mut x` を作ろうとするのが衝突の原因。ネストした式は、各部分が独自のブロックに展開され、コンパイラが一時変数を挿入する、というイメージが分かりやすい。

## 解決

3つの観点で考える。

### 1. `inner` の戻り値型を「借用を握らない型」にできるか

できるなら最強。文として実行した瞬間に借用が切れて、後続で自由に `x` を扱える。

```rust
fn inner(x: &mut i32) -> i32 { *x += 1; *x } // 所有権ある値を返す

let val = inner(&mut x);
outer(&x, val); // OK
```

### 2. できないなら、同じ呼び出しで `x` を二度借りない API にする

`inner` が `&mut` を返さざるを得ない場合、`outer` の引数で同じ `x` をもう一回見るのは諦める。設計を変えて、別データを渡す、`outer` を二段階に分ける、などで回避。

### 3. NLL に頼れるケースを覚えておく

`inner` が借用を握らず、他の引数も `x` を見ないなら、ネストしたまま通る（case 1, 2, 9）。すべてのネスト `&mut` がアウトなわけではない。

## まとめ

`A(B(&mut x))` でだけエラーになるのは、`&mut` の排他性と、引数で作った借用が外側 `A` の呼び出しまで生きるルールが噛み合うから。同じ形でも `&` なら共存できるので通る。**ネストの位置・`inner` の戻り値型・他の引数が同じ `x` を見るか**でエラーの有無が変わる。直す基本は「**先に `&mut` 側を文として実行し、借用を握らない型に変換してから次の文で `outer` を呼ぶ**」。`inner` が借用を返す型のまま変数に入れても解決しない点に注意。

## 参考

- The Rust Programming Language — References and Borrowing（`&mut` の排他ルール）: https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html
- Rust Error Codes — E0502 / E0499 / E0596 / E0716: https://doc.rust-lang.org/error_codes/
- The Rust Reference — Destructors / Temporary scopes: https://doc.rust-lang.org/reference/destructors.html
- The Rust Reference — Expressions / Evaluation order of operands: https://doc.rust-lang.org/reference/expressions.html#evaluation-order-of-operands
- Effective Rust — Item 14: Understand lifetimes: https://lurklurk.org/effective-rust/lifetimes.html
- 検証バージョン: rustc 1.75.0 (Ubuntu apt 版)、edition 2021
