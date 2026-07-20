---
title: domains の分割は「1 型名 = 1 フォルダ（index.ts + __tests__）」で切る
tags: [typescript, project-structure, domain, folder-convention, frontend, ddd]
---

## 問題

`TaskLinks` の 600 行ある `index.ts` を分割することにした。
最初は「責務名」でファイルを切った。

```
domains/taskLinks/
  index.ts          // まだ肥大
  plan.ts           // 責務名で分割
  linkOperation.ts
  candidates.ts
```

分割はしたものの、ファイル名を見ても
「どれが公開 API で、どれが内部実装か」がひと目で分からなかった。

## 原因

責務名（`plan.ts` / `linkOperation.ts` / `candidates.ts`）でファイルを切ると、
名前が「処理の役割」を表すだけで、そのファイルが**外に公開する型なのか、
内部の実装詳細なのか**を名前から判別できない。

- 責務名は主観的に増えていくため、粒度も揺れやすい。
- 型と実装が同じ階層に混在し、境界が曖昧になる。

一方、**型名でフォルダを切れば、フォルダ名がそのまま公開する型名**になる。
「このフォルダ = この型」という対応が自明になり、公開境界が名前で表現される。

## 解決

**型単位でフォルダを切り**、その中に `index.ts` と `__tests__/` を置く。
ルート（ドメイン直下）の `index.ts` は **re-export のみ**にして、
何を公開しているかの一覧＝目次として機能させる。

```
domains/taskLinks/
  index.ts              // re-export のみ（公開 API の目次）
  TaskLinks/
    index.ts            // TaskLinks 型と、その companion 実装
    __tests__/
  LinkOperation/
    index.ts
    __tests__/
  LinkIntent/
    index.ts
    __tests__/
```

```ts
// domains/taskLinks/index.ts — re-export のみ
export * from "./TaskLinks";
export * from "./LinkOperation";
export * from "./LinkIntent";
```

これにより次が得られる。

- フォルダ名 = 公開する型名なので、ディレクトリツリーがそのままドメインの型一覧になる。
- 各型のテスト（`__tests__/`）が型のフォルダ内に閉じ、実装とテストの距離が近い。
- ルート `index.ts` を見れば、そのドメインが公開している型が一覧できる。

責務名ファイル（`plan.ts` など）は、あくまで**型フォルダ内部の実装詳細**として
必要になったときだけ切る。外向きの分割単位は「型」に統一する。

## 環境・再現条件

- TypeScript（フロントエンド）のドメイン層設計。
- 特定のライブラリには依存しない、フォルダ構成の規約。
- 出典: 自プロジェクト（Tauri + React 構成）の `TaskLinks` ドメイン分割時の知見。
