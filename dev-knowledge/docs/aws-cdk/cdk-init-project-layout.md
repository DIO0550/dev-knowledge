---
title: cdk init が作る bin と lib と cdk.json の役割
tags: [aws-cdk, typescript, project-structure, directory-structure]
---

## TL;DR

- `cdk init app --language typescript` が作る骨格は `bin/`（App のエントリポイント）・`lib/`（Stack と Construct の定義）・`test/`・`cdk.json` の 4 つが中心。
- `bin/` には「どの Stack をどの環境にいくつ作るか」だけを書き、リソース定義は `lib/` に置く。環境変数や `process.env` を読むのも `bin/` に限定する。
- `cdk.json` と `cdk.context.json` はどちらもアプリの状態の一部なのでコミットする。`cdk.out/` は生成物なので無視する。

## 概要・対象

- 対象：AWS CDK v2（TypeScript）。`cdk init app --language typescript` で生成した直後の構成。
- 生成される主なファイルは次のとおり（アプリ名を `my-app` とした場合）。

```text
my-app/
├── bin/
│   └── my-app.ts          # App のエントリポイント（cdk.json の "app" から起動）
├── lib/
│   └── my-app-stack.ts    # Stack の定義
├── test/
│   └── my-app.test.ts     # Jest によるテンプレートのテスト
├── cdk.json               # CLI の設定（起動コマンド・context・feature flag）
├── cdk.context.json       # lookup 結果のキャッシュ（初回 synth 時などに生成）
├── package.json
├── tsconfig.json
└── jest.config.js
```

## 仕組み・仕様

### bin と lib の分担

`cdk.json` の `"app"` に `npx ts-node --prefer-ts-exts bin/my-app.ts` のような起動コマンドが書かれており、CLI はこれを実行して Construct ツリーを組み立て、`cdk.out/` に CloudFormation テンプレートを出力する（synth）。

- `bin/`：`new App()` して Stack をインスタンス化するだけの層。デプロイ単位（どの Stack を、どのアカウント・リージョンに、いくつ）を決める場所である。
- `lib/`：Stack・Construct のクラス定義。プロパティ（props）で設定を受け取り、自分では環境変数を読まない。

```ts
// bin/my-app.ts — デプロイの配置だけを書く
const app = new cdk.App();
new MyAppStack(app, "MyAppStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-northeast-1" },
});
```

公式ベストプラクティスでも「環境変数の参照はアプリのトップレベルに限定し、Construct や Stack にはプロパティとメソッドで設定を渡す」としている。`lib/` の中で `process.env` を読むと、同じ Construct を別環境・別アプリで再利用できなくなる。

### cdk.json と cdk.context.json

- `cdk.json`：起動コマンド、`watch` の対象、`context`（feature flag や自前の設定値）を持つ。手で編集する設定ファイル。
- `cdk.context.json`：`Vpc.fromLookup()` などの lookup 結果や AZ 一覧を CLI がキャッシュするファイル。手で編集しない。

公式ドキュメントは両方を「アプリの状態の一部」としてコミットするよう求めている。`cdk.context.json` をコミットしないと、CI など別環境での synth が AWS へ再問い合わせし、最新 AMI の取り込みなどで意図しない差分（インスタンス置き換え等）が出る。キャッシュを更新したいときは `cdk context --reset <KEY>` で個別に消して再 synth する。

### .gitignore

生成される `.gitignore` は `*.js`・`*.d.ts`・`node_modules`・`cdk.out` を無視する。`cdk.out/` は synth のたびに作り直される生成物なのでコミットしない。

## 使いどころ・注意点

- 小さいうちは `lib/` 直下に Stack と Construct を並べるだけで十分。育ってきたら論理単位ごとのフォルダに切る（[論理単位ごとにフォルダを切る](./cdk-folder-by-logical-unit.md) を参照）。
- `bin/` にリソース定義を書き始めると、テストから Stack を単体で作れなくなる。`bin/` は「配置表」に留める。
- `test/` のテストは `Template.fromStack()` でテンプレートを検証する。Stack が props だけで組み立てられる設計にしておくとテストで環境を差し替えやすい。

## 参考

- [Best practices for developing and deploying cloud infrastructure with the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Context values and the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/context.html)
