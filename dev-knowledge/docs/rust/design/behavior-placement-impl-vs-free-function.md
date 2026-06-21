---
title: Rustの振る舞い配置 — 基本は impl ベース、ただしメモリ(借用)の事情で free 関数を選ぶ場合がある
tags: [rust, design, ddd, impl, associated-function, free-function, borrow-checker, ownership, deref-coercion, ffi]
---

## TL;DR

- **基本方針は DDD 寄りで impl ベース**。型に紐づく振る舞い・変換・生成は impl のメソッド/関連関数にまとめる（公式 API ガイドライン C-METHOD / C-CTOR / C-CONV）。これが Rust コミュニティの定石。
- ただし、それだけではない。**メモリ（所有権・借用）の事情から free 関数や `self` なし関連関数を選ぶのが正当なケースがある**。「分かりにくいから純粋関数にしている」のではなく、言語制約への対応であることが多い。
- 具体的には「借用分割の回避」「Deref 強制によるシャドウイング回避」「FFI」など。

## このドキュメントの射程

設計の基本として「型 + impl にまとめる（DDD 的なリッチモデル寄り）」で進めてよい。ただし Gemini に調べさせたところ、impl 一辺倒では説明がつかず、**メモリ（借用チェッカー）由来で free 関数が要求される場面がある**ことが分かった。その「例外側」を記録しておく。

## 原因

### 基本は impl ベースでよい（これが主軸）

- **C-METHOD**: 明確なレシーバを持つ操作はメソッドにする。自動借用（`value.method()`）、import 不要、rustdoc で型ページに集約、IDE 補完での発見性。
- **C-CTOR**: コンストラクタは impl の関連関数 `new`。`make_type()` のような free 関数はモジュール名前空間を汚す。
- **C-CONV**: 型変換は `as_` / `to_` / `into_` プレフィックスのメソッド。
- 標準ライブラリも `str::to_lowercase()` のようにメソッドで提供している。

→ struct + impl が主流という認識で正しい。free 関数を漫然と散らかすのはアンチパターン。

### ただしメモリの事情で free 関数が正当になる（Gemini が補完した点）

impl にまとめる規範と、借用チェッカーの制約は**対立する圧力**になることがある。

- **借用分割（Splitting Borrows）の回避**: `&mut self` を取ると、コンパイラはシグネチャだけ見て「構造体全体が排他借用された」と判定する（本体には踏み込まない）。disjoint なフィールドへの並行アクセスでも E0499 で弾かれる。これを避けるため、必要なフィールドだけを個別引数で受ける free 関数に切り出すのは**正当な設計判断**。
- **Deref 強制によるシャドウイング回避（C-SMART-PTR）**: スマートポインタに固有メソッドを足すと、Deref で解決される中身の型の同名メソッドと衝突する。だから `Box::into_raw(b)` は `b.into_raw()` にしない（`impl Box` 内の関連関数として定義されている）。
- **FFI**: `extern "C"` + `#[no_mangle]` の公開関数は、name mangling と `self` の概念がない C 側から呼ぶため、必ずトップレベル free 関数になる。

## 解決

判断の優先順位:

1. **デフォルトは impl のメソッド/関連関数**。型に帰属する操作・変換・生成はここに集約する。
2. **借用で詰まったら free 関数に逃がす**。`&mut self` 一つに処理を詰めてコンパイルが通らないなら、それは設計ミスではなく言語制約。必要なフィールドだけ個別引数で受ける free 関数にするのが回避策。
3. **スマートポインタ・FFI は例外**。所有権移送やバイナリ互換のため、あえて `self` を取らない関連関数 / free 関数を使う。

```rust
// 基本: 型に紐づく操作は impl にまとめる
impl Rectangle {
    fn new(w: u32, h: u32) -> Self { Self { width: w, height: h } } // C-CTOR
    fn area(&self) -> u32 { self.width * self.height }              // C-METHOD
}

// ❌ 借用分割で詰まる: step が self 全体を可変借用したと判定され E0499
impl Parser {
    fn step(&mut self) {
        let tok = self.lexer.next();   // self 全体が可変借用扱い
        self.state = transition(tok);  // ライフタイムエラー
    }
}

// ✅ メモリの事情で free 関数に切り出す(必要なフィールドだけ個別借用)
fn advance(lexer: &mut Lexer, state: &mut State) {
    let tok = lexer.next();   // lexer だけ可変借用
    *state = transition(tok); // state だけ可変借用(disjoint なので OK)
}
```

## まとめ・参考

- 一行まとめ: **基本は impl ベース(DDD 寄り)でよい。ただし借用・Deref・FFI などメモリ側の事情で free 関数が正当になる場面がある**ことを知っておく。
- impl にまとめられるのに散らかしているならアンチパターン。借用分割等のために関数化しているなら正当。両者を見分ける。
- 参考: Rust API Guidelines（C-METHOD, C-CTOR, C-CONV, C-SMART-PTR）、借用分割（Splitting Borrows）と E0499、`Box::into_raw`。
