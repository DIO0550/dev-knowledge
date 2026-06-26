---
title: render hooks パターン - FC 返しは再マウント、JSX.Element 返しが本来の形
tags: [react, render-hooks, custom-hooks, anti-pattern, performance, reconciliation, uhyo]
---

## TL;DR

- 「render hooks」は LINE 証券のテックブログが初出（2020 年公開）。命名は記事を書いた uhyo 氏ではなく、**uhyo 氏の当時の上司**。
- 戻り値が `React.FC` の場合、Custom Hook が再実行されるたびにコンポーネント関数が新規生成され、React の reconciliation 上は別の型と判定されてアンマウント → 再マウントされる（fizumi 氏の検証で実証）。
- 戻り値が `JSX.Element`（または `() => JSX.Element` の呼び出し結果）なら再マウントは起きない。uhyo 氏自身が JSX.Element 返しを推奨。
- アンチパターンと呼ばれる対象は主に **FC 返し版**。JSX.Element 返し版はパフォーマンス問題は起きない。

## このドキュメントの射程

- render hooks パターンの戻り値型による振る舞いの違いを技術的に整理する。
- 「render hooks はアンチパターンか」という議論で対象が分かれている点を明確にする。
- 実装時にどの形式を採用すべきかの判断基準を示す。

## 出自と評価

LINE 証券のテックブログ「【LINE 証券 FrontEnd】コンポーネントをカスタムフックで提供してみた」（鈴木僚太〔uhyo〕氏執筆、**2020 年 7 月公開**）が初出。uhyo 氏が後に Qiita で「Render hooks」として記事化しており、その記事内で命名について以下のように記している。

> ちなみに、Render hooksという命名は私ではなく当時の私の上司です。

記事を書いたのは uhyo 氏本人だが、「render hooks」という名前を付けたのは当時の上司、という関係になる。uhyo 氏は同記事の冒頭で、自身が推奨しているにもかかわらず広まっていないことも認めている。

> 私は当時から今までずっとこのパターンを推奨しているのですが、あまり流行る気配がありません。

英語圏では命名されたパターンとしては定着しておらず、「JSX を hook から返す」という現象についての賛否が散発的にある状態（devstation の批判記事など）。

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
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal">
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

  // ❌ hook の中で React.FC を定義している
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

`ModalFromHook` の関数オブジェクトは、フックが再実行（＝呼び出し元が再レンダー）されるたびに新規生成される。React の reconciliation は「同じ位置の要素か」をコンポーネント関数の**参照の同一性**で判定するため、毎回別の型とみなされて**アンマウント → マウント**になる。差分更新ではなく作り直しが走る。

### fizumi 氏の検証で実証されている挙動

fizumi（fneco）氏が Zenn 記事「render hooks パターンの注意点と対策」で codesandbox 付きで実演している（記事は現象と再現コードを示すもので、reconciliation の機構説明は本記事側の独自整理）。

- **メモ化なし**: Custom Hook が再実行されるたびにアンマウントされる。
- **`React.memo` 適用**: 返り値が再生成されていると、同じくアンマウントされる。
- **`useCallback` 適用**: フック再実行ごとのアンマウントは無くなるが、**状態が変わるたび（モーダル開閉ごと）にアンマウント**される。

`React.memo` の挙動については記事のコメントで、「memo 化が効かなかったのは `useDisclosure` の返値が再生成されているからで、内部でも `useCallback` で関数を安定させれば動く」と指摘され、fizumi 氏も記事を更新している。つまり「memo 化しても絶対にアンマウントされる」のではなく「**関連する全ての参照を正しくメモ化する必要があり、それを怠ると簡単に壊れる**」が正確。

### 実害

```tsx
// useModalWithEffect-bad.tsx
import { useEffect, useState } from 'react';
import { Modal } from './Modal';

export function useModalWithEffect(itemId: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<unknown>(null);

  // ❌ ModalFromHook が再マウントされるたびに内部の useEffect が再実行される
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

再マウントごとに `useEffect` が再走する。アニメーション、フォーカス管理、内部 state がすべてリセットされる。

## JSX.Element 返し版 — 本来の render hooks

uhyo 氏の Qiita 記事に出てくる元々の形がこちら。

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

`checkbox` は **state から計算された JSX.Element**。React からは「ただの子要素」として見えるだけで、独立した Fiber ノードを作らない。element はただのオブジェクトで型（コンポーネント参照）が固定されているため、参照が変わらず再マウントしない。

uhyo 氏自身、React.FC を返す形にはパフォーマンス上の難点があると述べている（Twitter での発言として複数のブログで引用されている。趣旨は次の通り）。

> React.FC を返すほうはあまり良くない。ステートを内包させると、ステートが変わると必然的に別の関数オブジェクトになり、再レンダリング時にパフォーマンスのペナルティがあるため。

### `() => JSX.Element` 返し版

`JSX.Element` を返す代わりに **`() => JSX.Element`（JSX を返す関数）** を返す形式もよく見られる。

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

引数を受け取れる拡張性のためにこの形式が選ばれることが多い。型理論的には `T` と `() => T` は副作用を無視すれば同等。`renderCheckbox` 内で hooks を呼んでいない点が重要（呼んだ瞬間に Hooks ルール違反の温床になる）。

## 折衷案 — FC を hook の外に静的定義

アーティス社のブログ「Beyond the render hooks pattern」が提案している形。

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

FC を hook 内で再生成しないので参照は安定し、再マウントは起きない。`react-table` や `react-hook-form` も類似の方針（hook と FC/コンポーネントを別管理）を採用しているとの指摘がある。

## 結論まとめ

| 形式 | 再マウント | 評価 |
|---|---|---|
| `Modal` が **hook 内で定義された React.FC** | 起きる（fizumi 氏の検証あり）。完全な防止には全参照のメモ化が必要 | **避けるべき** |
| `checkbox` が **JSX.Element** | 起きない | **uhyo 氏推奨の本来の形** |
| 関数が JSX を返す（呼び出し側で `{renderCheckbox()}`） | 起きない | 拡張性目的で実用例多い |
| FC を hook の外で静的定義、hook は FC + props を返す | 起きない | 実用的な折衷 |

「render hooks はアンチパターン」と批判される場合、対象は **FC 返し版**であることが多い。JSX.Element 返し版は技術的なパフォーマンス問題は起きない。

ただし JSX.Element 返し版でも、JSX の中に `{renderXxx()}` のような関数呼び出しが現れることへの違和感（宣言性の低下、JSX を読んだだけで何が出てくるか分からない）は別の論点として残る。これは hook と UI の分離原則の議論（別記事「headless パターン」参照）。

## まとめ

- 「render hooks がアンチパターンか」の議論は「FC 返し」と「JSX.Element 返し」を区別せずに行われがちで、対象が噛み合わない。
- 採用するなら **JSX.Element 返し**、**`() => JSX.Element` 返し**、または **FC を hook 外で静的定義** に限定する。
- そもそも「流行る気配がない」と命名者自身が認めるパターンを公開 API として採用する積極的な理由は薄く、内部実装としての整理整頓用途に留めるのが穏当。

## 参考

- LINE 証券「コンポーネントをカスタムフックで提供してみた」（初出・2020 年）: https://engineering.linecorp.com/ja/blog/line-securities-frontend-3
- uhyo「Render hooks をコンポーネントの拡張として理解する」: https://qiita.com/uhyo/items/cb6983f52ac37e59f37e
- fizumi「render hooks パターンの注意点と対策」: https://zenn.dev/fizumi/articles/083db23e25106e
- アーティス社「Beyond the render hooks pattern」: https://blog.asobou.co.jp/web/reactfc-renderhooks
- devstation「Why You Shouldn't Put JSX in Custom React Hooks」: https://devstation.hashnode.dev/why-you-shouldnt-put-jsx-in-custom-react-hooks
- bitsrc「Return Component From Hooks」: https://blog.bitsrc.io/new-react-design-pattern-return-component-from-hooks-79215c3eac00
