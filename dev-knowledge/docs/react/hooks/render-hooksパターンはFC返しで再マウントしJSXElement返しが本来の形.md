---
title: render hooks パターン - FC 返しは再マウント、JSX.Element 返しが本来の形
tags: [react, render-hooks, custom-hooks, anti-pattern, performance, reconciliation, uhyo]
---

## TL;DR

- 「render hooks」は LINE 証券のテックブログが初出。命名は uhyo 氏ではなく **uhyo 氏の当時の上司**（この「上司が名付けた」という出所は LINE 証券の記事ではなく **uhyo 氏自身の Qiita 記事**）。
- 戻り値が `React.FC` の場合、Custom Hook 呼び出し毎にコンポーネントがアンマウント → 再マウントされる（fneco（Zenn ユーザー名 fizumi）氏の検証で実証）。
- 戻り値が `JSX.Element`（または `() => JSX.Element` の呼び出し結果）なら再マウントは起きない。これが LINE 証券の元記事・uhyo 氏の記事に出てくる本来の形。
- アンチパターンと呼ばれる対象は主に **FC 返し版**。JSX.Element 返し版はパフォーマンス問題は起きない。

## このドキュメントの射程

- render hooks パターンの戻り値型による振る舞いの違いを技術的に整理する。
- 「render hooks はアンチパターンか」という議論で対象が分かれている点を明確化する。
- 実装時にどの形式を採用すべきかの判断基準を示す。

## なぜ再マウントが起きるのか（根本原因）

React は要素の `type` を **参照同一性（reference identity）で比較**する。type が異なれば「別物のコンポーネント」とみなし、古いサブツリーを破棄（unmount）して新しいツリーを構築（remount）する。

hook の中で `React.FC` を定義すると、毎レンダーで **新しい関数オブジェクト = 新しい type** が生成される。React の reconciler はこれを別コンポーネントと判断し、state や DOM を破棄してアンマウント → 再マウントする。

一方 `JSX.Element`（React element）を返す場合、その要素の `type` は安定したコンポーネント／タグを指すため、再マウントは起きない。

> 注意: 判定されるのは `key` ではなく `type`。`key` が同じでも `type`（関数参照）が変われば再マウントされる。

## 出自と評価

LINE 証券のテックブログ「【LINE 証券 FrontEnd】コンポーネントをカスタムフックで提供してみた」（鈴木亮太氏執筆）が初出。本文に「いわば "render hooks" とも言うべき設計パターン」という記述がある。元記事の戻り値型は `[boolean, () => JSX.Element]`、つまり **JSX を返す関数**であって FC そのものは返していない。

uhyo 氏が後に「Render hooks をコンポーネントの拡張として理解する」として記事化しており、その記事内で命名について以下のように記している:

> ちなみに、Render hooksという命名は私ではなく当時の私の上司です。

つまり「上司が名付けた」という情報の出所は **uhyo 氏の Qiita 記事**であって、LINE 証券の元記事ではない（元記事に「上司が名付けた」という記述はない）。

英語圏では同じ手法が「Return a Component (from Hooks)」「Return Component From Hooks」と呼ばれ、**「render hooks」という固有名としては定着していない**。着想源として React Router 作者 Michael Jackson 氏のポッドキャスト発言が挙げられることが多い。「render hooks」は日本語コミュニティ（LINE 証券由来）で広まった呼称、と整理するのが正確。なお英語圏でも同じ再マウント問題は認識済み。

## 共通の前提コード

以下、各実装パターンで共通して使う通常のコンポーネント。

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
    <div className="overlay">
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

`ModalFromHook` の関数オブジェクトが毎レンダー新規生成される → React は別の type として判定 → **アンマウント → 再マウント**。

### fneco 氏の検証で実証されている挙動

fneco（Zenn のユーザー名は fizumi。**同一人物**）氏が Zenn 記事「render hooks パターンの注意点と対策」で CodeSandbox 付きで実演している:

- **memo 化なし**: Custom Hook が呼び出される毎にアンマウントされる。
- **`React.memo` 適用（単独）**: 効果なし。type（関数オブジェクト）が毎回変わるため `React.memo` では防げない。
- **`useCallback` 適用**: Hook 呼び出し毎のアンマウントは無くなるが、**依存配列に state が絡むと、状態が変更される毎（モーダル開閉毎）に新しい関数オブジェクトになりアンマウント**される。

つまり「memo 化しても絶対にアンマウントされる」のではなく「**`React.memo` 単体では無意味で、`useCallback` でも依存に state が入ると不完全。関連する全ての参照を正しくメモ化する必要があり、それを怠ると簡単に壊れる**」が正確。

### 実害

```tsx
// useModalWithEffect-bad.tsx
import { useEffect, useState } from 'react';
import { Modal } from './Modal';

export function useModalWithEffect(itemId: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<unknown>(null);

  // ❌ ModalFromHook が再マウントされる度に useEffect が再走する
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

この例だと `useEffect` が毎レンダーで再走する。アニメーション、フォーカス管理、内部 state、全てがリセットされる。

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

`checkbox` は **state から計算された JSX.Element**。React からは「ただの子要素」として見えるだけで、独立した Fiber ノードを毎回作り直さない → 再マウントしない。

uhyo 氏自身は、FC を返す形のデメリットについて Twitter (2022-05-02) で以下のように述べている（アーティス社のブログでの引用経由で確認）:

> React.FCを返すほうはあまり良くないと思う。というのもステートを内包させると必然的にステートが変わると別の関数オブジェクトになり、再レンダリング時にパフォーマンスのペナルティがあるから

なお、uhyo 氏の Qiita 記事自体では JSX 直接返しと `() => JSX.Element` 返しの両方が示されており、記事内で型の優劣を断言しているわけではない。「JSX.Element / `() => JSX.Element` を返す形が望ましい」根拠は、上記 Twitter 発言と、本記事「なぜ再マウントが起きるのか」で説明した **type の安定性**にある。

### `() => JSX.Element` 返し版

`JSX.Element` を返す代わりに **`() => JSX.Element`（JSX を返す関数）** を返す形式もよく見られる（LINE 証券の元記事もこの形）。

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

引数を受け取れる拡張性のために選ばれることが多い。型理論的には `T` と `() => T` は副作用を無視すれば同等。

`renderCheckbox` 内で hooks を呼んでいない点が重要（呼んだ瞬間に Hooks ルール違反の温床になる）。

## 折衷案 — FC を hook の外に静的定義

アーティス社のブログ「Beyond the render hooks (return component from hooks) pattern」が提案している形。FC を hook の外で定義すれば type（参照）が安定する。

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

FC を hook 内で再生成しないので type は安定 → 再マウントなし。ただし記事自身も「API が分かりにくい（初見殺し）」というトレードオフを認めている。

## 結論まとめ

| 形式 | 再マウント | 評価 |
|---|---|---|
| `[Modal, open] = useModal()` で `Modal` が **hook 内で定義された React.FC** | 起きる（fneco 氏の検証あり）。`React.memo` 単体では防げず、`useCallback` でも依存に state が入ると壊れる | **避けるべき** |
| `[checked, checkbox] = useCheckbox()` で `checkbox` が **JSX.Element** | 起きない | **本来の形** |
| `[checked, renderCheckbox] = useCheckbox()` で関数が JSX を返す（呼び出し側で `{renderCheckbox()}`） | 起きない | 拡張性目的で実用例多い（LINE 証券の元記事もこの形） |
| FC を hook の外で静的定義、hook は FC + props を返す | 起きない | 実用的な折衷 |

「render hooks はアンチパターン」と批判される場合、対象は **FC 返し版**であることが多い。JSX.Element 返し版は技術的なパフォーマンス問題は起きない。

ただし JSX.Element 返し版でも、JSX の中に `{renderXxx()}` のような関数呼び出しが現れることへの違和感（宣言性の低下、JSX を読んだだけで何が出てくるか分からない）は別の論点として残る。

## まとめ

- 「render hooks がアンチパターンか」の議論は「FC 返し」と「JSX.Element 返し」を区別せずに行われがちで、対象が噛み合わない。
- 再マウントの根本原因は **type が参照同一性で比較され、hook 内 FC は毎レンダー新しい type になる**こと。`key` ではなく `type` で判定される。
- 採用するなら **JSX.Element 返し**、**`() => JSX.Element` 返し**、または **FC を hook 外で静的定義** に限定する。
- 「render hooks」は日本語圏の呼称で、英語圏では「Return Component From Hooks」等と呼ばれ固有名としては定着していない。

## 参考

- LINE 証券「【LINE 証券 FrontEnd】コンポーネントをカスタムフックで提供してみた」（初出）: https://engineering.linecorp.com/ja/blog/line-securities-frontend-3
- uhyo「Render hooks をコンポーネントの拡張として理解する」（命名者＝上司の明言）: https://qiita.com/uhyo/items/cb6983f52ac37e59f37e
- fneco（Zenn: fizumi）「render hooks パターンの注意点と対策」（FC 再マウント検証・memo/useCallback）: https://zenn.dev/fizumi/articles/083db23e25106e
- アーティス社「Beyond the render hooks (return component from hooks) pattern」（折衷案）: https://blog.asobou.co.jp/web/reactfc-renderhooks
- DEV.to「New React Hooks Pattern? Return a Component」（英語圏の呼称・Michael Jackson・再マウント原因）: https://dev.to/droopytersen/new-react-hooks-pattern-return-a-component-31bh
- Bits and Pieces「Return Component From Hooks」（英語圏の呼称）: https://blog.bitsrc.io/new-react-design-pattern-return-component-from-hooks-79215c3eac00
- React 公式 Reconciliation（type 比較の技術根拠）: https://legacy.reactjs.org/docs/reconciliation.html
