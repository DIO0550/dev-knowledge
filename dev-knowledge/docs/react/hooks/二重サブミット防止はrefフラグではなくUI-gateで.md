---
title: "React: 二重サブミット防止はuseRefフラグではなくUI gateで"
tags: [react, typescript, useref, anti-pattern, double-submission, useactionstate, usetransition, react-19, disabled, form, custom-hook]
---

## TL;DR

- 「処理中は再実行をブロックしたい」を `useRef` フラグで実装するのはアンチパターン。
- ボタン経由なら `useState` + `disabled`、formなら React 19 の `useActionState`、任意の非同期処理なら `useTransition` の `isPending` で十分。
- `useRef` が本当に必要なのは `disabled` で interceptできない場面（global keydown 等）に限られる。

## 遭遇した問題

送信ボタン連打で二重サブミットしたくない。`useState(isSubmitting)` で書くと:

```ts
const [isSubmitting, setIsSubmitting] = useState(false);

const handleSubmit = async () => {
  if (isSubmitting) return;       // ❌ 古い値を読んでる可能性
  setIsSubmitting(true);          // ❌ 次のrenderで反映、同じevent loop tickでは効かない
  await submitOrder();
  setIsSubmitting(false);
};
```

連打されたとき `isSubmitting` がまだ `false` のままで素通りしてしまう。そこで「即座に変更でき、読み取りも同期的なref」に手が伸びる:

```ts
const isSubmittingRef = useRef(false);

const handleSubmit = async () => {
  if (isSubmittingRef.current) return;
  isSubmittingRef.current = true;
  try {
    await submitOrder();
  } finally {
    isSubmittingRef.current = false;
  }
};
```

これだと送信中の見た目フィードバック（disabledやスピナー）を出すために別途stateも必要になり、refとstateの二重管理になる。

## 原因

「mutableフラグで同期的にブロックする」という発想自体が、命令型で考えているときの発想。Reactの宣言モデルに直すと、「ブロック」は「UI状態としてgate」に置き換わり、レース自体が起きなくなる。

ボタンに `disabled={isSubmitting}` を付けると、`setIsSubmitting(true)` の後Reactが再renderしてDOMの `disabled` 属性が更新されるまで、ブラウザは同じmacrotask内で次のclickイベントを発火できない。**ボタン自体が物理的なgate**として機能するので、useStateの非同期更新が問題にならない。

## 解決

### 通常のボタン → `useState` + `disabled`

```tsx
// OrderForm.tsx
export function OrderForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await submitOrder();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <button disabled={isSubmitting} onClick={handleSubmit}>
      {isSubmitting ? '送信中…' : '注文確定'}
    </button>
  );
}
```

### form submit → React 19 の `useActionState`

`isPending` フラグを自動で返してくれるので、手動loading flagが不要:

```tsx
// CreateUserForm.tsx
export function CreateUserForm() {
  const [error, submitAction, isPending] = useActionState(
    async (_prev: string | null, formData: FormData) => {
      try {
        await createUser({
          name: formData.get('name') as string,
          email: formData.get('email') as string,
        });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    },
    null,
  );

  return (
    <form action={submitAction}>
      <input name="name" placeholder="名前" />
      <input name="email" type="email" placeholder="メール" />
      <button type="submit" disabled={isPending}>
        {isPending ? '作成中…' : '作成'}
      </button>
      {error && <p>{error}</p>}
    </form>
  );
}
```

### form以外の非同期処理 → `useTransition`

```tsx
// RefreshButton.tsx
export function RefreshButton() {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      await refreshDashboard();
    });
  };

  return (
    <button disabled={isPending} onClick={handleClick}>
      {isPending ? '更新中…' : '更新'}
    </button>
  );
}
```

### `useRef` が正当な唯一のケース → `disabled` でinterceptできないイベント

windowレベルのキーイベント等、UIでgateできない場面に限り、refフラグが妥当:

```tsx
// useConfirmOnEnter.ts
export function useConfirmOnEnter(onConfirm: () => Promise<void>) {
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || isProcessingRef.current) return;
      isProcessingRef.current = true;
      try {
        await onConfirm();
      } finally {
        isProcessingRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm]);
}
```

このケースでも、まず疑うべきは「処理を冪等にできないか」「直前の処理対象との値比較で再入防止できないか」「inputのEnterで `blur()` を呼ばせて focusoutハンドラに集約できないか」。フラグでブロックは最終手段。

### 判断フロー

1. UIで `disabled` にできるか? → `useState` + `disabled`
2. formか? → `useActionState`
3. 任意の非同期処理か? → `useTransition`
4. 処理を冪等にできるか / 値比較で済むか? → そうする
5. globalイベント等でどれにも当てはまらないか? → ここで初めて `useRef`

## まとめ

「ブロックしたい」と感じたら、まずUI gateで置き換えられないか問う。ref フラグは `disabled` でinterceptできない最終手段。

## 参考

- [React docs: useActionState](https://react.dev/reference/react/useActionState)
- [React docs: useTransition](https://react.dev/reference/react/useTransition)
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)
