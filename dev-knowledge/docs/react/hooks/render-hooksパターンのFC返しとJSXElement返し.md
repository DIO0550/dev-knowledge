---
title: render hooks パターン — FC 返しは再マウント、JSX.Element 返しが本来の形
tags: [react, render-hooks, custom-hooks, anti-pattern, performance, reconciliation, uhyo]
---

## TL;DR

- 「render hooks」の初出は LINE 証券のテックブログ「【LINE証券 FrontEnd】コンポーネントをカスタムフックで提供してみた」（2020-07-08, 鈴木亮太）。命名が uhyo 氏ではなく「当時の上司」であるという情報源は uhyo 氏の Qiita 記事。
- 戻り値が `React.FC`（hook 内で定義した関数コンポーネント）の場合、Custom Hook 呼び出し毎にコンポーネントがアンマウント → 再マウントされる（fneco 氏の検証で実証）。
- 戻り値が `JSX.Element`（または `() => JSX.Element` の呼び出し結果）なら再マウントは起きない。
- 「再マウント回避のため JSX.Element 返しが望ましい」と主張しているのは **fneco（fizumi）氏**。uhyo 氏自身は両形式について「正直どちらでも良い」と中立で、再マウント問題には触れていない。
- アンチパターンと呼ばれる対象は主に **FC 返し版**。JSX.Element 返し版はパフォーマンス問題が起きない。

## 射程

- render hooks パターンの戻り値型による振る舞いの違いを技術的に整理する。
- 「render hooks はアンチパターンか」という議論で対象が分かれている点を明確化する。
- 実装時にどの形式を採用すべきかの判断基準を得る。

## 出自と評価

LINE 証券のテックブログ「【LINE証券 FrontEnd】コンポーネントをカスタムフックで提供してみた」（鈴木亮太, 2020-07-08）が初出。記事中に「いわば『render hooks』とも言うべき設計パターン」という表現がある。なお同記事のカスタムフックは厳密には JSX を返す関数（`renderXxx`）を返す形で、後述の再マウント問題が起きない側の実装になっている。

uhyo 氏が後に「Render hooks」として記事化しており、その記事内で命名について次のように記している（＝命名の経緯はこの記事が情報源。LINE 証券ブログ本体に命名経緯の記述はない）。

> Render hooksという命名は私ではなく当時の私の上司です。

uhyo 氏は同記事冒頭で、自身が推奨しているにもかかわらず広まっていないことを認めている。

> 私は当時から今までずっとこのパターンを推奨しているのですが、あまり流行る気配がありません。

英語圏では命名されたパターンとしては定着しておらず、「JSX を hook から返す」ことへの賛否が散発的にある状態（devstation の批判記事など）。

## 共通の前提コード

```tsx
// Modal.tsx — どのパターンでも使う通常のコンポーネント
import { type ReactNode } from "react";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;
  return (
    <div role="dialog" className="overlay">
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
import { useState } from "react";
import { Modal } from "./Modal";

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
import { useModal } from "./useModal-bad";

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

### なぜ FC 返しで再マウントするのか（React 内部メカニズム）

React 公式「Preserving and Resetting State」の原則がそのまま効く。

> React preserves a component's state for as long as it's being rendered at its position in the UI tree. If a different component gets rendered at the same position, React discards its state.

メカニズムを順に追うと:

1. React は UI ツリーの**同じ位置**に**同じコンポーネント型**がレンダーされ続ける限り、state と DOM を保持する。位置が同じでも**型が異なる**と、前のコンポーネントをアンマウント（state 破棄・DOM 削除）して新しいコンポーネントをマウントし直す。
2. hook 内に関数コンポーネントを定義すると、**hook が呼ばれる（＝毎レンダー）たびに新しい関数オブジェクト**が生成される。
3. React は reconcile 時に要素の `type`（＝この関数の参照）を前回と比較する。参照が毎回変わるため「同じ位置に**別の型**が来た」と判断する。
4. 結果、**毎レンダーでアンマウント → 再マウント**が起き、内部 state や DOM（およびそれに紐づくアニメーション等）が破棄される。

対して JSX.Element を直接返す場合、要素を生成するコンポーネント型は安定しており、同じ位置に同じ型が来るため state が保持される。

※ 公式ページ自体は render hooks に言及していない。「FC 返しが再マウントする」のはこの公式ルールを適用した帰結として説明するのが正確。

### fneco 氏の検証で実証されている挙動

fneco（fizumi）氏が Zenn 記事「render hooks パターンの注意点と対策」（2023-02-15）で codesandbox 付きで実演している。

- **memo 化なし**: Custom Hook が呼び出される毎にアンマウントされる。
- **`useCallback` で返す関数を安定化**: Hook 呼び出し毎のアンマウントは無くなるが、**状態が変更される毎（モーダル開閉毎）にアンマウント**される。
- 結論として、**React 要素（element）を返す**形を推奨。トレードオフは props を要素に渡せず hook に直接渡す形になること。

「`React.memo` だけでは不十分で、関連する全ての参照を正しくメモ化しないと簡単に壊れる」というのが正確な理解。つまり「memo 化しても絶対にアンマウントされる」のではなく、メモ化の網羅を怠ると壊れる。

### 実害

```tsx
// useModalWithEffect-bad.tsx
import { useEffect, useState } from "react";
import { Modal } from "./Modal";

export function useModalWithEffect(itemId: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<unknown>(null);

  // ❌ ModalFromHook が再マウントされる度に useEffect が再実行される
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

この例だと `useEffect` が毎レンダーで再走する。アニメーション・フォーカス管理・内部 state が全てリセットされる。

## JSX.Element 返し版 — 本来の render hooks

uhyo 氏の Qiita 記事に出てくる元々の形がこちら。

```tsx
// useCheckbox.tsx
import { useState } from "react";

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
import { useCheckbox } from "./useCheckbox";

export function App() {
  const [checked, checkbox] = useCheckbox();

  return (
    <div>
      <p>チェック状態: {checked ? "ON" : "OFF"}</p>
      <p>{checkbox}</p>
    </div>
  );
}
```

`checkbox` は **state から計算された JSX.Element**。React からは「ただの子要素」に見えるだけで、独立したノードを作らない → 再マウントしない。

uhyo 氏自身は FC 返しと JSX.Element 返しについて「正直どちらでも良い」とした上で、引数を受け取れる拡張性の観点から `() => JSX.Element`（関数返し）の実用的利点に触れている。**再マウント回避を理由に JSX.Element 返しを推奨しているのは fneco 氏**であり、両者の主張を混同しないこと。

### `() => JSX.Element` 返し版

```tsx
// useCheckboxWithLabel.tsx
import { useState, type ReactNode } from "react";

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
import { useCheckboxWithLabel } from "./useCheckboxWithLabel";

export function App() {
  const [agreed, renderCheckbox] = useCheckboxWithLabel();

  return (
    <form>
      {renderCheckbox("利用規約に同意する")}
      <button disabled={!agreed}>送信</button>
    </form>
  );
}
```

引数を受け取れる拡張性のためにこの形式が選ばれることが多い。型理論的には `T` と `() => T` は副作用を無視すれば同等。`renderCheckbox` 内で hooks を呼んでいない点が重要（呼んだ瞬間に Hooks ルール違反の温床になる）。

## 折衷案 — FC を hook の外に静的定義

アーティス社のブログ「Beyond the render hooks pattern」（2023-01-10）が提案している形。

```tsx
// CheckboxView.tsx — FC は hook の外で定義
import { type FC } from "react";

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
import { useCallback, useState } from "react";
import { CheckboxView } from "./CheckboxView";

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
import { useCheckbox } from "./useCheckbox";

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

FC を hook 内で再生成しないので参照は安定 → 再マウントなし。`react-table` や `react-hook-form` も類似の方針（hook と FC を別管理）を採用しているとの指摘がある。

## 結論まとめ

| 形式 | 再マウント | 評価 |
|---|---|---|
| `useModal()` で `Modal` が **hook 内で定義された React.FC** | 起きる（fneco 氏の検証あり）。完全な防止には全ての参照のメモ化が必要 | **避けるべき** |
| `useCheckbox()` で `checkbox` が **JSX.Element** | 起きない | **本来の形** |
| `useCheckbox()` で関数が JSX を返す（呼び出し側で `{renderXxx()}`） | 起きない | 拡張性目的で実用例多い |
| FC を hook の外で静的定義、hook は FC + props を返す | 起きない | 実用的な折衷 |

「render hooks はアンチパターン」と批判される場合、対象は **FC 返し版**であることが多い。JSX.Element 返し版は技術的なパフォーマンス問題が起きない。

ただし JSX.Element 返し版でも、JSX の中に `{renderXxx()}` のような関数呼び出しが現れることへの違和感（宣言性の低下）は別の論点として残る。

## まとめ

- 「render hooks がアンチパターンか」の議論は「FC 返し」と「JSX.Element 返し」を区別せずに行われがちで、対象が噛み合わない。
- 採用するなら **JSX.Element 返し**、**`() => JSX.Element` 返し**、または **FC を hook 外で静的定義**に限定する。
- そもそも「流行る気配がない」と命名者自身が認めるパターンなので、公開 API として採用する積極的な理由は薄く、内部実装としての整理用途に留めるのが穏当。

## 参考

- LINE 証券「【LINE証券 FrontEnd】コンポーネントをカスタムフックで提供してみた」（初出, 2020-07-08, 鈴木亮太）: https://engineering.linecorp.com/ja/blog/line-securities-frontend-3
- uhyo「Render hooks をコンポーネントの拡張として理解する」: https://qiita.com/uhyo/items/cb6983f52ac37e59f37e
- fneco「render hooks パターンの注意点と対策」（2023-02-15）: https://zenn.dev/fizumi/articles/083db23e25106e
- アーティス社「Beyond the render hooks pattern」（2023-01-10）: https://www.asobou.co.jp/blog/web/reactfc-renderhooks
- React 公式「Preserving and Resetting State」: https://react.dev/learn/preserving-and-resetting-state
- devstation「Why You Shouldn't Put JSX in Custom React Hooks」: https://devstation.hashnode.dev/why-you-shouldnt-put-jsx-in-custom-react-hooks
