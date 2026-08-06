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

## AI 向け JSON エンドポイント

AI がタグ横断でナレッジを探索できるように、ビルド時に静的な JSON を生成しています。

### 全タグ一覧

`GET https://DIO0550.github.io/dev-knowledge/api/tags.json`

```json
{
  "count": 337,
  "tags": [
    {
      "name": "react",
      "count": 40,
      "url": "https://dio0550.github.io/dev-knowledge/api/tags/react.json"
    }
  ]
}
```

### タグごとの記事一覧

`GET https://DIO0550.github.io/dev-knowledge/api/tags/<tag>.json`

タグ名から URL を組み立てず、`tags.json` の `url` をそのまま辿ってください（タグ名と slug は必ずしも一致せず、日本語タグは percent-encode されます）。

```json
{
  "tag": "react",
  "count": 40,
  "docs": [
    {
      "title": "useState と useReducer の使い分け",
      "url": "https://dio0550.github.io/dev-knowledge/docs/react/hooks/useState%E3%81%A8useReducer%E3%81%AE%E4%BD%BF%E3%81%84%E5%88%86%E3%81%91",
      "tags": ["react", "useState", "useReducer"]
    }
  ]
}
```

生成しているのは [`dev-knowledge/plugins/tag-json-api.ts`](./dev-knowledge/plugins/tag-json-api.ts)（Docusaurus のローカルプラグイン）です。記事の frontmatter の `tags` をそのまま使うので、記事を追加すれば次のデプロイで自動的に反映されます。

出力はビルド時のみです。ローカルで確認するときは `pnpm start` ではなく `pnpm build && pnpm serve` を使ってください。

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
    ├── plugins/
    │   └── tag-json-api.ts # AI 向け JSON エンドポイントの生成
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
