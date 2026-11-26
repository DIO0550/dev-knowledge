---
title: モノレポで CDK を使うときはインフラを 1 パッケージにまとめ Lambda のロックファイルを明示する
tags: [aws-cdk, typescript, monorepo, pnpm, project-structure, lambda]
---

## TL;DR

- AWS の推奨は「1 アプリ = 1 パッケージ・1 リポジトリから始め、ライフサイクルや所有チームが分かれたときだけ分割する」。同じリポジトリに複数の CDK アプリを置くことは推奨されていない。
- フロントエンドや共通ライブラリと同居させるモノレポでは、CDK アプリを `infra/` のような 1 パッケージにし、Lambda 本体はその中の論理単位フォルダか、ワークスペースの別パッケージに置く。
- `NodejsFunction` はロックファイルを探してバンドルの基準ディレクトリ（`projectRoot`）を決める。ワークスペースでは `depsLockFilePath` にルートの `pnpm-lock.yaml` を明示すると、どこから実行しても結果が揃う。

## 背景・射程

- 対象：AWS CDK v2（TypeScript）を pnpm workspaces などの JS/TS モノレポに組み込むケース。
- 「リポジトリ・パッケージをどう分けるか」と「Lambda のコードをどこに置くか」の判断。

## 判断軸・比較

### AWS の推奨

公式ベストプラクティスは次の順で育てることを勧めている。

- 全アプリは単一リポジトリの単一パッケージから始める。このパッケージがエントリポイントで、デプロイ方法と CI/CD を定義する。
- 複数アプリを同じリポジトリに置くことは「可能だが推奨しない」。1 アプリの変更が他アプリのデプロイを誘発するため。
- コードのライフサイクルや所有チームが分かれたらリポジトリを分け、共有 Construct はパッケージ化してプライベートレジストリ（CodeArtifact など）で配布する。
- インフラとランタイムのコードは同じパッケージに置く。Lambda 本体を別リポジトリにする必要はない。

### モノレポでの置き方の比較

```text
# パターン 1: Lambda 本体を infra パッケージ内に同居
repo/
├── apps/web/              # フロントエンド
├── infra/                 # CDK アプリ（package.json を持つ）
│   ├── bin/app.ts
│   └── lib/api/
│       ├── runtime/handler.ts
│       └── api.ts
├── pnpm-workspace.yaml
└── pnpm-lock.yaml

# パターン 2: Lambda 本体を別パッケージに分離
repo/
├── apps/web/
├── packages/api-handlers/ # Lambda 本体（ドメインロジックを web と共有したい）
├── infra/
│   └── lib/api/api.ts     # entry で ../packages/api-handlers を指す
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

| 観点 | パターン 1（同居） | パターン 2（分離） |
| --- | --- | --- |
| 変更の局所性 | 1 フォルダで完結 | 2 パッケージにまたがる |
| フロントエンドとの型・ロジック共有 | `infra` に依存させることになり不自然 | 共有パッケージとして自然に参照できる |
| Lambda の依存管理 | `infra` の依存に混ざる | ハンドラ側の `package.json` で分けられる |
| 推奨度 | AWS の推奨に沿う。まずこちら | 共有の必要が出たら |

### NodejsFunction とロックファイル

`NodejsFunction` は esbuild でバンドルする際、ロックファイル（`pnpm-lock.yaml`・`yarn.lock`・`package-lock.json` など）を探し、その場所を既定の `projectRoot` にする。ロックファイルは原則ワークスペースのルートに 1 つしかないので、探索に任せると CDK を実行したディレクトリによって見つからない・意図しないものが見つかる、といった差が出る。

```ts
import * as path from "node:path";

const repoRoot = path.join(__dirname, "../../..");
new NodejsFunction(this, "Handler", {
  entry: path.join(__dirname, "runtime/handler.ts"),
  depsLockFilePath: path.join(repoRoot, "pnpm-lock.yaml"),
  projectRoot: repoRoot, // 省略時は depsLockFilePath のディレクトリ
});
```

Docker バンドルを使う場合は `projectRoot` がコンテナにマウントされる範囲になるので、ハンドラが参照する全パッケージを含むディレクトリ（通常はリポジトリのルート）にする。

## 指針

- まず CDK アプリは `infra/` の 1 パッケージに置き、Lambda 本体は論理単位フォルダの `runtime/` に同居させる。
- フロントエンドなどとロジックや型を共有する必要が出たら、ハンドラを別パッケージに切り出す。
- 1 リポジトリに複数の CDK アプリ（`cdk.json`）を置くのは避ける。必要なら所有単位でリポジトリを分ける。
- `NodejsFunction` では `depsLockFilePath`（必要なら `projectRoot`）をワークスペースのルート基準で明示する。

## 参考

- [Best practices for developing and deploying cloud infrastructure with the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [aws-cdk-lib.aws_lambda_nodejs module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html)
