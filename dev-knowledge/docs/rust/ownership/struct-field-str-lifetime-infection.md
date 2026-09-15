---
title: 構造体フィールドに &'a str を持つとライフタイムが感染する — clone ではなく所有させる
tags: [rust, lifetime, struct, str, string, cow, arc, zero-copy, api-design, caller-control, self-referential]
---

## TL;DR

- 構造体に `&'a str` を入れると、**構造体のほうが**元データより長生きできなくなる。データが死ぬのではなく、構造体の置き場所が狭まる。
- `'a` は型パラメータなので、それを含む型すべてに伝播する。これが「感染」の正体。
- 対処は「clone しろ」ではなく「**所有型にしろ**」。所有型にすれば呼び出し側が move で渡せるのでコピーは起きない。
- `&'static str` は例外で、構造体に入れても実質的な制約にならない。
- 逆に zero-copy パーサでは、ライフタイム付き構造体が正解。

## このドキュメントの射程

関数引数では `&str` が定石なのに、同じ感覚で構造体フィールドに `&str` を置くと詰む。この非対称性の理由と、所有型に切り替えるときの選択肢を扱う。

## 原因

`&str` はデータを所有しておらず、そのライフタイムは元の所有者より長くなってはいけない。ここで重要なのは**制約の向き**で、データ側が死ぬのではなく、借りている構造体のほうが短命に強制される。

Rust には GC がないので構造体の中身を延命することはできず、構造体のほうを短命にするしかない。この「感染性」は安全性のために必要なものである。

結果として起きる典型的な事故:

- 構造体を関数から返せない
- `Vec` に貯められない
- `'static` を要求する `thread::spawn` / `tokio::spawn` に渡せない

### 感染は型パラメータとして起きる

`'a` は構造体の型パラメータなので、ジェネリクスの `T` と同じように上へ伝播する。

```rust
struct Excerpt<'a> { part: &'a str }

// これを持つ側も 'a を持たされる
struct Document<'a> { excerpts: Vec<Excerpt<'a>> }

// さらにその上も
struct App<'a> { doc: Document<'a> }
```

`&str` を 1 個フィールドに入れただけで、それを含む型が全部ライフタイム付きになる。

これは Rust チームも罠として認識しており、rust-lang/rust#104979 では、データを「参照で」構造体に持つことと Rust の参照を混同するのは初学者に非常に多く、本来持つべきでない構造体にライフタイムを導入すると深刻な結果を招き、ライフタイム注釈と制約がプログラム全体にウイルス的に波及して借用チェッカとの不必要な戦いを引き起こす、と指摘されている。そのため `&'a T` ではなく `Box<T>`（さらに `String` / `Vec<T>`）を提案すべきだという議論になっている。つまり**コンパイラが出す「`<'a>` を付けろ」という修正提案自体が初心者にとっては罠**である。

### 関数引数が軽い理由

関数呼び出しは終われば `'a` も終わる。構造体はインスタンスが 1 個の `'a` を背負ったまま動き、フィールドが生きている間ずっと元データが借用されたままになる。NLL の「最後の使用で借用が切れる」も効きにくい。

## 解決

「参照が使えない → clone」ではなく、「**参照が使えない → 所有型にして、コピーの要否は呼び出し側が決める**」が正しい順序。所有型にすること = clone が発生すること、ではない。

```rust
// これは clone ではない。呼び出し側が move してくるだけ（コスト 0）
struct Config { name: String }

impl Config {
    fn new(name: String) -> Self { Self { name } }
}
```

Rust API Guidelines の C-CALLER-CONTROL どおり、所有権が必要なら所有権を受け取り、内部で clone しない。

### 「呼び出し側が選べる」とはどういうことか

「関数内で clone するかを外側が決める」という意味ではない。**関数が所有型を受け取れば関数はもう clone せず、コピーが必要かどうかは呼び出し側の事情で決まり、呼び出し側のコードにそれが現れる**、ということ。

```rust
// A: &str を受け取り、関数の中で clone する
fn set_name_a(&mut self, name: &str) {
    self.name = name.to_string();  // 必ずアロケーションが起きる
}

// B: String を受け取る
fn set_name_b(&mut self, name: String) {
    self.name = name;  // 関数はコピーしない。受け取って置くだけ
}
```

```rust
let s = String::from("hello");

// A: s をもう使わないつもりでも必ずコピーされる。避ける手段がない
obj.set_name_a(&s);

// B: 呼び出し側の状況で選べる
obj.set_name_b(s);          // s を手放す → move だけ。コピー 0
obj.set_name_b(s.clone());  // s を残したい → 明示的に clone。コストが見える
```

A の問題は 2 つ。

1. **コピーを避けるルートが存在しない。** 呼び出し側が「この `String` はもう要らない」と思っていても、`&s` で渡した時点で関数が必ず新しく確保する。
2. **コストがシグネチャに現れない。** `set_name_a(&s)` は借りているように見えるのに裏でヒープ確保している。C-CALLER-CONTROL が「借用してから clone するな」と言うのはこれが理由。

B の代償はリテラルを渡すときの冗長さ（`obj.set_name_b("hello".to_string())`）。気になるなら `impl Into<String>` で折衷できる。

```rust
fn set_name(&mut self, name: impl Into<String>) {
    self.name = name.into();
}

obj.set_name("hello");   // &str → 内部で確保
obj.set_name(s);         // String → into() は no-op。コピー 0
```

前提として、これは**関数が所有権を必要とする場合**の話。読むだけなら `&str` を取るのが正解でそもそも誰も clone しない。避けるべきなのは「所有権が要るのに `&str` を取って中で `to_string()` する」という組み合わせ。

### 所有のさせ方は一択ではない

| 選択肢 | 使いどころ |
|---|---|
| `String` | 標準。変更もする |
| `Box<str>` | 所有するが不変。`String` より 1 ワード小さい（capacity なし） |
| `Rc<str>` / `Arc<str>` | 同じ不変文字列を多数の箇所が共有する |
| `Cow<'a, str>` | 借りられるときは借り、必要なときだけ確保 |
| `&'static str` | **例外。構造体に入れて問題ない** |

文字列リテラルは `&'static str` なのでプログラムの最後まで生きている。固定のエラーメッセージやトークンのように `'static` と確定している場合は、構造体に持たせても実質的な制約にならない。

`Cow<'static, str>` にしておくと、静的な文字列は `Cow::Borrowed` でアロケーションゼロ、動的な値のときだけ `Cow::Owned` に落ちる、という使い分けができる。

### ライフタイム付き構造体が正解の場面

zero-copy パーサはこれが本命。AST 型に `String` ではなく `&str` スライスを使い、借用チェッカが「パース結果が元データより長生きしない」ことをコンパイル時に保証する。

ただし `'a` はパーサ全体に感染するので、長生きさせたい構造体では**参照の代わりにインデックス（span）を持つ**回避策がある。

```rust
// 借用を持たないので 'static。バッファごと所有して位置だけ覚える
struct ParserOwned {
    input: String,
    token_spans: Vec<(usize, usize)>,
}
```

### 落とし穴: 自己参照構造体

同じ構造体の中に `String` フィールドと、それを指す `&str` フィールドを同時に持つことはできない。自己参照構造体になるため。これをやりたくなったら、上の span 方式か `Arc<str>` を各所に配る方式に切り替える。

## まとめ

判断は「clone するかどうか」ではなく「**この構造体は元データと寿命を共にしていいか**」。共にしていいなら借用（zero-copy が効く）、独立させたいなら所有型、独立かつ複製もしたくないなら `Rc` / `Arc`。

## 参考

- [Do not suggest introducing lifetime parameters in structs · rust-lang/rust#104979](https://github.com/rust-lang/rust/issues/104979)
- [Flexibility - Rust API Guidelines（C-CALLER-CONTROL）](https://rust-lang.github.io/api-guidelines/flexibility.html)
- [Validating References with Lifetimes - The Rust Programming Language](https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html)
- [std::borrow::Cow - Rust](https://doc.rust-lang.org/std/borrow/enum.Cow.html)
