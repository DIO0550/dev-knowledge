---
title: DnD props の「全部素通し」分析 — 真の素通しは 2 props だけだった
tags: [react, prop-drilling, dnd, code-analysis, refactoring]
---

## 問題

`Board → Column → TaskCard` の DnD 系 7 props が全部バケツリレー（素通し）に見え、「Context 化で一掃できる」と判断した。

## 原因

実際にコードを読み直すと、7 props の消費実態はバラバラだった。

- `dragState` は **Board が `useReducer` で所有**している（素通しではなく所有）。
- `onDragHover` / `onTaskDrop` / `onColumnDrop` は **Column 自身が消費**している（素通しではない）。
- 本当に素通しなのは `onTaskDragStart` / `onTaskDragEnd` の **2 props だけ**。

最初の「7 props 全部素通し」という分析は不正確で、各層が実際に何を使っているかを確認していなかった。

## 解決

- Provider 分割で整理はするが、スコープを **「真の素通し 2 props + 関連 state の Context 化」** に修正した。
- 教訓: prop drilling を Context 化する前に、**各層でその prop が「所有・消費・素通し」のどれなのかを 1 つずつ確認**する。見た目の props 数ではなく消費実態でリファクタ範囲を決める。

| props | 実態 | Context 化対象か |
| --- | --- | --- |
| `dragState` | Board が所有（useReducer） | 状態として Context 化を検討 |
| `onDragHover` / `onTaskDrop` / `onColumnDrop` | Column が消費 | 素通しではない → 対象外 |
| `onTaskDragStart` / `onTaskDragEnd` | 真の素通し | Context 化の主対象 |

## 環境

- React（DnD、prop drilling / Context 化のリファクタ判断）
