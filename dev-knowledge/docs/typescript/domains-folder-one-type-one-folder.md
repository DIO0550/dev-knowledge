---
title: domains フォルダは「1 型名 = 1 フォルダ（index.ts + __tests__）」で切る
tags: [typescript, project-structure, domain, folder-convention, frontend]
---

## 問題

`TaskLinks` の 600 行の `index.ts` を分割する際、最初は**責務名ファイル**で分割した。

```text
domains/TaskLinks/
  index.ts          # 巨大
  plan.ts           # 責務名
  linkOperation.ts  # 責務名
  candidates.ts     # 責務名
```

## 原因

責務名ファイル（`plan.ts` / `linkOperation.ts` 等）だと、

- どれが公開 API で、どれが内部実装なのかがファイル名から読み取れない。
- 「この型はどこ？」を探すとき、型名とファイル名が一致しないので毎回中身を開く必要がある。

一方、**型名でフォルダを切れば、フォルダ名がそのまま型名になり自明**になる。

## 解決

**型単位でフォルダを切り、中に `index.ts` + `__tests__/` を置く**。ルートの `index.ts` は re-export のみにする。

```text
domains/TaskLinks/
  index.ts                 # re-export のみ（公開境界）
  TaskLinks/
    index.ts               # TaskLinks 型の実装
    __tests__/
      TaskLinks.test.ts
  LinkOperation/
    index.ts               # LinkOperation 型の実装
    __tests__/
  LinkIntent/
    index.ts
    __tests__/
```

```ts
// domains/TaskLinks/index.ts — re-export のみ
export * from "./TaskLinks";
export * from "./LinkOperation";
export * from "./LinkIntent";
```

- フォルダ名 = 型名なので、`LinkOperation` を探すなら `LinkOperation/` を開けばよい。
- テストが型の隣（`__tests__/`）にあり、型と一対一で対応する。
- ルート `index.ts` が「このドメインの公開 API 一覧」になり、境界が明確。

## 教訓

- ドメイン配下は「責務名」ではなく「型名」でフォルダを切る。フォルダ名が型名と一致すると、探索・公開境界の判断が名前だけで済む。
- ルートの `index.ts` は re-export に徹し、実装を持たせない（公開境界の役割に専念させる）。
- テストは型フォルダ内の `__tests__/` に置き、型と一対一に保つ。
