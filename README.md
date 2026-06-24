# dev-knowledge

プログラミングで得た知見・遭遇した問題と解決策を蓄積する個人ナレッジベース。Docusaurus + GitHub Pages で公開しています。

## 公開サイト

📖 **https://DIO0550.github.io/dev-knowledge/**

## 目的

- 雑多に蓄積することを優先する。整理コストで蓄積のハードルを上げない。
- 後から検索・再利用できる状態を保つ。横断はタグで担保する。

## 記事の書き方

- 1 記事 = 1 つの問題 or 知見。粒度は小さく保つ。
- 各記事の frontmatter に `title` と `tags` を付ける。`tags` は横断検索の主役。
- 「遭遇した問題 → 原因 → 解決」の流れを基本にし、再現条件と環境（バージョン等）を残す。
- 記事は日本語で書く。

詳細なルールは [CLAUDE.md](./CLAUDE.md) を参照。

## ディレクトリ構成

```
.
├── CLAUDE.md              # 記事ルール・運用方針
├── .devcontainer/         # DevContainer 設定
├── .github/workflows/
│   └── deploy.yml         # GitHub Pages へのデプロイ
└── dev-knowledge/         # Docusaurus サイト
    ├── docs/              # ナレッジ記事（技術ごとにフォルダ分け）
    │   ├── react/
    │   ├── rust/
    │   ├── swift/
    │   ├── linux/
    │   └── data-modeling/
    ├── src/
    ├── static/
    └── docusaurus.config.ts
```

技術ごとにフォルダを分け、カテゴリは粗く保つ。技術が増えたら `docs/` 配下にフォルダを追加する。

## ローカル開発

DevContainer で開発環境が自動構築されます。サイトは `dev-knowledge/` 配下で動かします。

```bash
cd dev-knowledge
pnpm install
pnpm start
```

`pnpm start` でローカル開発サーバーが起動し、変更がライブリロードされます。

ビルド・本番プレビュー:

```bash
pnpm build   # build/ に静的ファイルを生成
pnpm serve   # ビルド結果をローカルで確認
```

## デプロイ

`main` ブランチへの push をトリガーに、GitHub Actions（[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)）が自動でビルドし GitHub Pages へデプロイします。
