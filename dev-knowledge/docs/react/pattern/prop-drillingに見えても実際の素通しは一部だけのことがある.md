---
title: prop-drilling に見えても実際の素通しは一部だけのことがある
tags: [react, prop-drilling, dnd, code-analysis, refactoring]
---

## TL;DR

- 「多層に渡っている props = 全部バケツリレー」と早合点しない
- 各層で props が **消費されているか / 素通しているか** を実コードで確認する
- Context 化などのリファクタ範囲は「真の素通し props」だけに絞る

## 問題

Board → Column → TaskCard の DnD 系 7 props が全部バケツリレーに見え、「Context 化で一掃できる」と判断した。多層に渡っている props をまとめて数え、全部が素通しだと決めつけていた。

## 原因

実際にコードを読むと、7 props のうち大半は途中の層で消費されていた。

| props | 実態 |
| --- | --- |
| `dragState` | Board が `useReducer` で所有（素通しではなく起点） |
| `onDragHover` / `onTaskDrop` / `onColumnDrop` | Column 自身が消費 |
| `onTaskDragStart` / `onTaskDragEnd` | Column を素通りして TaskCard へ（真の素通し） |

真の素通しは `onTaskDragStart` / `onTaskDragEnd` の **2 props のみ**。最初の「7 props 全部素通し」という分析は不正確で、`dragState` の所有者（＝ state の起点）や、Column が実際に消費している props まで「素通し」に含めて数えていた。

## 解決

Provider 分割で整理する方針は維持しつつ、スコープを「真の素通し 2 props + 関連 state（`dragState`）の Context 化」に修正した。消費されている props まで Context に巻き込むと、責務が曖昧になり、かえって見通しが悪くなる。

### 教訓

- リファクタリング前に、各層での props 消費実態を正確に分析する
  - その層で **読んで使っているか**（消費）
  - その層は素通しさせて **子で使っているか**（真の素通し）
  - その層が **所有している state か**（起点。素通しではない）
- 「props が多い」「多層に渡る」だけを根拠に Context 化の範囲を決めない。素通しの実数を数えてから範囲を確定する。

## 補足

- 素通し props が本当に少数（2 個程度）なら、Context 化せず素直に props で渡すほうが単純なこともある。範囲を正しく測ってはじめて「Context 化する / しない」の判断ができる。
