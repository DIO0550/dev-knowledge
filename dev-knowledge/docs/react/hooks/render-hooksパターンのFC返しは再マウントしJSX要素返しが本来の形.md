---
title: render hooks パターン - FC 返しは再マウント、JSX.Element 返しが本来の形
tags: [react, render-hooks, custom-hooks, anti-pattern, performance, reconciliation, uhyo]
---

## TL;DR

- 「render hooks」というパターンを最初に紹介したのは LINE 証券のテックブログ。記事を書いたのは **uhyo 氏本人**（本名 Ryota Suzuki）。ただし **"render hooks" という命名自体は uhyo 氏ではなく、当時の uhyo 氏の上司**による。
- 戻り値が `React.FC`（hook 内で定義した関数コンポーネント）の場合、Custom Hook 呼び出し毎にコンポーネントがアンマウント → 再マウントされる（fneco 氏の検証で実証）。
- 戻り値が `JSX.Element`（state から計算した JSX）なら再マウントは起きない。uhyo 氏自身が JSX.Element 返しを推奨。
- アンチパターンと呼ばれる対象は主に **FC 返し版**。JSX.Element 返し版はパフォーマンス問題は起きない。

## このドキュメントの射程

- render hooks パターンの戻り値型による振る舞いの違いを技術的に整理する。
- 「render hooks はアンチパターンか」という議論で対象が分かれている点を明確化する。
- 実装時にどの形式を採用すべきかの判断基準を示す。

## 出自と評価

LINE 証券のテックブログ「【LINE証券 FrontEnd】コンポーネントをカスタムフックで提供してみた」（著者 Ryota Suzuki、2020 年公開）で、`"render hooks" とも言うべき設計パターン` という形でこのパターンが紹介された。この **記事を書いたのは uhyo 氏本人**（uhyo は Ryota Suzuki 氏のハンドルネーム）である。

uhyo 氏は後に Qiita で「Render hooksをコンポーネントの拡張として理解する」を書いており、その中で **命名** について以下のように記している（命名したのは記事執筆者である uhyo 氏ではなく、当時の上司）:

> Render hooksという命名は私ではなく当時の私の上司です。

つまり「パターン紹介記事を書いたのは uhyo 氏本人。ただし "render hooks" という語を付けたのは uhyo 氏ではなく当時の上司」という構図で、「記事も命名も別人」ではない点に注意する。

uhyo 氏は同じ記事の冒頭で、自身が推奨しているにもかかわらず広まっていないことを認めている:

> 私は当時から今までずっとこのパターンを推奨しているのですが、あまり流行る気配がありません。

英語圏では命名されたパターンとしては定着しておらず、「JSX を hook から返す」という現象についての賛否両論が散発的にある状態（devstation の批判記事など）。

## 共通の前提コード

```tsx
// Modal.tsx — どのパターンでも使う通常のコンポーネント
import { type ReactNode } from 'react';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
        <button onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
```

## FC 返し版 — 再マウントが起きる

```tsx
// useModal-bad.tsx
import { useState } from 'react';
import { Modal } from './Modal';

export function useModal() {
  const [isOpen, setIsOpen] = useState(false);

  // ❌ hook の中で React.FC を定義
  const ModalFromHook = () => (
    <Modal isOpen={isOpen} onClose={() => setIsOpen(false)}>
      <p>モーダルの中身</p>
    </Modal>
  );

  return {
    ModalFromHook,
    openModal: () => setIsOpen(true),
  };
}
```

```tsx
// App.tsx
import { useModal } from './useModal-bad';

export function App() {
  const { ModalFromHook, openModal } = useModal();
  return (
    <>
      <ModalFromHook />
      <button onClick={openModal}>開く</button>
    </>
  );
}
```

`ModalFromHook` の関数オブジェクトが毎レンダー新規生成される → React は別の型として判定 → **アンマウント → 再マウント**。

### fneco 氏の検証で実証されている挙動

fneco 氏（Zenn の記事 slug は `fizumi`）が Zenn 記事「render hooks パターンの注意点と対策」で codesandbox 付きで実演している:

- **memo 化なし**: Custom Hook が呼び出される毎にアンマウントされる。
- **`useCallback` 適用**: Hook 呼び出し毎のアンマウントは無くなるが、**状態が変更される毎（モーダル開閉毎）にアンマウント**される。

つまり「memo 化しても絶対にアンマウントされる」のではなく「**関連する全ての参照を正しくメモ化する必要があり、それを怠ると簡単に壊れる**」が正確。関連する全ての参照を安定化できないと、簡単に再マウントが復活する。

### 実害

```tsx
// useModalWithEffect-bad.tsx
import { useEffect, useState } from 'react';
import { Modal } from './Modal';

export function useModalWithEffect(itemId: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<unknown>(null);

  // ❌ ModalFromHook が再マウントされる度に再実行される
  const ModalFromHook = () => {
    useEffect(() => {
      let cancelled = false;
      fetch(`/api/items/${itemId}`)
        .then((res) => res.json())
        .then((d) => {
          if (!cancelled) setData(d);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    return (
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </Modal>
    );
  };

  return { ModalFromHook, openModal: () => setIsOpen(true) };
}
```

この例だと `useEffect` が再マウント毎に再走する。アニメーション、フォーカス管理、内部 state、全てがリセットされる。

## JSX.Element 返し版 — 本来の render hooks

uhyo 氏の Qiita 記事に出てくる元々の形がこちら:

```tsx
// useCheckbox.tsx (uhyo 氏の記事の例)
import { useState } from 'react';

export function useCheckbox(): readonly [boolean, JSX.Element] {
  const [checked, setChecked] = useState(false);

  // ✅ JSX.Element（ただの JS オブジェクト）。関数定義ではない
  const checkbox = (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => setChecked(e.currentTarget.checked)}
    />
  );

  return [checked, checkbox] as const;
}
```

```tsx
// App.tsx
import { useCheckbox } from './useCheckbox';

export function App() {
  const [checked, checkbox] = useCheckbox();

  return (
    <div>
      <p>チェック状態: {checked ? 'ON' : 'OFF'}</p>
      <p>{checkbox}</p>
    </div>
  );
}
```

`checkbox` は **state から計算された JSX.Element**。React からは「ただの子要素（React element）」として見えるだけで、独立した Fiber ノードを毎回作り直さない → 再マウントしない。fneco 氏の記事でも「React element を返却する render hooks パターンでは、アンマウントされる現象は発生しない」と明記されている。

uhyo 氏自身、自身が React.FC 返しよりも JSX.Element 返しを推奨していることを述べている（ステートを内包させると state 変更時に別の関数オブジェクトになり、再レンダリング時にパフォーマンスのペナルティがあるため）。

### `() => JSX.Element` 返し版

`JSX.Element` を返す代わりに **`() => JSX.Element`（JSX を返す関数）** を返す形式もよく見られる:

```tsx
// useCheckboxWithLabel.tsx
import { useState, type ReactNode } from 'react';

type RenderCheckbox = (label: ReactNode) => JSX.Element;

export function useCheckboxWithLabel(): readonly [boolean, RenderCheckbox] {
  const [checked, setChecked] = useState(false);

  // ✅ JSX を返す関数（hooks は呼ばない）
  const renderCheckbox: RenderCheckbox = (label) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.currentTarget.checked)}
      />
      {label}
    </label>
  );

  return [checked, renderCheckbox] as const;
}
```

```tsx
// App.tsx
import { useCheckboxWithLabel } from './useCheckboxWithLabel';

export function App() {
  const [agreed, renderCheckbox] = useCheckboxWithLabel();

  return (
    <form>
      {renderCheckbox('利用規約に同意する')}
      <button disabled={!agreed}>送信</button>
    </form>
  );
}
```

この形式は、引数（上記なら `label`）を受け取れる拡張性のために選ばれることが多い。呼び出し側で `{renderCheckbox(...)}` のように展開すると、毎レンダーで element を生成するだけなので再マウントは起きない。

> 注: `() => JSX.Element` を返す形そのものについては、上記 fneco 氏の検証記事では直接扱われていない（同記事は「React.FC を返す」vs「React element を返す」の対比）。再マウントが起きないのは「呼び出すたびに element を生成し、それを親が展開する」という構造から導かれる挙動である。`renderCheckbox` 内で hooks を呼ばない点が重要（呼んだ瞬間に Hooks ルール違反の温床になる）。

## 折衷案 — FC を hook の外に静的定義

アーティス社のブログ「Beyond the render hooks pattern」が提案している形:

```tsx
// CheckboxView.tsx — FC は hook の外で定義
import { type FC } from 'react';

type CheckboxViewProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
};

export const CheckboxView: FC<CheckboxViewProps> = ({ checked, onChange, label }) => (
  <label>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
    {label}
  </label>
);
```

```tsx
// useCheckbox.tsx
import { useCallback, useState } from 'react';
import { CheckboxView } from './CheckboxView';

export function useCheckbox(initialValue = false) {
  const [checked, setChecked] = useState(initialValue);

  // 関数の参照を安定させる
  const onChange = useCallback((next: boolean) => setChecked(next), []);

  return {
    checked,
    setChecked,
    // FC + props のペアで返す
    CheckboxView,
    checkboxProps: { checked, onChange },
  };
}
```

```tsx
// App.tsx
import { useCheckbox } from './useCheckbox';

export function App() {
  const { checked, CheckboxView, checkboxProps } = useCheckbox();

  return (
    <form>
      <CheckboxView {...checkboxProps} label="利用規約に同意する" />
      <button disabled={!checked}>送信</button>
    </form>
  );
}
```

FC を hook 内で再生成しないので参照は安定 → 再マウントなし。

注意点として、アーティス社の記事はこの折衷案を「JSX.Element 返しの参照喪失を解決するため」に提案しているわけではない。記事は **JSX.Element を返す形なら参照喪失（再マウント）問題は起きないと認めた上で**、children を props で渡したいといった **使い勝手・拡張性** の理由から FC + props を返す形を採っている。「render hooks の再マウント問題を解決する折衷案」と読むと誤りになる。

## 結論まとめ

| 形式 | 再マウント | 評価 |
|---|---|---|
| `[Modal, open] = useModal()` で `Modal` が **hook 内で定義された React.FC** | 起きる（fneco 氏の検証あり）。完全な防止には全ての参照のメモ化が必要 | **避けるべき** |
| `[checked, checkbox] = useCheckbox()` で `checkbox` が **JSX.Element** | 起きない | **uhyo 氏推奨の本来の形** |
| `[checked, renderCheckbox] = useCheckbox()` で関数が JSX を返す（呼び出し側で `{renderCheckbox()}`） | 起きない | 拡張性目的で実用例多い |
| FC を hook の外で静的定義、hook は FC + props を返す | 起きない | 実用的な折衷（動機は利便性） |

「render hooks はアンチパターン」と批判される場合、対象は **FC 返し版**であることが多い。JSX.Element 返し版は技術的なパフォーマンス問題は起きない。

ただし JSX.Element 返し版でも、JSX の中に `{renderXxx()}` のような関数呼び出しが現れることへの違和感（宣言性の低下、JSX を読んだだけで何が出てくるか分からない）は別の論点として残る。これは hook と UI の分離原則の議論。

## まとめ

- 「render hooks がアンチパターンか」の議論は「FC 返し」と「JSX.Element 返し」を区別せずに行われがちで、対象が噛み合わない。
- 採用するなら **JSX.Element 返し**、**`() => JSX.Element` 返し**、または **FC を hook 外で静的定義** に限定する。
- そもそも「流行る気配がない」と命名・推奨に関わった uhyo 氏自身が認めるパターンを公開 API として採用する積極的な理由は薄く、内部実装としての整理整頓用途に留めるのが穏当。

## 環境・前提

- React 18 系を前提（再マウント挙動は reconciliation の仕様に依存）。
- TypeScript の `JSX.Element` 型を使用（React 17 以前の自動 import 前提の記法を含む）。

## 参考

- LINE 証券「コンポーネントをカスタムフックで提供してみた」（著者 Ryota Suzuki = uhyo 氏、初出）: https://engineering.linecorp.com/ja/blog/line-securities-frontend-3
- uhyo「Render hooksをコンポーネントの拡張として理解する」: https://qiita.com/uhyo/items/cb6983f52ac37e59f37e
- fneco「render hooks パターンの注意点と対策」: https://zenn.dev/fizumi/articles/083db23e25106e
- アーティス社「Beyond the render hooks pattern」: https://blog.asobou.co.jp/web/reactfc-renderhooks
- devstation「Why You Shouldn't Put JSX in Custom React Hooks」: https://devstation.hashnode.dev/why-you-shouldnt-put-jsx-in-custom-react-hooks
- bitsrc「Return Component From Hooks」: https://blog.bitsrc.io/new-react-design-pattern-return-component-from-hooks-79215c3eac00
