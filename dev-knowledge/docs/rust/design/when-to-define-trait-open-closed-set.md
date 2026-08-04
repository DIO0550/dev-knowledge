---
title: Rust で trait を定義すべきか — ポリモーフィズム 4 分類と open/closed set による判断
tags:
  [
    rust,
    trait,
    polymorphism,
    enum,
    dyn-trait,
    generics,
    dyn-compatibility,
    sealed-trait,
    deref-polymorphism,
    anti-pattern,
    api-design,
    rust-design-patterns,
  ]
---

## TL;DR

- 「Rust は trait をあまり使わない」は誤り。**trait は Rust における唯一のインターフェース機構**で、演算子・`?`・`for`・`async` など言語機能の裏側はすべて trait。
- 正しくは「**継承の代用として反射的に trait を切らない**」。他言語で `interface` を書く場面の多くは、Rust では `enum` か素の `impl` で足りる。
- ポリモーフィズムは 4 種類に分解できる。**うち 3 つは trait が中核**、trait 不要なのは直和型多態（enum）だけ。
- 判断は 1 問に集約できる: **「この型の集合に、自クレートの外から新しいメンバーが追加されうるか？」**
  - YES（open set）→ trait。異種コレクションに入れるなら `dyn Trait`、入れないならジェネリクス + trait 境界。
  - NO（closed set）→ enum + `match`（網羅性チェックが効く、ヒープ確保・vtable なし）。
- 実装が 1 つしかないなら trait を作らない。public trait は**シグネチャに現れる型を全部 public に引きずり出す**ため、カプセル化が壊れる。
- `Deref` で継承を模倣するのは公式に認定されたアンチパターン。

---

## このドキュメントの射程

「Rust は Java や Go のように interface（trait）を多用しないのか？」という疑問に対して、一次情報（The Rust Programming Language / Rust API Guidelines / Rust Design Patterns / Rust Blog / Microsoft RustTraining）を根拠に、**trait を切るべき場面と切るべきでない場面**を判断できる状態にすることを目的とする。

対象読者は、OOP 言語（Java / C# / TypeScript など）から Rust に来て「とりあえず interface を切る」癖がある人。

対象 Rust バージョン: 1.86 時点（trait upcasting 安定化済み、"object safety" は "dyn compatibility" に改称済み、RPITIT は 1.75+）。

---

## 原因 — なぜ「trait をあまり使わない」という印象が生まれるのか

### 1. Rust に継承がないため、interface の使い道の半分が消えている

公式本（The Rust Programming Language, ch18-01）は、Rust が継承を提供しないというトレードオフを選んだと明言している。継承はサブクラスが必要以上にコードを共有してしまうリスクがあり、設計を硬直させ、サブクラスに意味をなさないメソッドが生えうる。そのため Rust は、

- コード再利用 → **コンポジション + trait のデフォルト実装**
- 型の置き換え可能性（多態） → **ジェネリクス + trait 境界**（bounded parametric polymorphism）または**トレイトオブジェクト**

に分解して解決している。「基底クラス代わりの interface」という用途が消えるので、trait の出番が減ったように見える。

### 2. 閉じた多態には enum という強力な代替がある

enum は本質的に**閉じた集合**（有限のバリアント、外部から追加不可）で、トレイトオブジェクトは**開いた集合**。委譲の必要性が内部に閉じているなら enum のほうが速く、dyn 互換性のようなルールにも縛られず、存在しうるバリアントを一覧できる。

Stack Overflow の定番回答でも「トレイトを実装する構造体の集合が事前に分かっているなら enum を使え。これが圧倒的にシンプルで、常にこちらを優先すべき」とされている。

### 3. public trait はカプセル化を壊す（Rust 特有）

trait のメソッドシグネチャに現れる型は、その trait が public である以上すべて public にせざるを得ない。「関数シグネチャに現れる型は、その関数と同等以上の可視性を持たねばならない」というルールが transitive に伝播するため、内部型が公開 API に漏れ出す。

```rust
mod db_logger {
    pub(crate) struct LogEntry { /* ... */ }

    pub trait Db {
        // ❌ error: private type `LogEntry` in public interface
        //    → LogEntry を pub にせざるを得ず、カプセル化が壊れる
        fn put_log_entries(&self, entries: Vec<LogEntry>);
    }
}
```

さらにクレートを跨ぐと、コヒーレンス（オーファンルール）による依存の逆流問題が起きる。
net クレートに db を差し込みたいとき、`trait Db` を db 側に置くと net が db に依存し、net 側に置くと `impl net::Db for db::MyDb` を書くために db が net に依存する。第三の `core_interfaces` クレートに逃がす手はあるが、定義の曖昧なインターフェースの寄せ集めになりスケールしない。

---

## 解決

### 前提: trait を「使わない」わけではない領域

標準トレイトの実装はむしろ**積極的にやれ**が公式指針。Rust API Guidelines のチェックリストには「型は共通トレイトを積極的に実装せよ（C-COMMON-TRAITS）」があり、`Copy`, `Clone`, `Eq`, `PartialEq`, `Ord`, `PartialOrd`, `Hash`, `Debug`, `Display`, `Default` が挙がっている。理由はオーファンルールで、impl はトレイト定義側か型定義側のどちらかのクレートに置く必要があり、**型を定義した側が先回りしないと後から誰も埋められない**から。

```rust
use std::ops::Add;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
struct Meters(f64);

// (1) 演算子 `+` は std::ops::Add trait
impl Add for Meters {
    type Output = Meters;
    fn add(self, rhs: Meters) -> Meters { Meters(self.0 + rhs.0) }
}

// (2) `{}` フォーマットは Display trait
impl fmt::Display for Meters {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:.2}m", self.0)
    }
}

// (3) `?` 演算子は From<E> による変換 trait
#[derive(Debug)]
enum AppError { Parse(std::num::ParseFloatError) }
impl From<std::num::ParseFloatError> for AppError {
    fn from(e: std::num::ParseFloatError) -> Self { AppError::Parse(e) }
}
fn parse_meters(s: &str) -> Result<Meters, AppError> {
    Ok(Meters(s.parse::<f64>()?))   // ← ここで From が呼ばれる
}

// (4) `for` ループは IntoIterator trait
fn total(values: Vec<Meters>) -> Meters {
    let mut sum = Meters::default();     // ← Default
    for v in values { sum = sum + v; }   // ← IntoIterator + Add
    sum
}
```

---

### ポリモーフィズム 4 分類

| 種類 | Rust での書き方 | trait を使う？ |
|---|---|---|
| ① パラメトリック多態 | ジェネリクス + trait 境界 | ✅ 境界として使う |
| ② アドホック多態 | 型ごとの `impl Trait for T` | ✅ 中核 |
| ③ サブタイプ多態（実行時） | `dyn Trait` | ✅ 中核 |
| ④ 直和型多態 | `enum` + `match` | ❌ 不要（ただし enum に std trait は実装する） |

#### ① パラメトリック多態：ジェネリクス + trait 境界

```rust
use std::collections::HashMap;
use std::hash::Hash;

// 「キーとして使える」＝ Eq + Hash という能力の集合で抽象化
fn count_by<T, K, F>(items: &[T], key_fn: F) -> HashMap<K, usize>
where
    K: Eq + Hash,
    F: Fn(&T) -> K,
{
    let mut counts = HashMap::new();
    for item in items {
        *counts.entry(key_fn(item)).or_insert(0) += 1;
    }
    counts
}
```

Rust は多態関数をコンパイル時に単相化し、トレイトメソッド呼び出しも型引数ごとに特殊化する。実行時コストはゼロ。

#### ② アドホック多態：同名メソッドを型ごとに違う実装で

```rust
trait Area {
    fn area(&self) -> f64;
    // デフォルト実装（継承の「共通実装」に相当）
    fn describe(&self) -> String { format!("面積は {:.2}", self.area()) }
}

struct Circle { r: f64 }
struct Rect { w: f64, h: f64 }
struct Triangle { base: f64, height: f64 }

impl Area for Circle { fn area(&self) -> f64 { std::f64::consts::PI * self.r * self.r } }
impl Area for Rect   { fn area(&self) -> f64 { self.w * self.h } }
impl Area for Triangle {
    fn area(&self) -> f64 { self.base * self.height / 2.0 }
    fn describe(&self) -> String { format!("三角形: {:.2}", self.area()) } // 上書き
}

// 外部の型・プリミティブにも実装できる（継承では不可能）
impl Area for (f64, f64) { fn area(&self) -> f64 { self.0 * self.1 } }
impl Area for f64        { fn area(&self) -> f64 { self * self } }
```

#### ③ サブタイプ多態：`dyn Trait`

```rust
fn main() {
    // 異なる型を 1 つのコレクションに入れられる
    let shapes: Vec<Box<dyn Area>> = vec![
        Box::new(Circle { r: 1.0 }),
        Box::new(Rect { w: 2.0, h: 3.0 }),
    ];
    let total: f64 = shapes.iter().map(|s| s.area()).sum();
    println!("{total:.2}");
}
```

#### ④ 直和型多態：enum（trait 不要）

```rust
enum Shape {
    Circle { r: f64 },
    Rect { w: f64, h: f64 },
}

impl Shape {
    fn area(&self) -> f64 {
        match self {
            Shape::Circle { r } => std::f64::consts::PI * r * r,
            Shape::Rect { w, h } => w * h,
        }
    }
}
// Box なし・vtable なし・連続メモリに並ぶ
```

**enum を選んでも std trait は実装する**（「enum＝trait を使わない」ではない）:

```rust
impl std::fmt::Display for Shape {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Shape::Circle { r } => write!(f, "円(r={r})"),
            Shape::Rect { w, h } => write!(f, "長方形({w}×{h})"),
        }
    }
}
```

---

### ケース別コード集

#### ケース A：実装が 1 つ → trait を作らない

```rust
// ❌ Java 脳：interface を先に切る
pub trait UserRepository {
    fn find(&self, id: u64) -> Option<User>;
}
pub struct PostgresUserRepository { pool: Pool }
impl UserRepository for PostgresUserRepository { /* ... */ }

// ✅ Rust：実装が 1 つなら inherent impl で十分
pub struct UserRepository { pool: Pool }
impl UserRepository {
    pub fn find(&self, id: u64) -> Option<User> { /* ... */ }
}
```

どうしても差し替え口が要る場合は **NVI（non-virtual interface）**: trait をユーザー向けインターフェースとして露出させず、具体型でラップしてその型を基準に API を組む。trait は拡張ポイントとしては優秀だが、主インターフェースとしては使い勝手が悪い。

```rust
pub(crate) trait Db {                 // ← 公開しない
    fn put_log_entries(&self, entries: Vec<LogEntry>);
}

pub struct Logger {
    db: Box<dyn Db + Send + Sync>,    // 内部実装の詳細
}

impl Logger {
    pub fn log(&self, msg: &str) { /* 公開 API は具体型のメソッドだけ */ }
}
```

#### ケース B：closed set → enum ディスパッチ

```rust
pub struct TempSensor { pin: u8 }
pub struct HumiditySensor { addr: u8 }
pub struct PressureSensor { spi_cs: u8 }

impl TempSensor     { fn read(&self) -> f64 { 23.4 }   fn unit(&self) -> &str { "°C" } }
impl HumiditySensor { fn read(&self) -> f64 { 55.0 }   fn unit(&self) -> &str { "%" } }
impl PressureSensor { fn read(&self) -> f64 { 1013.2 } fn unit(&self) -> &str { "hPa" } }

pub enum Sensor {
    Temp(TempSensor),
    Humidity(HumiditySensor),
    Pressure(PressureSensor),
}

// match の羅列が辛いときは委譲マクロ
macro_rules! delegate {
    ($self:expr, $m:ident $(, $a:expr)*) => {
        match $self {
            Sensor::Temp(s)     => s.$m($($a),*),
            Sensor::Humidity(s) => s.$m($($a),*),
            Sensor::Pressure(s) => s.$m($($a),*),
        }
    };
}

impl Sensor {
    pub fn read(&self) -> f64 { delegate!(self, read) }
    pub fn unit(&self) -> &str { delegate!(self, unit) }
}
```

**enum の最大の利点は網羅性検査**。バリアント追加で対応漏れが全部コンパイルエラーになる（trait では起きない）。

```rust
pub enum Sensor {
    Temp(TempSensor),
    Humidity(HumiditySensor),
    Pressure(PressureSensor),
    Co2(Co2Sensor),        // ← 追加
}
// error[E0004]: non-exhaustive patterns: `Sensor::Co2(_)` not covered
```

バリアントが 20 個を超える／増え続けるなら `enum_dispatch` クレートで委譲コードを自動生成する。

#### ケース C：open set → `dyn Trait`

```rust
pub trait Plugin {
    fn name(&self) -> &str;
    fn on_event(&mut self, event: &Event) -> Result<(), PluginError>;
}

pub struct PluginHost { plugins: Vec<Box<dyn Plugin>> }

impl PluginHost {
    pub fn register(&mut self, p: Box<dyn Plugin>) { self.plugins.push(p); }
    pub fn dispatch(&mut self, event: &Event) {
        for p in &mut self.plugins {
            if let Err(e) = p.on_event(event) {
                eprintln!("plugin {} failed: {e:?}", p.name());
            }
        }
    }
}
```

**内部構造**: `&dyn Trait` は fat pointer で、64bit 環境ではデータポインタ 8 バイト + vtable ポインタ 8 バイトの計 16 バイト。呼び出しは vtable ポインタをロード → 関数ポインタを引く → データポインタを self として渡す。C++ の仮想関数と同程度のコストだが、Rust は vtable ポインタを fat pointer 側に持つので**具体型そのものは vtable ポインタを持たない**。

```rust
use std::mem::size_of;

trait Draw { fn draw(&self); }
struct Circle { r: f64 }
impl Draw for Circle { fn draw(&self) {} }

fn main() {
    assert_eq!(size_of::<&Circle>(), 8);      // thin pointer
    assert_eq!(size_of::<&dyn Draw>(), 16);   // fat pointer
    assert_eq!(size_of::<Circle>(), 8);       // 具体型に vtable ptr はない
}
```

#### dyn 互換性（旧・オブジェクト安全）※用語が変わっている

トレイトオブジェクトとして呼べるトレイトは現在 **dyn compatible（dyn 互換）** と呼ぶ。以前は "object safe / object safety" と呼ばれていた（rustdoc も「古いバージョンでは object safety と呼ばれていた」と併記する）。dyn 互換の条件は、すべてのスーパートレイトが dyn 互換で、関連型・関連定数を持たず、ジェネリクスに依存するメソッドがないこと。`Self` を返すメソッド（`Clone` など）も不可。

```rust
trait Broken {
    fn ok(&self);                    // ✅
    fn generic<T>(&self, x: T);      // ❌ vtable に無限の単相化は載らない
    fn clone_me(&self) -> Self;      // ❌ 戻り値サイズが実行時に不明
    fn create() -> Self;             // ❌ self がない
    const LIMIT: u32;                // ❌ 関連定数
}

// 回避策: where Self: Sized で vtable から除外
trait Fixed {
    fn ok(&self);
    fn generic<T>(&self, x: T) where Self: Sized;
    fn create() -> Self where Self: Sized;
}
fn use_it(t: &dyn Fixed) { t.ok(); }   // ✅ 通る
```

Rust 1.86.0（2025-04-03）で **trait upcasting** が安定化し、スーパートレイトのトレイトオブジェクトへ強制変換できるようになった。以前は `fn as_supertrait(&self) -> &dyn Supertrait` のような回避メソッドが必要で、しかも 1 種類のポインタにしか効かなかった。

```rust
trait Animal: std::fmt::Debug {}
fn upcast(a: &dyn Animal) -> &dyn std::fmt::Debug { a }  // 1.86+
```

#### ケース D：引数の柔軟性が欲しいだけ → 既存 trait を境界に使う

```rust
use std::path::Path;

// ❌ 呼び出し側に変換を強いる
fn load_bad(path: String, tags: Vec<String>) { }

// ✅ 既存 trait の境界で受ける
fn load(path: impl AsRef<Path>, tags: &[impl AsRef<str>]) { }

fn main() {
    load("config.toml", &["a", "b"]);
    load(String::from("config.toml"), &[String::from("a")]);
    load(std::path::PathBuf::from("x"), &["a"]);
}
```

**APIT と RPIT の違い**: 引数位置の `impl Trait`（APIT）は「呼び出し側が型を選ぶ」ジェネリクスの糖衣。戻り値位置（RPIT）は「関数側が 1 つの具体型を選ぶ」。APIT ではターボフィッシュ（`foo::<X>()`）が使えない。

```rust
// APIT: 呼び出し側が決める
fn sum_all(iter: impl Iterator<Item = i32>) -> i32 { iter.sum() }

// RPIT: 関数側が決める（呼び出し側は Iterator としか見えない）
fn evens(n: i32) -> impl Iterator<Item = i32> {
    (0..n).filter(|x| x % 2 == 0)
}
```

Rust 1.75 以降はトレイト定義内でも `-> impl Trait`（RPITIT）が書ける。それ以前は `Box<dyn Iterator>` か関連型が必要だった。

```rust
trait Config {
    fn keys(&self) -> impl Iterator<Item = &str>;   // 1.75+
}
struct TomlConfig { entries: Vec<String> }
impl Config for TomlConfig {
    fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(String::as_str)
    }
}
```

#### ケース E：拡張トレイト（`Ext` パターン）— trait を作るのが正解の代表例

オーファンルールにより外部トレイトを外部型に実装することはできない。拡張トレイトはその標準的な回避策で、自クレートに新しいトレイトを定義し、境界を満たす任意の型にブランケット実装を与える。`itertools::Itertools`, `futures::StreamExt`, `tokio::io::AsyncReadExt`, `tower::ServiceExt` などエコシステム全体に浸透している。命名は `Ext` サフィックスが慣例。

```rust
pub trait ResultExt<T, E> {
    fn log_err(self, context: &str) -> Self;
}

impl<T, E: std::fmt::Display> ResultExt<T, E> for Result<T, E> {
    fn log_err(self, context: &str) -> Self {
        if let Err(e) = &self { eprintln!("[{context}] {e}"); }
        self
    }
}

fn main() {
    let _ = "abc".parse::<i32>().log_err("parsing port");
    // [parsing port] invalid digit found in string
}
```

#### ケース F：マーカートレイト／型状態（多態ではない trait の用途）

メソッドを持たないトレイトは、型がある性質を持つことを示すマーカーになる（std の `Send`, `Sync`, `Unpin`, `Sized`, `Copy`）。

```rust
use std::marker::PhantomData;

struct Open;
struct Closed;
struct Door<State> { _state: PhantomData<State> }

impl Door<Closed> {
    fn new() -> Self { Door { _state: PhantomData } }
    fn open(self) -> Door<Open> { Door { _state: PhantomData } }
}
impl Door<Open> {
    fn close(self) -> Door<Closed> { Door { _state: PhantomData } }
    fn walk_through(&self) { println!("through!"); }
}

fn main() {
    let door = Door::new().open();
    door.walk_through();
    let door = door.close();
    // door.walk_through();  // ❌ 閉じたドアは通れない（コンパイルエラー）
}
```

実行時コストゼロで不正な状態遷移を禁止する用途。Rust ならではの trait の使いどころ。

#### ケース G：関連型 vs ジェネリック型パラメータ

- **関連型**: 実装する型ごとに自然な出力が 1 つだけのとき（`Iterator::Item`, `Deref::Target`, `Add::Output`）
- **ジェネリックパラメータ**: 1 つの型が複数の相手に対して意味のある実装を持てるとき（`From<T>`, `AsRef<T>`, `PartialEq<Rhs>`）

判断のコツ: 「このイテレータの Item は何か？」と問えるなら関連型。「これは f64 に変換できる？ String には？」と問えるならジェネリックパラメータ。

```rust
// ✅ 関連型: 「この Parser の出力は何か」は 1 つに決まる
trait Parser {
    type Output;
    type Error;
    fn parse(&self, input: &str) -> Result<Self::Output, Self::Error>;
}
struct PortParser;
impl Parser for PortParser {
    type Output = u16;
    type Error = std::num::ParseIntError;
    fn parse(&self, input: &str) -> Result<u16, Self::Error> { input.parse() }
}

// ✅ ジェネリックパラメータ: 1 つの型が複数の変換先を持てる
trait Encode<Out> { fn encode(&self) -> Out; }
struct Packet(Vec<u8>);
impl Encode<String>  for Packet { fn encode(&self) -> String  { hex(&self.0) } }
impl Encode<Vec<u8>> for Packet { fn encode(&self) -> Vec<u8> { self.0.clone() } }
```

#### ケース H：ブランケット実装

std 自身が `Display` を実装した全型に `ToString` を付けている。ただしブランケット実装は**取り返しがつかない**（コヒーレンス／オーファンルールにより、後からより特殊化した実装を足せない）。

```rust
pub trait Loggable { fn log_line(&self) -> String; }

impl<T: std::fmt::Debug> Loggable for T {
    fn log_line(&self) -> String { format!("[LOG] {self:?}") }
}

// ⚠️ この後で String だけ特別扱いはできない
// impl Loggable for String { ... }  // error[E0119]: conflicting implementations
```

#### ケース I：Sealed trait（公開はするが実装させない）

API Guidelines の Future proofing に「sealed トレイトで下流の実装を防ぐ（C-SEALED）」がある。ただし sealed でも public メソッドの削除やシグネチャ変更は依然として破壊的変更であり、実装しようとする利用者が無駄に苦労しないよう **rustdoc に sealed である旨を書くべき**とされる。

```rust
mod private {
    pub trait Sealed {}          // 外から名前を指せない
}

/// This trait is sealed and cannot be implemented outside of this crate.
pub trait Format: private::Sealed {
    fn extension(&self) -> &'static str;
}

pub struct Json;
pub struct Yaml;

impl private::Sealed for Json {}
impl private::Sealed for Yaml {}
impl Format for Json { fn extension(&self) -> &'static str { "json" } }
impl Format for Yaml { fn extension(&self) -> &'static str { "yaml" } }

// 下流クレートで:
// impl Format for Xml {}  // ❌ private::Sealed を満たせない
```

実例: `tracing` の `Value` は利用者コードで使うため `pub` だが、将来より高度な値システムに置き換える予定があり、その変更で壊れる下流実装を防ぐため sealed にされている。`sealed` クレートを使うと `#[sealed]` 属性で簡潔に書ける。

#### ケース J：`Deref` による継承の模倣（アンチパターン）

Rust Design Patterns（rust-unofficial）が公式にアンチパターンとして掲載。Rust に struct の継承はなくコンポジションを使うべきで、`Deref` はカスタムポインタ型のためのもの（ポインタ to T を T にするためのものであって、異なる型同士の変換のためのものではない）。

```rust
use std::ops::Deref;

struct Base;
impl Base { fn shared(&self) { println!("shared"); } }

struct Derived { base: Base }

// ❌ アンチパターン
impl Deref for Derived {
    type Target = Base;
    fn deref(&self) -> &Base { &self.base }
}

// ✅ コンポジション + 明示的な委譲（ファサードメソッド）
struct Better { base: Base }
impl Better {
    fn shared(&self) { self.base.shared() }
}
```

実害の理由も明示されている: **デリファレンス経由でしか使えないメソッドやトレイトは境界チェックの際に考慮されない**ため、このパターンを使ったデータ構造に対するジェネリックプログラミングが複雑化する。

---

### コスト比較表

| 観点 | ジェネリクス / `impl Trait` | `dyn Trait` | enum ディスパッチ |
|---|---|---|---|
| ディスパッチ | 静的（単相化） | 動的（vtable） | `match` 分岐 |
| 呼び出しコスト | ゼロ（インライン化される） | 1 段のポインタ間接 | 分岐予測 |
| インライン化 | ✅ | ❌ | ✅ |
| ヒープ確保 | なし | 通常 Box で発生 | なし（インライン格納） |
| ポインタ幅 | thin（1 word） | fat（2 words） | — |
| バイナリサイズ | 型ごとにコピーが増える | コード共有で小さい | バリアントごとに1コピー |
| 異種コレクション | ❌ | ✅ | ✅ |
| 外部からの型追加 | ✅ | ✅ | ❌（閉じた集合） |
| dyn 互換性の制約 | 不要 | 必要 | 不要 |
| 網羅性チェック | ❌ | ❌ | ✅ |

数百万回まわるタイトループでは静的 / 動的の差が 2〜10 倍になりうる一方、コールドパス・設定・プラグイン用途では `dyn` の柔軟性のほうが価値がある。

---

### 意思決定フロー

```text
その振る舞いは std トレイト（Display/From/Iterator/…）で表せる？
├── YES → 迷わず impl / derive する（C-COMMON-TRAITS）
└── NO
     ↓
   実装は 2 つ以上ある？
   ├── NO → trait を作らない。inherent impl で書く
   └── YES
        ↓
      実装の集合は自クレートで閉じている？
      ├── YES → enum ディスパッチ
      │          （公開 API にしたいなら trait は pub(crate) に隠して NVI）
      └── NO（外部が実装を足す）
           ↓
         異種コレクションに入れる／API 境界を跨ぐ？
         ├── YES → dyn Trait（dyn 互換性に注意）
         └── NO  → ジェネリクス + trait 境界（ゼロコスト）
              ↓
            将来トレイトを変更する可能性がある？
            └── YES → sealed trait で封印（C-SEALED）
```

---

## まとめ

- **trait は Rust の中核**。std トレイトの実装（`derive` 含む）はケチらない。オーファンルールにより、型を定義した側が実装しないと後から誰も埋められない。
- 自作 trait を切る判断は **「open set か closed set か」** の 1 問。閉じているなら enum、開いているなら trait。
- **実装が 1 つなら trait を作らない**。public trait は可視性の伝播で内部型を公開 API に引きずり出す。差し替え口が要るなら NVI で `pub(crate)` に隠す。
- **継承の代替に `Deref` を使わない**。コンポジション + 明示委譲。
- trait が真価を発揮するのは、拡張トレイト（`Ext`）、マーカー／型状態、ブランケット実装、真のプラグイン境界。ここは遠慮なく使う。
- ポリモーフィズムを避けているのではなく、**サブタイプ多態（`dyn`）を第一選択にしないだけ**。4 分類のうち 3 つは trait が中核。

---

## 参考

- The Rust Programming Language ch18-01「Characteristics of Object-Oriented Languages」— 継承を採らない理由、bounded parametric polymorphism
  https://doc.rust-lang.org/book/ch18-01-what-is-oo.html
- The Rust Programming Language ch18-02「Using Trait Objects That Allow for Values of Different Types」
  https://doc.rust-lang.org/book/ch18-02-trait-objects.html
- Rust Blog「Abstraction without overhead: traits in Rust」(Aaron Turon, 2015) — trait は Rust における唯一のインターフェース概念
  https://blog.rust-lang.org/2015/05/11/traits/
- Rust API Guidelines: Checklist（C-COMMON-TRAITS / C-SEALED / C-OBJECT）
  https://rust-lang.github.io/api-guidelines/checklist.html
- Rust API Guidelines: Future proofing（sealed trait パターン）
  https://rust-lang.github.io/api-guidelines/future-proofing.html
- Rust Design Patterns: Deref polymorphism（アンチパターン）
  https://rust-unofficial.github.io/patterns/anti_patterns/deref.html
- Rust Design Patterns: Generics as Type Classes
  https://rust-unofficial.github.io/patterns/functional/generics-type-classes.html
- Possible Rust「Enum or Trait Object」— closed set / open set の整理
  https://www.possiblerust.com/guide/enum-or-trait-object
- Julio Merino「Rust traits and dependency injection」— public trait による可視性の漏れ
  https://jmmv.dev/2022/04/rust-traits-and-dependency-injection.html
- Lobsters 上の議論（NVI / クレート間コヒーレンス問題）
  https://lobste.rs/s/yqm4uc/rust_traits_dependency_injection
- Microsoft RustTraining「Rust Patterns & Engineering How-Tos」ch02 Traits In Depth — vtable / fat pointer / enum dispatch / 拡張トレイト
  https://microsoft.github.io/RustTraining/rust-patterns-book/ch02-traits-in-depth.html
- Announcing Rust 1.86.0 — trait upcasting の安定化
  https://blog.rust-lang.org/2025/04/03/Rust-1.86.0/
- lang-team issue #286「rename "object safety" to "dyn compatibility"」
  https://github.com/rust-lang/lang-team/issues/286
- Zenn「Rust での抽象化 3パターンについて」— Rust way 的には多態は enum が基本
  https://zenn.dev/j5ik2o/articles/045737392958a3
