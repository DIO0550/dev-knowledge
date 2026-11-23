---
title: サードパーティ action を禁止し、公式 action + CLI のみで CI/CD を組む
tags: [github-actions, ci-cd, security, supply-chain, actions, pinning]
---

## TL;DR

- CI/CD の GitHub Actions で**サードパーティ action はサプライチェーン攻撃の面**（乗っ取られた action がシークレットを盗む・任意コードを実行する等）を持つ。ポリシーとして**公式 (`actions/*`) のみ許可**にするとリスクを絞れる。
- 代替の基本方針: **できることは action ではなく CLI を直接叩く**。ツールのセットアップも公式が CLI インストールを提供しているならそれを使う。
- どうしても必要な準公式 action（例: `pnpm/action-setup`）は例外扱いにし、**すべての action を commit SHA でピン止め**する（タグは動くので信頼できない）。

## 遭遇した問題

- CI/CD の GitHub Actions ワークフローでサードパーティ製 action を使用していた。
- セキュリティ・メンテナンス上のポリシーとして「公式 action のみ使用可」にしたい。

## 原因

- サードパーティ action は**サプライチェーン攻撃のリスク**を持つ。
  - action のリポジトリやメンテナのアカウントが乗っ取られると、CI に流し込んだシークレット（トークン等）が漏洩したり、任意コードが実行されたりする。
  - タグ参照（`@v4` など）は可変で、後から中身をすり替えられる。
- 公式 (`actions/*`) に限定することで、信頼境界を GitHub 公式が管理する範囲まで狭められる。

## 解決

### 方針: action を CLI 実行で置き換える

- **rustup は直接 CLI で実行**する（Rust ツールチェーンのセットアップに専用 action を使わない）。
- **pnpm は `pnpm/action-setup` を使用**（準公式扱いの例外）。
- ビルド成果物のやり取りなどは**公式 action** で代替する。
  - `actions/checkout`
  - `actions/upload-artifact` / `actions/download-artifact`
  - など `actions/*` 名前空間のもの。

### すべての action を SHA でピン止めする

タグではなく commit SHA で固定し、意図しないバージョン差し替えを防ぐ。

```yaml
# NG: タグ参照は可変で、中身をすり替えられる
- uses: actions/checkout@v4

# OK: commit SHA で固定（末尾コメントに人間可読なバージョンを添える）
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
```

### 判断の指針

- 「その action でしかできないか？」をまず疑う。CLI で置換できるならその方が信頼境界が狭い。
- 公式 (`actions/*`) → 準公式（`pnpm/action-setup` 等、例外として明示） → CLI 直実行、の優先順で選ぶ。
- サードパーティ action は原則禁止。使うなら理由を残し、SHA でピン止めする。
