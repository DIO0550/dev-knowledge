---
title: Object.hasOwn() は ES2022 — ES2020 ターゲットだとコンパイルエラー
tags: [typescript, javascript, es2020, es2022, object-hasown, compatibility]
---

## 問題

`LabelDefinition` ドメインの adapter 実装で `Object.hasOwn(obj, key)` を使ったところ、
ES2020 ターゲットのプロジェクトでコンパイルエラーになった。

```ts
// tsconfig: target/lib が ES2020
const has = Object.hasOwn(obj, key);
// error: Property 'hasOwn' does not exist on type 'ObjectConstructor'.
```

## 原因

`Object.hasOwn` は **ES2022** で追加された API。
tsconfig の `target` / `lib` が `ES2020` だと型定義に存在せず利用できない。

- 実行環境が新しくても、TypeScript の `lib` 設定が古ければ型エラーになる。
- フォーマッタや補完が `hasOwnProperty` からの書き換え候補として
  `Object.hasOwn` を自動挿入してしまい、気付かず混入するケースもある。

## 解決

`Object.prototype.hasOwnProperty.call(obj, key)` に置換する。
これは ES2020 以前から利用でき、`obj` が `hasOwnProperty` を自前で
上書きしている場合でも安全に判定できる。

```ts
// 動く例（ES2020 でも可）
const has = Object.prototype.hasOwnProperty.call(obj, key);
```

`lib` を `ES2022` 以上に引き上げられるなら `Object.hasOwn` をそのまま使ってよい。
プロジェクトのターゲットを変えられない場合は上記の置換で対応する。

## 環境・再現条件

- tsconfig の `target` / `lib` が `ES2020`。
- `Object.hasOwn` は ES2022 で追加。`lib` が `ES2022` 以上でないと型定義に無い。
