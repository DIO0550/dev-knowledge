# docusaurus-devcontainer-template

Docusaurus + DevContainer のテンプレートリポジトリ。GitHub Pages へ自動デプロイ対応。

## 使い方

1. **Use this template** ボタンからリポジトリを作成
2. GitHub Actions が自動で初期設定を実行
   - `my-site/` がリポジトリ名にリネーム
   - `docusaurus.config.ts` の設定を自動更新
3. Settings → Pages → Source を **GitHub Actions** に設定
4. デプロイ完了後、`https://<owner>.github.io/<repo>/` でアクセス可能

## ローカル開発

DevContainer で開発環境が自動構築されます。

```bash
cd <repo-name>
pnpm install
pnpm start
```

## 構成

- `.devcontainer/` - DevContainer 設定
- `.github/workflows/` - GitHub Actions
  - `setup.yml` - テンプレート初期化（初回のみ実行後削除）
  - `deploy.yml` - GitHub Pages へデプロイ
- `my-site/` - Docusaurus サイト（リポジトリ名にリネームされます）
