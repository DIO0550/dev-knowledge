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

ベクタ検索を用意しなくても AI がこのナレッジベースを引けるように、ビルド時に静的な JSON を生成しています。全記事の目次が 1 ファイル（約 60KB）に収まるので、「目次を丸ごと読む → 関係ある記事の本文だけ取る」で完結します。

| エンドポイント | 内容 |
| --- | --- |
| `/api/index.json` | エントリポイント。記事数・タグ数と、下記エンドポイントの URL |
| `/api/docs.json` | 全記事の目次（タイトル・URL・カテゴリ・タグ・本文 JSON の URL） |
| `/api/docs/<id>.json` | 記事の本文（Markdown） |
| `/api/tags.json` | 全タグ（タグ名・記事数・タグ別 JSON の URL） |
| `/api/tags/<tag>.json` | そのタグが付いた記事の一覧 |

ベースは `https://DIO0550.github.io/dev-knowledge` です。

### 全記事の目次

`GET https://DIO0550.github.io/dev-knowledge/api/docs.json`

```json
{
  "count": 79,
  "docs": [
    {
      "title": "useState と useReducer の使い分け",
      "url": "https://dio0550.github.io/dev-knowledge/docs/react/hooks/useState%E3%81%A8useReducer%E3%81%AE%E4%BD%BF%E3%81%84%E5%88%86%E3%81%91",
      "category": "react/hooks",
      "tags": ["react", "hooks", "useState", "useReducer"],
      "contentUrl": "https://dio0550.github.io/dev-knowledge/api/docs/react/hooks/useState%E3%81%A8useReducer%E3%81%AE%E4%BD%BF%E3%81%84%E5%88%86%E3%81%91.json"
    }
  ]
}
```

### 記事の本文

`GET` で `contentUrl` を辿ると、frontmatter を除いた Markdown 本文が返ります。HTML をパースする必要はありません。

```json
{
  "title": "useState と useReducer の使い分け",
  "url": "...",
  "category": "react/hooks",
  "tags": ["react", "hooks", "useState", "useReducer"],
  "content": "## TL;DR\n\n- まず `useState` が前提。..."
}
```

### タグから引く

`/api/tags.json` が全タグ、その `url` を辿るとそのタグが付いた記事一覧（`docs.json` と同じ形）が返ります。

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

### 注意

- URL は文字列として組み立てず、レスポンスに入っている URL をそのまま辿ってください。タグ名と slug は必ずしも一致せず（`AbortController` → `abort-controller`）、日本語は percent-encode されます。
- 生成しているのは [`dev-knowledge/plugins/json-api.ts`](./dev-knowledge/plugins/json-api.ts)（Docusaurus のローカルプラグイン）です。記事の frontmatter をそのまま使うので、記事を追加すれば次のデプロイで自動的に反映されます。
- 出力はビルド時のみです。ローカルで確認するときは `pnpm start` ではなく `pnpm build && pnpm serve` を使ってください。

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
    │   └── json-api.ts     # AI 向け JSON エンドポイントの生成
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
