---
title: List → Item 構造での削除確認 state は List 側に `target: Item | null` で持つ
tags: [react, state-management, list-pattern, dialog, ui-pattern, state-structure]
---

## TL;DR

- List → Item 構造で削除確認ダイアログを出すなら **List 側に `target: Item | null` を 1 つ持つ**。
- `target` が「開閉フラグ + 対象アイテム」を兼ねるので不整合（開いてるのに target が null 等）が起きない。
- React 公式の「Choosing the State Structure」の原則「Group related state」「Avoid contradictions in state」「Choose your state variables carefully to avoid creating "impossible" states」の直接的な応用。
- Item 側に置くと N 個の state が並ぶ / 削除実行ロジックの責務が混ざる / 親に削除完了を伝える callback が必要、と全部歪む。

## このドキュメントの射程

- 「List → Item でアイテム削除時に確認ダイアログを出す」設計の **state 配置の判断**。
- Provider への昇格タイミングの判断基準も含む。
- 削除以外の「対象アイテム単位の確認 UI」一般にも応用可能。

## React 公式の State Structure 原則

React 公式ドキュメント「Choosing the State Structure」が挙げる原則（見出しそのまま）:

> - **Group related state.** If you always update two or more state variables at the same time, consider merging them into a single state variable.
> - **Avoid contradictions in state.** When the state is structured in a way that several pieces of state may contradict and "disagree" with each other, you leave room for mistakes.
> - **Avoid redundant state.** If you can calculate some information from the component's props or its existing state variables during rendering, you should not put that information into that component's state.
> - **Choose your state variables carefully to avoid creating "impossible" states.**

削除確認 UI の `isOpen` と `targetItem` を別々に持つのは、上の「Group related state」「Avoid contradictions in state」「"impossible" states を作らない」すべてに反する。「常に一緒に更新される」「`isOpen=true && targetItem=null` という不整合状態が表現できる」「`targetItem !== null` から `isOpen` が計算できる」からだ。

→ **1 つの `target: Item | null` にまとめるのが原則どおりの設計**。

> ⚠️ 上記の原則名は React 公式ドキュメントの見出しをそのまま引いたもの。本記事が便宜的に番号を振る場合があるが、それは記事独自の付番であり公式の番号ではない。

## オブジェクト本体を持つか ID を持つか（公式推奨との関係）

React 公式の同ページ Recap には、選択（selection）系の UI について次の注意がある:

> For UI patterns like selection, keep ID or index in state instead of the object itself.

つまり厳密には公式推奨は `targetId: ItemId | null` 寄りである。本記事はあえて `target: Item | null`（オブジェクト本体）を採る。理由は以下のトレードオフを優先しているため:

- ダイアログ内で `target.name` 等をそのまま表示でき、ID から元アイテムを引き直す処理が不要。
- 削除確認のように **対象が短命で、表示中に元リストから消えない**ケースでは、オブジェクト本体の保持で実害が出にくい。

逆に、リストが頻繁に更新され「保持中の `target` が古くなる」恐れがある場合は、公式推奨どおり `targetId` を持ち、描画時に最新リストから引き直すほうが安全。**どちらを選ぶかは「保持中にアイテムが変化しうるか」で判断する**。

## なぜ List 側に置くのが自然か

### 1. Dialog 実体が 1 つで済む

Item 側に持たせると、N 個の Item に N 個の Dialog state（ほぼ全部 closed）が並ぶ。「同時に最大 1 つしか開かない UI」に N 個の state を用意するのは表現として不正確。

List 側に `target: Item | null` を 1 つ持てば、`null` か否かで開閉、非 null ならそれが対象、と **状態が 1 つに集約**される。これは React 公式の「Sharing State Between Components」が言う lifting state up（複数の子で必要な state を共通の親に持ち上げる）の一般化でもある。

### 2. 削除実行ロジックの置き場として自然

削除後はだいたい以下のどれかをやる:

- リスト state から該当要素を除く（楽観的更新）
- `refetch()` / `invalidateQueries()`
- ページネーションのカーソル調整

これらは全部 List のスコープの仕事。Item 側で削除を完結させると、「親に削除完了を伝える callback」が結局必要になり、責務が混ざる。

### 3. Item が pure になる

Item は「削除ボタンを押した」というイベントを親に投げるだけ。`onDeleteRequest(item)` のような 1 つの prop で済み、memo 化もしやすい。

## 完全実装

### 共通の前提

```tsx
// types.ts
export type Item = {
  id: string;
  name: string;
};

// api.ts
export async function deleteItem(id: string): Promise<void> {
  const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete item ${id}`);
}
```

### ItemRow（Pure コンポーネント）

```tsx
// ItemRow.tsx
import { memo } from 'react';
import type { Item } from './types';

type Props = {
  item: Item;
  onDeleteRequest: (item: Item) => void;
};

export const ItemRow = memo(({ item, onDeleteRequest }: Props) => {
  return (
    <li>
      {item.name}
      <button onClick={() => onDeleteRequest(item)}>削除</button>
    </li>
  );
});

ItemRow.displayName = 'ItemRow';
```

Item は state を持たない。「削除ボタンを押した」イベントを `onDeleteRequest` で親に投げるだけ。`memo` で包めるので大量のリストでも再レンダーが抑えられる。

### List（state を保持）

```tsx
// ItemList.tsx
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ItemRow } from './ItemRow';
import { deleteItem } from './api';
import type { Item } from './types';

type Props = {
  items: Item[];
  onItemDeleted: (id: string) => void;
};

export function ItemList({ items, onItemDeleted }: Props) {
  // target: Item | null が「開閉フラグ + 対象アイテム」を兼ねる
  const [target, setTarget] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (!target) return;
    setIsDeleting(true);
    try {
      await deleteItem(target.id);
      onItemDeleted(target.id);
      setTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    if (isDeleting) return;
    setTarget(null);
  };

  return (
    <>
      <ul>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} onDeleteRequest={setTarget} />
        ))}
      </ul>

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>削除確認</AlertDialogTitle>
            <AlertDialogDescription>
              {/* children は親の render 時に評価されるため null ガードする（下記参照） */}
              {target ? `「${target.name}」を削除します。よろしいですか？` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isDeleting}>
              {isDeleting ? '削除中...' : '削除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

### 利用側（ページコンポーネント）

```tsx
// ItemsPage.tsx
import { useState, useEffect } from 'react';
import { ItemList } from './ItemList';
import type { Item } from './types';

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    fetch('/api/items')
      .then((res) => res.json())
      .then(setItems);
  }, []);

  const handleItemDeleted = (id: string) => {
    // 楽観的にローカル state からも除く
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <main>
      <h1>アイテム一覧</h1>
      <ItemList items={items} onItemDeleted={handleItemDeleted} />
    </main>
  );
}
```

### 重要なポイント

- `target` が「開閉フラグ + 対象アイテム」を兼ねる。`isOpen` を別に持たない方が **不整合（開いてるのに target が null、等）が表現できない設計**になる。
- **null ガードが必要な理由**は「Radix/shadcn が closed でも children を評価するから」ではなく、**React が `<AlertDialog>` に渡す children 式を親の render 時に評価して React 要素を組み立てるから**。`open={false}` でも `target.name` を含む式は render 時に評価されるので、`target` が null だと `open` の真偽に関わらずクラッシュする（`<AlertDialogContent>` 自体の DOM へのマウントは `open=true` 時のみで、`forceMount` が例外）。だから `target ? ... : ''` のように render される式の側で 1 箇所ガードを入れる。
- `ItemRow` を `memo` で包む。`onDeleteRequest={setTarget}` は `setTarget` の参照が安定しているので、props も安定し、削除対象以外の行は再レンダーされない。
- `isDeleting` は別 state。「削除確認の対象」と「削除処理の進行」は意味が違うので分けてよい（同じ更新タイミングではない）。

## アンチパターン: Item 側に state を持つ

```tsx
// ❌ Anti-pattern: ItemRow が自分の確認ダイアログ state を持つ
function ItemRow({ item, onDelete }: { item: Item; onDelete: () => Promise<void> }) {
  const [isConfirming, setIsConfirming] = useState(false); // ← 各 Item に state
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      setIsConfirming(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <li>
      {item.name}
      <button onClick={() => setIsConfirming(true)}>削除</button>
      {isConfirming && (
        <AlertDialog open onOpenChange={(o) => !o && setIsConfirming(false)}>
          {/* ... 各 Item に Dialog 実体が並ぶ */}
        </AlertDialog>
      )}
    </li>
  );
}

function ItemList({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          onDelete={async () => {
            await deleteItem(item.id);
            // ↑ Item から削除完了を List に伝える callback が結局必要
            // List の再取得や state 更新はここではできない
          }}
        />
      ))}
    </ul>
  );
}
```

問題:

1. N 個の Item に N 個の Dialog state（ほぼ全部 closed）。
2. 削除完了を List に伝える callback が結局必要 → 責務が混ざる。
3. リスト state から要素を除く処理を Item 側で書けない（自分自身を消すのは不自然）。
4. Item の `memo` 化が難しくなる（state を持つので頻繁に再レンダー）。

## State Colocation も後押し

Kent C. Dodds の「State Colocation will make your React app faster」は補完的:

> When we manage the state higher up in the React component tree, every update to that state results in an invalidation of the entire React tree. (...) But if you move your state further down the React tree (...) then React has less to check.

「state はそれを使う場所にできるだけ近く置く」という原則。**削除確認 state を更に上位（例えば Page や App ルート）に置くと、List 自体に関係ない他のコンポーネントまで再レンダーの検査対象に入る**。List で持つのはこの観点でも正しい。

なお、ここで言う invalidation は「再レンダー対象として検査される」であって、必ず実描画されるという意味ではない（`React.memo` 等で実際の再描画は抑制されうる）。それでも検査範囲を狭く保つこと自体に価値がある。

state を Provider 等に昇格する判断は「再利用範囲が広がった時」に行う、というのが Kent C. Dodds の主張に沿う。

## Item 側に置くべきケース（少数派）

- リスト要素ごとに削除ダイアログの内容が**構造的に違う**（フォームを出す、子要素一覧を出す、など Item 固有の文脈が大きい）。
- 仮想スクロールで Item がアンマウントされても Dialog を残したい → これはむしろ List or Provider に上げる動機。

## List 保持 vs Provider 昇格の境界

**List 保持で十分**:

- ページ内の List が 1 つ、削除も List 由来。

**Provider に上げる動機**:

- 同ページに削除可能な独立リストが複数ある。
- List 以外（詳細画面、ヘッダーメニュー）からも削除を起動する。
- 削除以外の確認ダイアログも共通化したい（汎用 `useConfirm`）。

これらに当てはまらないなら Provider は overkill。**List ローカルの `useState` で始めて、必要になったら昇格**で良い。

## まとめ

- 「対象アイテム単位の確認 UI」の state は List 側に `target: Item | null` で 1 個持つ。
- React 公式の "Group related state" / "Avoid contradictions in state" / "impossible states を作らない" の応用。
- `isOpen` を別に持たないことで「開いてるのに対象が無い」状態を型レベルで排除できる。
- 公式は selection に ID/index を推奨するので、オブジェクト本体を持つのは「保持中に変化しない」前提での意図的なトレードオフと理解しておく。
- Provider への昇格は「複数 List / List 外からも起動 / 確認以外も共通化」が現れてから。

## 参考

- React 公式「Choosing the State Structure」: https://react.dev/learn/choosing-the-state-structure
- React 公式「Sharing State Between Components」: https://react.dev/learn/sharing-state-between-components
- React 公式「Managing State」: https://react.dev/learn/managing-state
- Radix UI AlertDialog（Content の DOM マウントは open=true 時 / forceMount）: https://www.radix-ui.com/primitives/docs/components/alert-dialog
- Kent C. Dodds「State Colocation will make your React app faster」: https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
- Kent C. Dodds「Application State Management with React」: https://kentcdodds.com/blog/application-state-management-with-react
