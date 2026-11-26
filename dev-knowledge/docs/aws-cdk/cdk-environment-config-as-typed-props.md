---
title: CDK の環境ごとの設定は型付きの設定オブジェクトにして bin から props で渡す
tags: [aws-cdk, typescript, configuration, environment, project-structure]
---

## TL;DR

- dev・stg・prod の差分は `config/` に TypeScript の設定オブジェクトとして置き、`bin/` で選んで Stack の props に渡す。
- Construct や Stack の中で `process.env` や `this.node.tryGetContext()` を読まない。設定の読み取りはトップレベル（`bin/`）だけにする。
- 「どの環境か」の切り替えは `cdk deploy -c env=prod` のような context 1 個で行い、値そのものは型付きファイルに置く。秘密情報は設定ファイルに書かず Secrets Manager・SSM Parameter Store の名前で参照する。

## 背景・射程

- 対象：AWS CDK v2（TypeScript）で、同じ構成を複数環境（アカウント・リージョン）にデプロイするケース。
- 選択肢は主に「環境変数」「`cdk.json` の context」「TypeScript の設定ファイル」の 3 つ。

## 判断軸・比較

| 方式 | 型チェック | 再現性 | 欠点 |
| --- | --- | --- | --- |
| 環境変数（`process.env`） | なし | 実行端末に依存 | CI とローカルで値がずれる。Construct 内で読むと再利用できない |
| `cdk.json` の context | なし（`any`） | コミットされるので高い | 値が JSON で型がなく、ネストが深くなると読みにくい |
| TypeScript の設定ファイル | あり | コミットされるので高い | 環境の選択には別途 context などが必要 |

公式ベストプラクティスは「環境変数ではなくプロパティとメソッドで設定する」「環境変数の参照はアプリのトップレベルに限定する」とし、また「本番を含む全ステージをコードでモデル化する」ことを求めている。設定値をコードに置けば、どの環境に何がデプロイされるかがレビューで見える。

### 構成例

```text
my-app/
├── bin/
│   └── app.ts             # 環境を選んで Stack に渡す
├── config/
│   ├── types.ts           # AppConfig 型
│   ├── dev.ts
│   └── prod.ts
└── lib/
    └── backend-stack.ts   # props で AppConfig を受け取るだけ
```

```ts
// config/types.ts
export type AppConfig = {
  env: { account: string; region: string };
  apiReservedConcurrency: number;
  tableBillingMode: "PAY_PER_REQUEST" | "PROVISIONED";
};

// config/prod.ts
export const prodConfig: AppConfig = {
  env: { account: "111111111111", region: "ap-northeast-1" },
  apiReservedConcurrency: 100,
  tableBillingMode: "PROVISIONED",
};
```

```ts
// bin/app.ts — 設定を読むのはここだけ
const configs = { dev: devConfig, prod: prodConfig } satisfies Record<string, AppConfig>;
const envName = app.node.tryGetContext("env") ?? "dev";
const config = configs[envName as keyof typeof configs];
if (!config) throw new Error(`unknown env: ${envName}`);

new BackendStack(app, `Backend-${envName}`, { env: config.env, config });
```

### 「全環境を一度に定義する」方式

環境の選択すら context にせず、`bin/` で全環境分の Stack（または Stage）を常にインスタンス化し、`cdk deploy Backend-prod` のように Stack 名でデプロイ先を選ぶ方式もある。CDK Pipelines を使う場合はこちらが自然で、synth 結果に全環境が含まれるので差分の確認もしやすい。

## 指針

- 環境差分は `config/<env>.ts` に型付きで書き、`AppConfig` 型で漏れをコンパイル時に検出する。
- `lib/` 以下は props だけで動くようにし、`process.env`・`tryGetContext` を書かない。テストでは設定オブジェクトを直接渡せばよい。
- アカウント ID・リージョンは `env` に明示する（env-agnostic にすると `fromLookup` が使えず、AZ 数なども決め打ちになる）。
- パスワード・API キーは設定ファイルに置かず、Secrets Manager や SSM Parameter Store の名前・ARN だけを設定に持つ。
- Stack の並べ方は [デプロイ要件で Stack を分ける](./cdk-split-stacks-by-deployment-requirements.md) の Stage と組み合わせる。

## 参考

- [Best practices for developing and deploying cloud infrastructure with the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Context values and the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/context.html)
- [Environments for the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/environments.html)
