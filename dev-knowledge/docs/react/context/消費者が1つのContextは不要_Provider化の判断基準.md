---
title: 消費者が 1 つなら Context 化は不要 — Provider 化の判断基準
tags: [react, context, over-engineering, state-management, provider]
---

## 問題

`useAppView` を Provider + Context 化したが、実際に `useAppView()` を呼ぶのは `AppShellBody` の 1 コンポーネントだけだった。消費者が 1 つしかいないのに Context を挟んでいた。

## 原因

Context は「複数の離れた子孫」で state を共有するための仕組み。消費者が 1 つしかないなら、次のどちらかで十分。

- props で直接渡す
- state を親コンポーネント内で管理する

消費者が 1 つの Context 化は得が小さいだけでなく、次のような二次的な複雑性を新たに生む。

- Provider をどこに配置するかという問題
- `key` remount による副作用（配下 state の巻き込みリセットなど）
- Provider を挟むための Body コンポーネント分離

## 解決

- Provider は App 直下に hoist し、`Body` の分離は撤去した。
- 今後は「**消費者が本当に複数いるか**」を Context 化の前提条件にする。1 つしかいないなら Context にしない。

## 補足

- 「prop drilling が辛い → 即 Context」ではないという一般論は別記事「Context を使う前に検討すること（コンポジション優先）」を参照。本記事はその中でも特に「消費者が 1 つ」というシンプルな足切り基準の実例。
