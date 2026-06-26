---
title: hooks と UI の分離原則 - "headless" の 2 つの実装と英語圏ライブラリの慣行
tags: [react, headless-ui, custom-hooks, design-principle, separation-of-concerns, react-aria, tanstack]
---

## TL;DR

- "headless" は **「振る舞い・状態管理・アクセシビリティはライブラリ、見た目（markup と styling）は利用者」** という設計方針。実装機構には 2 派ある。
- **A 派: 非装飾コンポーネント**（Radix UI / Tailwind Labs Headless UI / Ariakit など）— `<Checkbox>` 等のコンポーネントを提供し、styling は利用者。
- **B 派: props 返し hook**（React Aria の hooks / TanStack Table / React Hook Form / Downshift など）— `useCheckbox` 等が `inputProps` 等を返し、JSX は利用者が組む。
- どちらも「JSX を hook の戻り値に内包しない」点で render hooks（hook が JSX を返す）と対極。

## このドキュメントの射程

- 「カスタムフックに何を含めるべきか」の設計判断の指針。
- "headless" という用語の指す範囲を実装機構レベルで整理する。
- 英語圏主要ライブラリの設計を、ドキュメント・実コードベースで確認した上で参照する。

## "headless" の共通定義

各ライブラリのドキュメントから:

- TanStack Table: 「Headless UI for building powerful tables & datagrids」「stays below the visual layer」
- Headless UI (Tailwind Labs): 「Completely unstyled, fully accessible UI components, designed to integrate beautifully with Tailwind CSS」
- React Aria: 「a library of React Hooks (rather than components) that handle behavior, ARIA semantics, internationalization, and adaptive interactions」（自身を「fully customizable and doesn't impose styling or design-specific details」とも説明）

共通点は **「ロジック・アクセシビリティ・キーボード操作・フォーカス管理はライブラリが、見た目は利用者が」** という分業。

## A 派: 非装飾コンポーネント

ライブラリが**コンポーネント**を提供し、利用者は styling（と必要に応じてマークアップ）を担当する。

### Radix UI の例

```tsx
import * as AlertDialog from '@radix-ui/react-alert-dialog';

export function DeleteButton({ itemName, onConfirm }: { itemName: string; onConfirm: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button className="btn-danger">削除</button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="dialog">
          <AlertDialog.Title>削除確認</AlertDialog.Title>
          <AlertDialog.Description>
            「{itemName}」を削除します。この操作は取り消せません。
          </AlertDialog.Description>
          <div className="actions">
            <AlertDialog.Cancel asChild>
              <button>キャンセル</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button className="btn-danger" onClick={onConfirm}>削除</button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
```

Composable な primitives を組み合わせる。styling は CSS（上記は className 例）で。

### Headless UI (Tailwind Labs) の例

```tsx
import { Checkbox, Field, Label } from '@headlessui/react';
import { useState } from 'react';

export function SubscribeForm() {
  const [enabled, setEnabled] = useState(false);

  return (
    <Field className="flex items-center gap-2">
      <Checkbox
        checked={enabled}
        onChange={setEnabled}
        className="group block size-4 rounded border bg-white data-checked:bg-blue-500"
      >
        <svg className="stroke-white opacity-0 group-data-checked:opacity-100" viewBox="0 0 14 14">
          <path d="M3 8L6 11L11 3.5" strokeWidth={2} fill="none" />
        </svg>
      </Checkbox>
      <Label>ベータ機能を有効にする</Label>
    </Field>
  );
}
```

unstyled なコンポーネント。`data-checked` 等の data 属性で状態を CSS から拾える設計。v2.0 以降は内部で React Aria の hooks を使用しているが、用途は主に `data-hover` / `data-focus` / `data-active` 等の状態属性検出（デバイス横断のインタラクション正規化）であり、コンポーネント全体が React Aria でできているわけではない（Tailwind Labs ブログより）。

## B 派: props 返し hook

ライブラリが **hook を提供し、hook は state と props（spread して DOM 要素に渡す用のオブジェクト）を返す**。JSX は利用者が組み立てる。

> 注: React Aria は元々 hooks ライブラリ（B 派）だが、現在は「React Aria Components」というコンポーネント版（A 派寄り）も公式提供している。以下は hooks 版（`react-aria`）を指す。

### React Aria（hooks 版）の例

```tsx
import { useRef } from 'react';
import { useToggleState } from 'react-stately';
import { useCheckbox, useFocusRing, VisuallyHidden } from 'react-aria';
import type { AriaCheckboxProps } from 'react-aria';

type CheckboxProps = AriaCheckboxProps & {
  children: React.ReactNode;
};

// 利用者が自分で書くカスタム Checkbox コンポーネント
export function Checkbox(props: CheckboxProps) {
  const state = useToggleState(props);
  const ref = useRef<HTMLInputElement>(null);
  const { inputProps } = useCheckbox(props, state, ref);
  const { isFocusVisible, focusProps } = useFocusRing();

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <VisuallyHidden>
        <input {...inputProps} {...focusProps} ref={ref} />
      </VisuallyHidden>
      <svg width={20} height={20} aria-hidden="true">
        <rect
          x={2}
          y={2}
          width={16}
          height={16}
          fill={state.isSelected ? '#2563eb' : 'none'}
          stroke={isFocusVisible ? '#2563eb' : '#999'}
        />
      </svg>
      {props.children}
    </label>
  );
}
```

```tsx
// 使う側
import { Checkbox } from './Checkbox';

export function App() {
  return <Checkbox>購読する</Checkbox>;
}
```

`useCheckbox` は `{ inputProps, ... }` を返すだけ。`<input>` を書くのも `<label>` で囲むのも `VisuallyHidden` で隠して SVG で自前のチェックボックスを描くのも、全て利用者の責任。

### TanStack Table の例

```tsx
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

type Person = {
  firstName: string;
  lastName: string;
  age: number;
};

const data: Person[] = [
  { firstName: 'tanner', lastName: 'linsley', age: 24 },
  { firstName: 'tandy', lastName: 'miller', age: 40 },
  { firstName: 'joe', lastName: 'dirte', age: 45 },
];

const columnHelper = createColumnHelper<Person>();

const columns = [
  columnHelper.accessor('firstName', {
    header: 'First Name',
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor((row) => row.lastName, {
    id: 'lastName',
    header: () => <span>Last Name</span>,
    cell: (info) => <i>{info.getValue()}</i>,
  }),
  columnHelper.accessor('age', {
    header: 'Age',
    cell: (info) => info.getValue(),
  }),
];

export function PersonTable() {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`useReactTable` は `table` インスタンスを返す。`<table>` を書くのも `flexRender` で渡すのも利用者。`flexRender` は内部的に「渡されたものが React コンポーネント（`isReactComponent` 判定）なら `<Comp {...props} />`（＝ `createElement` 相当）で呼び、そうでなければ値をそのまま返す」という分岐をしている（ソース確認済み）。実装イメージ:

```tsx
function flexRender<TProps extends object>(Comp: unknown, props: TProps) {
  return !Comp ? null : isReactComponent(Comp) ? <Comp {...props} /> : Comp;
}
```

### React Hook Form の例

```tsx
import { useForm } from 'react-hook-form';

type FormValues = {
  email: string;
  password: string;
};

export function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async (data: FormValues) => {
    await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        Email
        <input type="email" {...register('email', { required: '必須です' })} />
        {errors.email && <span>{errors.email.message}</span>}
      </label>
      <label>
        Password
        <input type="password" {...register('password', { required: '必須です' })} />
        {errors.password && <span>{errors.password.message}</span>}
      </label>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? '送信中...' : 'ログイン'}
      </button>
    </form>
  );
}
```

`useForm` は state と関数のみを返す。`register("email")` は input に spread する props（`onChange`, `onBlur`, `ref`, `name`）を返す。JSX、レイアウト、styling、エラーメッセージの表示位置、全て利用者が決める。

## 凝集性 vs 再利用性のトレードオフ

UI を内包した hook（render hooks）と、頭がない hook（headless）の対比:

| | 凝集性 | UI からの分離 | ロジック再利用 |
|---|---|---|---|
| render hooks（`useCheckbox` が JSX 返す） | ◎ | ✗ | ✗ |
| headless（`useCheckbox` が props 返す） | △ | ◎ | ◎ |

具体例で示す。`useFormField` 型の純粋ロジック hook なら、同じロジックを素の `<input>` でも MUI の `<TextField>` でも使い回せる。

```tsx
// useFormField.ts — UI を知らないロジック hook
import { useState } from 'react';

type Validator<T> = (value: T) => string | null;

export function useFormField<T>(initial: T, validate?: Validator<T>) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = touched && validate ? validate(value) : null;

  return {
    value,
    onChange: (next: T) => setValue(next),
    onBlur: () => setTouched(true),
    error,
    isInvalid: error !== null,
  };
}
```

```tsx
// 異なる UI に同じロジックを流用できる
import { TextField } from '@mui/material';
import { useFormField } from './useFormField';

const validateEmail = (v: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'invalid email';

// プレーン HTML
function PlainEmailInput() {
  const field = useFormField('', validateEmail);
  return (
    <div>
      <input
        value={field.value}
        onChange={(e) => field.onChange(e.currentTarget.value)}
        onBlur={field.onBlur}
      />
      {field.error && <p>{field.error}</p>}
    </div>
  );
}

// MUI
function MuiEmailInput() {
  const field = useFormField('', validateEmail);
  return (
    <TextField
      value={field.value}
      onChange={(e) => field.onChange(e.currentTarget.value)}
      onBlur={field.onBlur}
      error={field.isInvalid}
      helperText={field.error ?? ''}
    />
  );
}
```

逆に `useCheckbox` が `<input>` を返すように作られていたら、MUI Checkbox では使えない、自社 DS では使えない。

## 内部実装としては許容できる

uhyo 氏が指摘する「内部実装としてのカスタムフック」の使い方なら、render hooks 系も問題にならない。

```tsx
// SomeComplexForm.tsx
import { useState } from 'react';

// SomeComplexForm 内部だけで使われる private な hook
function useEmailField() {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const field = (
    <div>
      <input
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => setTouched(true)}
      />
      {touched && !isValid && <p>invalid email</p>}
    </div>
  );

  return { value, isValid, field };
}

export function SomeComplexForm() {
  const email = useEmailField();
  // この hook は外には export しない

  return (
    <form>
      <label>Email</label>
      {email.field}
      <button disabled={!email.isValid}>送信</button>
    </form>
  );
}
```

再利用しない前提なら層構造を破壊しない。**外部 API として公開した瞬間に、利用者は UI を変えられなくなる**のが問題。`material-ui-confirm` が Material UI に縛られて Tailwind プロジェクトでは使いにくいのと同じ構造。

## 英語圏での批判

devstation の記事「Why You Shouldn't Put JSX in Custom React Hooks」が代表的な批判。要点:

1. **再利用性**: JSX が特定の UI 実装に結びつくため、異なる文脈での再利用が難しい。
2. **パフォーマンス**: JSX が毎レンダーで実行される。
3. **テスト容易性**: hook を単体でテストするのが難しくなる。

結論として「JSX を custom hooks に含めず、必要なデータや state を返すようにし、呼び出し側コンポーネントにレンダリングを任せるべき」と書かれている。これは render hooks への直接的な対抗論で、React 公式の「Components and Hooks must be pure」とも整合する。英語圏ではこちらの立場のほうが優勢。

## 推奨

- **公開 API（ライブラリ / 共有コンポーネント）** → **headless（A 派 or B 派）で書く**。
- **コンポーネント内部の private な整理整頓** → render hooks 系も許容。
- 共有 UI（ダイアログ等）が必要なら **Provider + 通常のコンポーネント**。

## まとめ

- "headless" は機構レベルでは A 派（非装飾コンポーネント）と B 派（props 返し hook）に分かれるが、「JSX を hook の戻り値に内包しない」点で共通。
- 英語圏の主要ライブラリ（React Aria / TanStack Table / Radix UI / Headless UI / Downshift / React Hook Form）はすべて headless 方針。React Aria は hooks 版とコンポーネント版の両方を提供し、Downshift は prop getters + render props を併用する点は補足。
- render hooks（hook が JSX を返す）はこれらの対極で、ライブラリ採用例は確認できない。
- 「凝集性」を理由に UI を hook に内包させると、再利用性を失う構造的トレードオフを引き受けることになる。

## 参考

- React Aria: https://react-spectrum.adobe.com/react-aria/
- React Aria useCheckbox: https://react-spectrum.adobe.com/react-aria/useCheckbox.html
- TanStack Table: https://tanstack.com/table/latest
- TanStack Table flexRender 実装: https://github.com/TanStack/table/blob/main/packages/react-table/src/index.tsx
- Headless UI (Tailwind Labs): https://headlessui.com/
- Headless UI v2.0 リリース（React Aria 採用）: https://tailwindcss.com/blog/headless-ui-v2
- Radix UI Primitives: https://www.radix-ui.com/primitives
- React Hook Form: https://react-hook-form.com/
- Downshift: https://www.downshift-js.com/
- devstation「Why You Shouldn't Put JSX in Custom React Hooks」: https://devstation.hashnode.dev/why-you-shouldnt-put-jsx-in-custom-react-hooks
