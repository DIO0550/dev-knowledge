---
title: フックの getInputProps() パターンで props 素通しを排除する
tags: [react, props, composition, hooks, getInputProps, design-pattern]
---

## TL;DR

- フックがバラバラの値を返し、親コンポーネントが個別に子へ渡す手続き的パターンは、props 過多を生む。
- props 過多を解消しようとして別の props 過多を作るのは本末転倒。
- フック側で `getInputProps()` を返し、`value` / `onChange` / `onKeyDown` / `onBlur` / `ref` / `aria-*` を **1 オブジェクトに束ねる**。コンポーネント側は `<input {...getInputProps()} />` で spread。Downshift / React Hook Form の `getInputProps` と同じアプローチ。

---

## 1. 問題

`ColumnNameInput` が props を 13 個持っていた。

```tsx
type Props = {
  value: string;
  onChange: (e) => void;
  onKeyDown: (e) => void;
  onBlur: (e) => void;
  disabled: boolean;
  "aria-invalid": boolean;
  "aria-describedby": string;
  inputRef: Ref<HTMLInputElement>;
  errorId: string;
  // ...
};
```

そのほぼ全部が**フック出力の素通し**。フックが返した値を親が受け取り、そのまま子 props として並べているだけ。props 過多を解消しようとして、受け渡し用の props 過多を別の場所に作ってしまっている。

## 2. 原因

フックがバラバラの値を返し、親コンポーネントがそれを個別に受け渡すという**手続き的なパターン**が根本。

- フックの出力が増えるたびに、親の受け取り props と子への受け渡し props が両方増える。
- 「フックの内部実装（どの値をどの属性に渡すか）」がコンポーネントの props 一覧に**漏れ出している**。

## 3. 解決

フック側で `getInputProps()` メソッドを返し、`<input>` に渡すべき属性を内部で 1 オブジェクトに束ねる。

```tsx
function useColumnNameInput() {
  // ... value / ref / handlers / aria-* を内部で保持
  return {
    getInputProps: () => ({
      value,
      onChange,
      onKeyDown,
      onBlur,
      ref: inputRef,
      "aria-invalid": hasError,
      "aria-describedby": errorId,
    }),
    // 他に本当に必要な最小限の出力だけ
  };
}
```

コンポーネント側は spread するだけ。

```tsx
function ColumnNameInput() {
  const { getInputProps } = useColumnNameInput();
  return <input {...getInputProps()} />;
}
```

結果、props が **13 → 5** に削減。フックの内部実装が props 一覧から隠れ、`<input>` に必要な属性の束ね方はフックの責務に閉じた。

## 4. 判断のポイント

- コンポーネントの props の大半が「フック出力をそのまま子に渡すだけ」なら、それは素通し。個別 props ではなく `getXxxProps()` で束ねてまとめて spread する。
- この形は Downshift / React Hook Form の `getInputProps` / `register` と同じ確立されたパターン。DOM 要素に渡す属性群（handlers + aria-* + ref）をフックが 1 関数で提供する。
- 「props を減らそうとして受け渡し用 props を増やす」のは本末転倒。減らす対象は数ではなく**素通しという構造**。
