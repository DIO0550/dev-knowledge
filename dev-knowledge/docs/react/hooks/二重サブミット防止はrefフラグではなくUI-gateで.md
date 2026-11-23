---
title: 二重サブミット防止は useRef フラグではなく UI 状態（disabled）で防ぐ
tags: [react, typescript, use-ref, anti-pattern, double-submission, useactionstate, usetransition, react-19, disabled, form, custom-hooks]
---

## TL;DR

- 「処理中は再実行をブロックしたい」を `useRef` フラグで実装するのはアンチパターン。
- ボタン経由なら `useState` + `disabled`、フォームなら React 19 の `useActionState`、任意の非同期処理なら `useTransition` の `isPending` で十分。
- `useRef` が本当に必要なのは `disabled` 属性で防げない場面（グローバルな `keydown` イベント等）に限られる。

## 遭遇した問題

送信ボタン連打で二重サブミットを防ぎたいとき、`useState(isSubmitting)` で単純にガードしようとすると次のように書きがち:

```ts
const [isSubmitting, setIsSubmitting] = useState(false);

const handleSubmit = async () => {
  if (isSubmitting) return;       // ❌ 古い値を読んでいる可能性
  setIsSubmitting(true);          // ❌ 次のレンダーで反映。同じイベントループ tick では効かない
  await submitOrder();
  setIsSubmitting(false);
};
```

連打されたとき `isSubmitting` がまだ `false` のままで素通りしてしまう。そこで「即座に変更でき、読み取りも同期的な `ref`」に手が伸びる:

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

これだと送信中の見た目フィードバック（`disabled` やスピナー）を出すために別途 `state` も必要になり、`ref` と `state` の二重管理になる。

## 原因

「可変フラグで同期的にブロックする」という発想自体が命令型寄り。React の宣言的モデルに直すと、「処理のブロック」は「UI 状態による操作の制御（`disabled`）」に置き換わり、レース自体が起きなくなる。

ボタンに `disabled={isSubmitting}` を付けておくと、クリックイベント内の `setIsSubmitting(true)` を React が同期的にコミットして DOM の `disabled` 属性へ反映するため、次のクリックイベントが処理される前にボタン自体が無効化される。**ボタン自体が物理的なゲート**として機能するので、`useState` の非同期更新が問題にならない。

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

`isPending` フラグを自動で返してくれるので、手動のローディングフラグが不要になる:

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

### form 以外の非同期処理 → `useTransition`

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

### `useRef` が正当な唯一のケース → `disabled` で防げないイベント

`window` レベルのキーイベント等、UI 状態で入力を遮断できない場面に限り、`ref` フラグが妥当:

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

このケースでも、まず疑うべきは「処理を冪等にできないか」「直前の処理対象との値比較で再入防止できないか」「`input` の Enter で `blur()` を呼ばせて `focusout` ハンドラに集約できないか」。フラグでブロックするのは最終手段。

### 判断フロー

1. UI で `disabled` にできるか? → `useState` + `disabled`
2. フォーム送信か? → `useActionState`
3. 任意の非同期処理か? → `useTransition`
4. 処理を冪等にできるか / 値比較で済むか? → そうする
5. グローバルイベント等でどれにも当てはまらないか? → ここで初めて `useRef`

## まとめ

「ブロックしたい」と感じたら、まず UI 状態（`disabled`）で置き換えられないか問う。`ref` フラグは `disabled` で防げない場面に使う最終手段。

## 参考

- [React docs: useActionState](https://react.dev/reference/react/useActionState)
- [React docs: useTransition](https://react.dev/reference/react/useTransition)
- [React 19 release notes](https://react.dev/blog/2024/12/05/react-19)