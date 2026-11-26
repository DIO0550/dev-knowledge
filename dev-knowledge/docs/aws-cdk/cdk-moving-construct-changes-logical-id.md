---
title: CDK で Construct をフォルダ整理や Stack 移動で動かすと論理 ID が変わりリソースが作り直される
tags: [aws-cdk, typescript, refactoring, cloudformation, logical-id]
---

## TL;DR

- CloudFormation の論理 ID は Construct ツリー上のパス（親 Construct の ID の連なり）から計算される。ファイルを動かすだけなら変わらないが、ラッパー Construct で包む・ID を変える・別 Stack に移すと変わる。
- 論理 ID が変わると CloudFormation は「旧リソースを削除して新リソースを作成」と解釈する。DB や S3 では実データが失われるか、保持設定で孤立したリソースが残る。
- 構造変更の前後で必ず `cdk diff` を見る。回避策はラッパー内の主リソースの ID を `Default` にする、`overrideLogicalId()` で固定する、`cdk refactor`（プレビュー）で移動として扱わせる、のいずれか。

## 遭遇した問題

[論理単位でフォルダを切る](./cdk-folder-by-logical-unit.md) 整理の一環で、Stack 直下にあった DynamoDB テーブルを `Database` Construct に包んだ。

```ts
// Before: Stack 直下
new dynamodb.Table(this, "Table", { /* ... */ });

// After: Database Construct の中へ
export class Database extends Construct {
  readonly table: dynamodb.Table;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new dynamodb.Table(this, "Table", { /* ... */ });
  }
}
new Database(this, "Database");
```

`cdk diff` に既存テーブルの `[-]` 削除と新しいテーブルの `[+]` 作成が出た。`tableName` を固定していた場合は、同名リソースの作成でデプロイ自体が失敗する。

## 原因

- CDK は論理 ID を Construct のパス（例：`Database/Table`）から「パスを連結した文字列 ＋ パスのハッシュ 8 桁」として生成する。`Table` → `Database/Table` になれば論理 ID も `TableCD117FA1`（例）から `DatabaseTable` で始まる別の ID に変わる。
- CloudFormation はリソースを論理 ID で識別するため、論理 ID が変わったリソースは別物として扱われ、置き換え（作成＋削除）になる。
- 別 Stack への移動も同様で、移動元 Stack では削除、移動先 Stack では新規作成になる。
- 公式ベストプラクティスも「ステートフルリソースの論理 ID を変えない」「ステートフルリソースを名前が変わりそうな Construct の中に入れない」と注意している。

一方、TypeScript ファイルの場所（`lib/` から `lib/database/` への移動など）や import の変更は Construct ツリーに影響しないので論理 ID は変わらない。変わるのは「どの親の下に、どの ID で new したか」である。

## 解決

### 1. 主リソースの ID を Default にする

Construct ID が `Default` の子は論理 ID の計算でパスから除かれる。ラッパーを作るときに主リソースを `Default` で作れば、包んでも論理 ID が保たれやすい（ラッパーの ID を元のリソース ID と同じにする必要がある）。

```ts
// Stack 直下の "Table" を、ID "Table" のラッパーで包み、中身を "Default" にする
export class Database extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.table = new dynamodb.Table(this, "Default", { /* ... */ }); // パスは Table/Default → Table と同じ扱い
  }
}
new Database(this, "Table");
```

### 2. overrideLogicalId で固定する

L1 リソースの論理 ID を旧 ID に直接上書きする。確実だが、ID がコードに直書きされて残る。

```ts
const cfnTable = this.table.node.defaultChild as dynamodb.CfnTable;
cfnTable.overrideLogicalId("TableCD117FA1"); // cdk diff で確認した旧 ID
```

### 3. cdk refactor を使う

`cdk refactor` は「デプロイ済みと同じリソース集合で、Construct ツリー上の位置だけが違う」ことを検出し、CloudFormation のリファクタリング API でリソースを作り直さずに論理 ID の変更や Stack 間移動を行う。2025 年に追加されたコマンドで、執筆時点ではプレビューのため `--unstable=refactor` が必要。

```bash
cdk refactor --unstable=refactor --dry-run   # 計画だけ表示
cdk refactor --unstable=refactor             # 確認後に適用
```

制約として、リファクタはプロパティ変更やリソース追加・削除と同じデプロイに混ぜられない。また同一環境（アカウント・リージョン）内の移動に限られる。同じ形のリソースが複数あり対応が曖昧なときは `--override-file` で旧パスと新パスの対応を明示する。

### 運用上の指針

- フォルダ整理・Construct 化は「コード整理だけのコミット」に分け、`cdk diff` で `[-]`・`[+]` の置き換えが出ないことを確認してからマージする。
- ステートフルリソースには `removalPolicy: RETAIN` を付けておき、万一置き換えが走っても実体が消えないようにする。
- テストで `Template.fromStack()` の論理 ID をスナップショットしておくと、意図しない ID 変化を CI で検出できる。

## 参考

- [Best practices for developing and deploying cloud infrastructure with the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Preserve deployed resources when refactoring CDK code](https://docs.aws.amazon.com/cdk/v2/guide/refactor.html)
- [Identifiers and the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/identifiers.html)
