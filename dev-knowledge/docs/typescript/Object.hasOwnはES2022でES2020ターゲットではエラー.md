---
title: Object.hasOwn() は ES2022 — ES2020 ターゲットでコンパイルエラー
tags: [typescript, javascript, es2020, es2022, Object.hasOwn, compatibility]
---

## 問題

`LabelDefinition` ドメインの adapter 実装で `Object.hasOwn(obj, key)` を使ったところ、ES2020 ターゲットのプロジェクトでコンパイルエラーになった。

```ts
if (Object.hasOwn(obj, key)) { /* ... */ }
// error: Property 'hasOwn' does not exist on type 'ObjectConstructor'.
```

## 原因

`Object.hasOwn` は **ES2022** で追加された API。`tsconfig.json` の `target` / `lib` が `ES2020`（以前）だと型定義に含まれず利用できない。フォーマッタや補完が `hasOwnProperty` の代わりに `Object.hasOwn` を自動挿入してしまい、気付かず混入するケースもある。

## 解決

`Object.prototype.hasOwnProperty.call(obj, key)` に置換する（どの ES ターゲットでも動く）。

```ts
// before（ES2022 必須）
if (Object.hasOwn(obj, key)) { /* ... */ }

// after（ES2020 でも可）
if (Object.prototype.hasOwnProperty.call(obj, key)) { /* ... */ }
```

- 恒久的に `Object.hasOwn` を使いたい場合は `tsconfig` の `target`/`lib` を `ES2022` 以上へ引き上げる。ただしランタイム（実行環境）が対応しているかも合わせて確認する。

## 環境

- TypeScript、`tsconfig` の `target`/`lib` = `ES2020`
- `Object.hasOwn`: ES2022 で追加
