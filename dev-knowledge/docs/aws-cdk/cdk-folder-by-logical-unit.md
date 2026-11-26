---
title: CDK のフォルダはリソース種別ではなく論理単位ごとに切る
tags: [aws-cdk, typescript, project-structure, directory-structure, architecture, construct]
---

## TL;DR

- `lib/` を `lambda/`・`dynamodb/`・`iam/` のようにリソース種別で分けると、1 機能の変更が複数フォルダに散らばる。
- AWS は API・データベース・監視のような論理単位ごとにフォルダを切り、そこにインフラ定義・ランタイムコード（Lambda 本体など）・設定をまとめる構成を推奨している。
- 論理単位は Stack ではなく Construct として実装する。Stack は「どう並べてデプロイするか」を決める薄い層にする（Model with constructs, deploy with stacks）。

## 背景・射程

- 対象：AWS CDK v2（TypeScript）で、1 つのアプリが複数の機能（API・DB・バッチ・監視など）を持ち始めた段階。
- `cdk init` 直後の `lib/` 1 ファイル構成から、どう分割していくかの判断。
- AWS 公式ブログの推奨構成は Python 版で示されている。以下の TypeScript 版はその構成を移し替えたものである。

## 判断軸・比較

### 2 つの切り方

```text
# ❌ リソース種別で切る
lib/
├── lambda/        # 全機能の Lambda が混在
├── dynamodb/      # 全機能のテーブルが混在
├── iam/
└── my-app-stack.ts

# ✅ 論理単位で切る（インフラ・ランタイム・設定を同居させる）
lib/
├── api/
│   ├── runtime/           # Lambda ハンドラの本体
│   │   └── handler.ts
│   └── api.ts             # export class Api extends Construct
├── database/
│   └── database.ts        # export class Database extends Construct
├── monitoring/
│   └── monitoring.ts
└── backend-stack.ts       # 上の Construct を組み合わせる Stack
```

| 観点 | リソース種別で切る | 論理単位で切る |
| --- | --- | --- |
| 1 機能の変更範囲 | 複数フォルダにまたがる | 1 フォルダに閉じる |
| 権限付与（`grant*`）の書き場所 | どこに書くか曖昧になる | 単位の境界（props）で受け渡す |
| 別 Stack・別パッケージへの切り出し | 単位がないので難しい | フォルダごと移せる |
| 所有チームの分割 | 不向き | フォルダ＝所有単位にできる |

AWS 公式ブログは「論理単位ごとにディレクトリを持ち、関連するインフラ・ランタイム・設定のコードを含める」ことを推奨し、理由として「その単位のコードが見つけやすく、リファクタや所有単位の切り出しを 1 箇所でできる」ことを挙げている。

### 論理単位を Stack にしない理由

論理単位をいきなり `Stack` で作ると、「API は API Stack」のようにデプロイ単位が機能単位に固定される。Construct で作っておけば、開発環境では 1 Stack にまとめ、本番ではデータ層だけ別 Stack にする、といった配置の差を Stack 側だけで吸収できる。

```ts
// lib/backend-stack.ts — 論理単位を組み合わせるだけ
export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);
    const database = new Database(this, "Database", props.database);
    new Api(this, "Api", { table: database.table, ...props.api });
    new Monitoring(this, "Monitoring", { table: database.table });
  }
}
```

### ランタイムコードを同居させる

公式ベストプラクティスは「インフラとランタイムのコードは同じパッケージに置く」としている。`NodejsFunction` の `entry` に同じフォルダの `runtime/handler.ts` を指定すれば、Lambda 本体とそれをデプロイする定義が一緒にテスト・バージョン管理される。ランタイムを別リポジトリに分ける必要はない。

## 指針

- 最初は `lib/` 直下にフラットに置き、Construct が 3〜4 個を超えたら論理単位のフォルダに切る。
- 論理単位は `Construct` を継承したクラスにし、単位間の依存（テーブルを API に渡す等）は props で受け渡す。
- `Stack` は論理単位の組み合わせとデプロイ配置だけを書く。Stack の分け方は [デプロイ要件で Stack を分ける](./cdk-split-stacks-by-deployment-requirements.md) を参照。
- 単位が大きくなったら `api.ts` を `api/infrastructure/` のようなフォルダに育ててよい。ただしフォルダ移動で Construct のパスを変えるとリソースが置き換わることがある（[Construct の移動で論理 ID が変わる](./cdk-moving-construct-changes-logical-id.md)）。

## 参考

- [Recommended AWS CDK project structure for Python applications](https://aws.amazon.com/blogs/developer/recommended-aws-cdk-project-structure-for-python-applications/)
- [Best practices for developing and deploying cloud infrastructure with the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
