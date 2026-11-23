---
title: 外部依存を自前サブクレートに分離して差し替えの影響範囲を局所化する
tags: [rust, cargo-workspace, dependency-management, architecture, design, boundary]
---

## TL;DR

- `walkdir` のような重い外部ライブラリを本体クレートに直接持つと、差し替え時に影響範囲が本体全体に広がる。
- **外部依存を専用のサブクレートに閉じ込め、`pub` API に外部 crate の型を出さない**ことで、差し替えの影響を 1 箇所（そのサブクレート）に局所化できる。
- `serde` 等のエコシステム標準（事実上の言語基盤）は分離対象外。分離コストに見合わないため。

## 問題

`walkdir` 等の重い外部ライブラリの依存を本体クレートに直接持つと、ライブラリ差し替え時に影響範囲が広がる。

- 本体クレートのあちこちで `walkdir::DirEntry` や `walkdir::Error` を直接扱っていると、別ライブラリに乗り換える際にそれらを参照している箇所すべてを修正することになる。
- 外部 crate の型がシグネチャに漏れ出していると、呼び出し側のコードまで外部 crate に間接的に依存する。

## 原因

Cargo.toml レベルで依存を分離することで、外部ライブラリ差し替えの影響を 1 箇所に閉じ込めることが目的。

- 依存の「所有者」を専用サブクレートに一本化すれば、外部 crate を知っているのはそのサブクレートだけになる。
- ただし `serde` のようなエコシステム標準は、実質的にどこでも使われる共通語彙であり、分離しても得られる隔離効果が薄い。**分離対象は「差し替え候補になり得る／重い／代替がある」外部ライブラリ**に絞る。

## 解決

`spec-board-fs` としてファイルシステム走査用のサブクレートを作成し、以下の境界ルールを確立する。

### 境界ルール

1. **`pub` API に外部 crate の型を出さない**
   - `walkdir::DirEntry` をそのまま返さず、`Vec<PathBuf>`（または自前の型）で返す。
   - `walkdir::Error` を `std::io::Error` に詰め直して返す。エラー型も外部 crate に依存させない。
2. **tauri 非依存**
   - このサブクレートは tauri（アプリ層のフレームワーク）に依存しない。純粋な FS 走査ロジックとして独立させ、再利用・単体テストを容易にする。

### コード例

```rust
// ❌ 外部 crate の型が pub API に漏れている
//    walkdir を差し替えると、この関数の呼び出し側すべてが影響を受ける
pub fn list_entries(root: &Path) -> Result<Vec<walkdir::DirEntry>, walkdir::Error> {
    walkdir::WalkDir::new(root).into_iter().collect()
}

// ✅ 外部 crate の型を境界の内側に閉じ込める
//    戻り値は std の型のみ。walkdir を知っているのはこの関数の内部だけ
pub fn list_entries(root: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut paths = Vec::new();
    for entry in walkdir::WalkDir::new(root) {
        // walkdir::Error を std::io::Error に詰め直す
        let entry = entry.map_err(|e| std::io::Error::other(e))?;
        paths.push(entry.into_path());
    }
    Ok(paths)
}
```

こうしておけば、`walkdir` を別の走査ライブラリに差し替えても、修正は `spec-board-fs` の内部実装に閉じる。本体クレートや tauri 層のコードは一切変更不要になる。

## まとめ

- 差し替え候補になり得る外部依存は、**専用サブクレートに分離し、`pub` API から外部 crate の型を締め出す**（型・エラーとも std か自前型に詰め直す）。
- 分離対象は「重い／代替がある／差し替えたくなる」ライブラリに限定する。`serde` 等のエコシステム標準は分離しない。
- 効果: 外部ライブラリ差し替えの影響が 1 クレートに局所化され、上位層（本体・tauri）は無変更で済む。
