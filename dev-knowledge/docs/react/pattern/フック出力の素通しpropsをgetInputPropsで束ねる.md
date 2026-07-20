---
title: フック出力の素通し props を getInputProps() で束ねる
tags: [react, props, composition, hooks, getInputProps, design-pattern]
---

## TL;DR

- フックがバラバラの値を返し、親コンポーネントが個別に props として受け渡すと、素通し props が増えて Props 過多になる
- フック側で `getInputProps()` を返し、`value` / `onChange` / `onKeyDown` / `onBlur` / `ref` / `aria-*` を 1 オブジェクトに束ねる
- コンポーネントは `{...getInputProps()}` で spread するだけ。Downshift / React Hook Form と同じアプローチ

## 問題

`ColumnNameInput` が props を 13 個（`value` / `onChange` / `onKeyDown` / `onBlur` / `disabled` / `aria-*` / `inputRef` / `errorId` …）持ち、そのほぼ全部がフック出力の素通しだった。

Props 過多を解消しようとして、フックの戻り値を個別に受け渡す形にした結果、コンポーネント側で別の props 過多を作ってしまう。本末転倒。

## 原因

フックがバラバラの値を返し、親コンポーネントがそれを個別に受け取って子へ渡す、という手続き的なパターンになっていた。

フックの出力とコンポーネントの入力が 1:1 で対応しているのに、その対応を「個別の props」という粒度で毎回手で繋いでいるのが無駄。フックの内部関心（どの属性を input に渡すべきか）がコンポーネント側に漏れている。

## 解決

フック側で `getInputProps()` メソッドを返し、input に渡すべき属性（`value` / `onChange` / `onKeyDown` / `onBlur` / `ref` / `aria-*`）を 1 オブジェクトに束ねる。コンポーネント側は spread するだけ。

### Before（素通し props が並ぶ）

```tsx
function useColumnNameInput(/* ... */) {
  // ...
  return { value, onChange, onKeyDown, onBlur, disabled, ref, ariaInvalid, errorId /* ... */ };
}

function ColumnNameInput() {
  const {
    value, onChange, onKeyDown, onBlur, disabled, ref, ariaInvalid, errorId,
  } = useColumnNameInput(/* ... */);

  return (
    <input
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      disabled={disabled}
      ref={ref}
      aria-invalid={ariaInvalid}
      aria-describedby={errorId}
    />
  );
}
```

### After（getInputProps で束ねる）

```tsx
function useColumnNameInput(/* ... */) {
  // ...
  const getInputProps = () => ({
    value,
    onChange,
    onKeyDown,
    onBlur,
    ref,
    "aria-invalid": ariaInvalid,
    "aria-describedby": errorId,
  });

  return { getInputProps /* 表示用の値など、束ねられないものだけ個別に */ };
}

function ColumnNameInput() {
  const { getInputProps } = useColumnNameInput(/* ... */);
  return <input {...getInputProps()} />;
}
```

Props は 13 → 5 に削減。フックの内部関心（どの属性を input に渡すか）がフック側に閉じ、コンポーネントは spread するだけになる。

## 補足

- これは Downshift（`getInputProps` / `getMenuProps` …）や React Hook Form（`register` の返り値 spread）と同じアプローチ。「props 返し hook」の慣行に沿っている。
- 束ねるのは「そのまま同じ要素に渡る属性群」だけ。表示ロジックや条件分岐が必要な値まで無理に束ねない。
- `getInputProps({ onChange: myHandler })` のように呼び出し側の値をマージできる形にしておくと、イベントハンドラの合成にも対応できる。
