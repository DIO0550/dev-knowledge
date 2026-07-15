---
title: Rust でイベント・命令を型にするのは一般的か — enum of structs パターンと Op という語彙
tags: [rust, naming, enum, struct, event, command, message, design-pattern, actor, json-patch, api-design]
---

## TL;DR

- **イベント・命令・メッセージを型として表現するのは Rust では一般的どころか標準的な設計**。GUI（winit / crossterm）、非同期メッセージパッシング（tokio の Actor パターン）、データ操作（json-patch）と、分野を問わずエコシステム全体で採用されている。
- 表現手段は3つ: **enum（既定）**、**trait オブジェクト**、**関数ポインタ/クロージャ**。選択基準は「操作の集合が閉じているか開いているか」。
- 自分のアプリ内で操作の種類を管理できるなら **enum が第一選択**。各バリアントが操作固有のデータを持つ struct を内包する「enum of structs」が慣用形。
- `Op` / `Operation` は `std::ops`、`syn::BinOp`、`wgpu::LoadOp`、`json_patch::PatchOperation` など公式・準公式レベルで使われる確立された語彙。型名・フィールド名どちらでも問題ない。

## このドキュメントの射程

- アプリケーション内のイベント・命令（操作）を型としてモデリングすることの妥当性と、その表現手段（struct / enum / trait オブジェクト）の選択基準。
- 型名・フィールド名としての `Op` / `Operation` の妥当性（エコシステム実例調査）。

## 原因（なぜ迷うか）

- OOP 出身だと「操作をオブジェクトにする = Command パターン = クラス（struct）+ インターフェース」と考えがちだが、Rust には網羅性チェックが効く enum があり、どちらを軸にすべきか判断基準が欲しくなる。
- `Op` は略語なので、`~Result` のような汎用サフィックス問題と同種の命名の懸念がないか確認したくなる。

## 解決

### 1. 「イベント・命令を型にする」は Rust の標準的な設計

エコシステムを横断して確認すると、「操作をデータ（型）として表現し、後で解釈・実行する」構造はあらゆる分野で使われている:

- **GUI イベント**: winit の `enum Event { WindowEvent {..}, DeviceEvent {..}, UserEvent(T), Suspended, Resumed, .. }`、crossterm の `enum Event { FocusGained, Key(KeyEvent), Mouse(MouseEvent), Paste(String), Resize(u16, u16), .. }`
- **非同期メッセージパッシング**: tokio の Actor パターン（Alice Ryhl の記事が事実上の標準レシピ）では、アクターへの命令を enum で定義し channel 経由で送る。1つの mpsc channel に全メッセージ種を載せるために enum を使うのが推奨されている:

```rust
enum ActorMessage {
    GetUniqueId { respond_to: oneshot::Sender },
    // 応答が必要な命令は oneshot::Sender をペイロードに含める
}
```

- **データ操作の記述**: json-patch の `PatchOperation`（後述）
- **コンパイラ/IR**: syn の `BinOp` / `UnOp`、cranelift の `Opcode` / `InstructionData`

Rust Design Patterns（rust-unofficial/patterns）の Command パターンの章でも、「一連のアクションやトランザクションをオブジェクトとしてカプセル化し、後で・別のタイミングで実行する。イベントの結果として発火することもあり、undo 可能にすることもある」というユースケースが正面から扱われており、この設計自体が疑問なく妥当とされている。

### 2. 表現手段の選択基準: 集合が閉じているか開いているか

Rust Design Patterns と関連 issue（rust-unofficial/patterns#252）での議論を整理すると:

| 手段 | 向いている状況 | 例 |
|---|---|---|
| **enum**（既定） | 操作の集合を自分のアプリ/クレートで管理でき、バリアント追加が頻繁でない | winit、crossterm、json-patch、Actor メッセージ |
| **trait オブジェクト** | 委譲が外部（他クレート・プラグイン）から行われ、事前に型を列挙できない。操作が多数の関数と状態を持つ独立モジュール | actix のルートハンドラ登録 |
| **関数ポインタ / クロージャ** | 操作が小さく、関数として定義できる。動的ディスパッチを避けたい | コールバック列 |

The Rust Programming Language の State パターンの章にも「enum を使うと、値を確認する全箇所で match が必要になり trait オブジェクト解より繰り返しが増えうる」という注記があるが、これは実際にはトレードオフとして議論があり、状態・操作ごとに同じメソッド群を struct 全部に実装するより enum + match のほうが短くなるケースも多い（match アームは関数へ抽出できる）。**アプリ内部で完結するイベント・命令なら enum で閉じるのが普通**、という結論はコミュニティでほぼ共有されている。

### 3. 慣用形は「enum of structs」— struct 単体 vs enum の二者択一ではない

各操作が固有のフィールド群を持つ場合、それぞれを名前付き struct として定義し、enum のバリアントがラップする。json-patch（RFC 6902 実装）がそのまま手本になる:

```rust
pub enum PatchOperation {
    Add(AddOperation),
    Remove(RemoveOperation),
    Replace(ReplaceOperation),
    Move(MoveOperation),
    Copy(CopyOperation),
    Test(TestOperation),
}

// enum 側に全バリアント共通のアクセサを実装できる
impl PatchOperation {
    pub fn path(&self) -> &Pointer {
        match self {
            Self::Add(op) => &op.path,
            Self::Remove(op) => &op.path,
            // ...
        }
    }
}
```

この構成の利点:

- 各操作の struct（`AddOperation` など）に個別の `impl` を生やせ、「Add 操作だけを受け取る関数」を型シグネチャで表現できる
- enum 側で `match` の網羅性チェックが効く。バリアント追加時にコンパイラが処理漏れを全箇所指摘する
- serde のタグ付きシリアライズと自然に対応する（JSON Patch の `{"op": "add", ...}` 形式がそのまま enum にマップされる）
- ペイロードなし（`Suspended`）、タプル形式（`Key(KeyEvent)`）、名前付きフィールド形式（`WindowEvent { .. }`）を自由に混在できる

フィールドが少ない・共有されない操作はバリアントに直接インライン（`Resize(u16, u16)`）し、独立した意味を持つデータは struct に切り出す（`Key(KeyEvent)`）、という使い分けを crossterm がよく示している。

### 4. `Op` という語彙の実績

| 使用箇所 | 定義 | 備考 |
|---|---|---|
| `std::ops` | 演算子オーバーロード用トレイト群のモジュール | 標準ライブラリのモジュール名そのもの |
| `syn::BinOp` | `+`, `+=`, `&` などの二項演算子 enum | rustc の AST にも同名の型がある |
| `syn::UnOp` | `enum UnOp { Deref(Star), Not(Bang), Neg(Sub) }` | |
| `wgpu::LoadOp` / `StoreOp` | `enum LoadOp { Clear(V), Load }` | WebGPU 標準の `GPULoadOp` に対応 |
| `cranelift` | `Opcode`（命令オペコード）、`AtomicRmwOp` | `op: AtomicRmwOp` のようにフィールド名としても使用 |
| `json_patch` | `PatchOperation`（フル表記） | 短縮せず `Operation` を使う例 |

`Op`（短縮形）と `Operation`（フル表記）はどちらも実績があり、頻出する内部型なら `Op`、公開 API の可読性重視なら `Operation` が目安。「操作」という概念名詞そのものなので、`~Result` のような汎用サフィックス問題（型の中身を説明しない名前）は起きない。

## まとめ

- イベント・命令を型にするのは Rust の標準設計。アプリ内で閉じるなら enum、外部拡張が必要なら trait オブジェクト。
- 慣用形は「enum（種類）+ struct（各操作のデータ）」の enum of structs。`PatchOperation` と crossterm の `Event` が手本。
- `Op` / `Operation` は std・syn・wgpu・cranelift・json-patch で使われる確立された語彙で、型名にもフィールド名にも安心して使える。

## 参考

- Rust Design Patterns: Command — https://rust-unofficial.github.io/patterns/patterns/behavioural/command.html
- rust-unofficial/patterns#252（Command パターンへの enum 追加議論・enum vs trait オブジェクトの使い分け） — https://github.com/rust-unofficial/patterns/issues/252
- Actors with Tokio (Alice Ryhl) — https://ryhl.io/blog/actors-with-tokio/
- json-patch: PatchOperation — https://docs.rs/json-patch/latest/json_patch/enum.PatchOperation.html
- json-patch ソース（idubrov/json-patch） — https://github.com/idubrov/json-patch/blob/main/src/lib.rs
- winit::event::Event — https://docs.rs/winit/latest/winit/event/enum.Event.html
- crossterm::event::Event — https://docs.rs/crossterm/latest/crossterm/event/enum.Event.html
- syn::BinOp — https://docs.rs/syn/latest/syn/enum.BinOp.html
- syn::UnOp — https://docs.rs/syn/latest/syn/enum.UnOp.html
- wgpu::LoadOp — https://docs.rs/wgpu/latest/wgpu/enum.LoadOp.html
- cranelift Opcode — https://docs.rs/cranelift-codegen/latest/cranelift_codegen/ir/instructions/enum.Opcode.html
