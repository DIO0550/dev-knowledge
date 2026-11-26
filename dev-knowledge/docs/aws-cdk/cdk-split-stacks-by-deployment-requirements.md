---
title: CDK の Stack は機能ではなくデプロイ要件で分ける
tags: [aws-cdk, typescript, architecture, stack, cloudformation]
---

## TL;DR

- Stack はデプロイの単位であり、機能ごとに分ける必要はない。分けるのはデプロイのタイミング・ライフサイクル・権限・保護レベルが違うときだけにする。
- 典型的な分割は「ステートフル（DB・S3・Cognito など）」と「ステートレス（Lambda・API など）」。ステートフル側には termination protection を付ける。
- Stack をまたぐ参照は CloudFormation の Export/Import になり、参照中の値を変えられない「デッドロック」を起こしやすい。分割は最小限にし、参照は一方向に揃える。

## 背景・射程

- 対象：AWS CDK v2（TypeScript）。1 Stack で始めたアプリを分割するか迷う段階。
- 論理単位の分け方（フォルダ・Construct）とは別の話で、ここで扱うのは「Construct をどの Stack に載せるか」である。

## 判断軸・比較

### 分ける理由になるもの・ならないもの

| 分ける理由になる | 分ける理由にならない |
| --- | --- |
| ライフサイクルが違う（DB はほぼ変えないが API は毎日デプロイ） | 機能やチームが違う（Construct とフォルダで分ければよい） |
| 削除・置き換えから守りたい（ステートフル） | ファイルが長い |
| デプロイ先のアカウント・リージョンが違う | 「1 Stack = 1 マイクロサービス」と決めたから |
| CloudFormation のリソース上限（1 Stack 500 個）に近い | |

公式ベストプラクティスは「デプロイ要件に応じてアプリを複数 Stack に分ける」とし、具体例としてデータベースなどのステートフルリソースを別 Stack に置いて termination protection を有効にすることを挙げている。

### ステートフル／ステートレス分割

```ts
// bin/app.ts
const stateful = new StatefulStack(app, "Stateful", {
  env,
  terminationProtection: true,
});
new StatelessStack(app, "Stateless", {
  env,
  table: stateful.table, // ステートフル → ステートレスの一方向だけ
});
```

- ステートレス側は壊しても作り直せるので、`cdk destroy` や大きな変更を気軽に試せる。
- ステートフル側は変更頻度が低く、レビューを厳しくできる。

### Stack 間参照の落とし穴

Stack A の値（テーブル名など）を Stack B が使うと、CDK は自動で A に `Export`、B に `Fn::ImportValue` を生成する。CloudFormation は「他 Stack から Import されている Export は変更・削除できない」ので、次の流れで詰まる。

1. B が A のリソースを参照しなくなるコード変更をする。
2. CDK は A の Export を消そうとし、B はまだ旧テンプレートのまま Import している。
3. 依存順で A が先にデプロイされ、`Export ... cannot be deleted as it is in use by ...` で失敗する。

回避策は、A 側で `this.exportValue(table.tableName)` を一時的に残して B を先にデプロイし、次のデプロイで消す 2 段階デプロイである。参照が双方向・多段になるほどこの作業が増えるので、参照はステートフル → ステートレスの一方向に揃える。参照を Stack 間でなく SSM Parameter Store 経由にして疎結合にする手もある。

### 環境ごとに Stack をまとめる Stage

同じ Stack の組を dev・prod など複数環境に並べるときは `cdk.Stage` で包む。Stage 内の Stack 名は `<Stage名>-<Stack ID>` になり、CDK Pipelines のデプロイ単位にもなる。

```ts
class AppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props);
    const stateful = new StatefulStack(this, "Stateful", { terminationProtection: true });
    new StatelessStack(this, "Stateless", { table: stateful.table });
  }
}
new AppStage(app, "Dev", { env: devEnv });
new AppStage(app, "Prod", { env: prodEnv });
```

## 指針

- 1 Stack から始める。分割は「ライフサイクル・保護・デプロイ先」が違うと分かった時点で行う。
- 最初に切るならステートフル／ステートレス。ステートフル Stack には `terminationProtection: true` と適切な `removalPolicy` を付ける。
- Stack 間参照は一方向にし、参照を外すときは `exportValue` を使った 2 段階デプロイにする。
- 既存リソースを別 Stack に移すとリソースの作り直しになる。移動は `cdk refactor` などで慎重に行う（[Construct の移動で論理 ID が変わる](./cdk-moving-construct-changes-logical-id.md)）。

## 参考

- [Best practices for developing and deploying cloud infrastructure with the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Stacks - AWS CDK v2 Developer Guide](https://docs.aws.amazon.com/cdk/v2/guide/stacks.html)
