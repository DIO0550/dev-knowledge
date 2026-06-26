---
title: React の `<A />` と `{a()}` の違い - Fiber ノードとフックの所属
tags: [react, fiber, jsx, hooks, mental-model, reconciliation, react-rules]
---

## TL;DR

- `<A />` は React に「A 専用の Fiber ノードを作って」と伝える書き方。A の state, effect, key, ref はそのノードに紐づく。
- `{a()}` はただの関数呼び出し。戻り値（React Element）が**親の children に展開**されるだけで、A 専用のノードは作られない。
- `a()` の中で hooks を呼ぶと、それは **呼び出し元（親）のフックとして登録**される。
- React 公式ルール「Components should only be used in JSX」は **hooks の有無を問わず** `{a()}` 形式を非推奨としている。ただし**バグが実際に顕在化しやすいのは「hooks を持つ関数を `{a()}` で呼ぶ」場合**であり、そこが最も危険なケース。

## このドキュメントの射程

- React で JSX に書く `<A />` と `{a()}` の振る舞いの違いを Fiber tree レベルで整理。
- 公式ルール「Never call component functions directly」が何を禁じ、なぜ危険かを正確に把握する。
- render hooks パターンがなぜ「ライフサイクル変にならず」動くかを理解するための基礎。
- 「コンポーネントに切り出すか / ただの関数で十分か」の判断基準。

## 内部メカニクス

### `<A />` の場合

```tsx
<div>
  <A />
</div>
// ↓ Babel/TS が変換（classic runtime の場合）
React.createElement('div', null, React.createElement(A, null));
```

→ React は A を「コンポーネント」として認識する。`createElement` の戻り値は単なる **React Element（記述オブジェクト）** で、Fiber ノードそのものは **React がこの Element をレンダー（reconcile）する時点で生成される**。生成された Fiber ノード単位で state, effect, reconciliation, key, ref が管理される。

> 「`createElement` された瞬間に Fiber ができる」わけではない点に注意。Element はあくまで設計図で、Fiber はレンダー時に作られる作業単位。

### `{a()}` の場合

```tsx
<div>{a()}</div>
// ↓
React.createElement('div', null, a());
```

→ `a()` は普通の関数呼び出し。戻り値（React Element）が**そのまま親の children に展開**される。a 専用の Fiber ノードは存在せず、**a の中身は親のレンダー結果の一部として扱われる**。

Fiber tree のイメージ:

```
<Child /> の場合:              {renderThing()} の場合:
  Parent                          Parent
    └── div                         └── div
          └── Child  ← ノード             └── input  ← 直接ここに展開
                └── input                          （Parent の一部として扱われる）
```

## 公式ルール「Never call component functions directly」

React 公式ドキュメント `react.dev/reference/rules/react-calls-components-and-hooks` の見出しは「**Components should only be used in JSX**」で、本文には次のようにある:

> Don't call them as regular functions. React should call it.

そして bad example として `<Layout>{Article()}</Layout>`、good example として `<Layout><Article /></Layout>` が挙げられている。

このルールの理由として公式が挙げているのは:

> If a component contains Hooks, it's easy to violate the Rules of Hooks when components are called directly in a loop or conditionally.

ここで重要なのは **解釈の精度**。「hooks を持たない純粋な JSX 生成関数なら公式ルールの対象外」と読むのは **誤り**。公式は "Components should **only** be used in JSX" と **無条件**に述べており、hooks の有無で例外を設けていない。理由は hooks 以外にもある:

- React がそのコンポーネントを独立してレンダー / メモ化 / 最適化できなくなる。
- 将来 hooks を足したときに静かに壊れる。
- React DevTools のツリーに現れない。

正確には **「バグが実際に顕在化しやすいのは hooks を持つ関数を `{a()}` で呼ぶ場合だが、公式ルールは hooks の有無を問わず JSX で使うこと（`<A />`）を求めている」**。慣習として「コンポーネント（PascalCase）」と「単なる JSX を返すヘルパー（camelCase）」を区別する考え方はあるが、それは「hooks がないから `{a()}` で呼んでよい」という公式のお墨付きではない。

公式が挙げる、`<A />` 形式が必要な理由:

- Components become more than functions（hooks による local state がコンポーネントの identity に結びつく）。
- Component types participate in reconciliation（tree 構造の認識に使われる）。
- React can enhance your user experience（concurrent rendering 等の最適化のため）。

## hooks の所属がどう変わるか

### a() が hooks を呼ばない場合 → ただの JSX 切り出し（バグは出にくいが、それでも `<A />` 推奨）

```tsx
// renderCheckbox は hooks を呼ばない。クロージャで checked を参照しているだけ
import { useState } from 'react';

export function App() {
  const [checked, setChecked] = useState(false);

  const renderCheckbox = () => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => setChecked(e.currentTarget.checked)}
    />
  );

  // 下の 2 行は描画結果としては同じだが、後者を「コンポーネント」にしたいなら <A /> 形式にする
  return (
    <div>
      {renderCheckbox()}
    </div>
  );
}
```

この形でバグが出ることはまずない。ただし「独立した管理単位にしたい」なら最初から `<A />` にするのが筋。

### a() が hooks を呼ぶ場合 → 親のフックとして登録

```tsx
import { useState } from 'react';

// ❌ アンチパターン: hooks を呼ぶ関数を {a()} で呼ぶ
function a() {
  const [x, setX] = useState(0); // ← Parent のフックとして登録される
  return (
    <div>
      {x}
      <button onClick={() => setX(x + 1)}>+</button>
    </div>
  );
}

export function Parent() {
  return <div>{a()}</div>;
}
```

つまり「ライフサイクルが変になる」のではなく、**「ライフサイクルの所有者が a から親 Parent に移る」**が正確な表現。

### 落とし穴 1: 条件付き呼び出しで Hooks ルール違反

```tsx
import { useState } from 'react';

function a() {
  const [x, setX] = useState(0);
  return <span>{x}</span>;
}

export function Parent({ condition }: { condition: boolean }) {
  // ❌ a の中で useState を呼んでいるため、Hooks ルール違反
  // condition が変わるとフックの呼び出し順が変わり、React が壊れる
  return <div>{condition && a()}</div>;
}
```

### 落とし穴 2: state がシェアされる

```tsx
import { useState } from 'react';

function a() {
  const [x, setX] = useState(0);
  return (
    <div>
      {x}
      <button onClick={() => setX(x + 1)}>+</button>
    </div>
  );
}

export function Parent() {
  // ❌ a を 2 回呼ぶと、2 つの useState スロットが Parent に登録される
  // 一見「2 つの独立した state」に見えるが、両方とも Parent のフック
  // 呼び出し順に依存するため、a() の追加削除で全てが壊れる
  return (
    <>
      {a()}
      {a()}
    </>
  );
}
```

これを `<A />` 形式で書くと正しく動く:

```tsx
import { useState } from 'react';

function A() {
  const [x, setX] = useState(0); // ← A 専用の Fiber ノードに紐づく
  return (
    <div>
      {x}
      <button onClick={() => setX(x + 1)}>+</button>
    </div>
  );
}

export function Parent() {
  // ✅ それぞれ独立した state を持つ
  return (
    <>
      <A />
      <A />
    </>
  );
}
```

## render hooks がなぜ動くか

```tsx
import { useState } from 'react';

export function useCheckbox() {
  const [checked, setChecked] = useState(false);
  //    ↑ useCheckbox を呼んだコンポーネントのフックとして登録される

  const renderCheckbox = () => (
    // ↑ この関数自体は hooks を呼ばない。クロージャで checked を参照しているだけ
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => setChecked(e.currentTarget.checked)}
    />
  );

  return [checked, renderCheckbox] as const;
}

export function App() {
  const [checked, renderCheckbox] = useCheckbox();
  return <div>{renderCheckbox()}</div>;
  //          ↑ ただの JSX 生成関数を呼んでいるだけ。Fiber ノードは増えない
}
```

React からの見え方:

- `App` のフックとして `useState(false)` が登録される（`useCheckbox` 経由で）。
- `App` の render 結果として `<input>` が出てくる。
- **`useCheckbox` 用 / `renderCheckbox` 用の Fiber ノードは存在しない**。

→ 全部 App のライフサイクルに乗っかる。`renderCheckbox` 自体が hooks を呼ばない限り、Hooks ルール違反は起きない。

カスタムフックにした時点で state の帰属が呼び出し元に移る、という点は uhyo 氏の解説でも触れられている:

> ただし、実際の React ではステートはコンポーネントに属するものですから、コンポーネントをカスタムフックにした時点で `useState` はそのコンポーネントではなく `useCheckbox` を呼び出した親側に属するように変わります。

（出典は下記「参考」を参照。なお「`useState` が親に属する」ことを正面から論じた一次資料としては Kent C. Dodds「Don't call a React function component」も参考になる。）

## 振る舞いマトリクス

| | hooks 使う | hooks 使わない |
|---|---|---|
| `<A />` で使う | **正しい使い方**（コンポーネント） | OK（state なしコンポーネント） |
| `{a()}` で使う | **最も危険**（親のフックになる、条件付き呼び出しで Hooks ルール違反） | バグは出にくいが公式は非推奨 |

公式ルールが警告しているのは下段（`{a()}` 形式）全体だが、実害が最も大きいのは左下のセル。render hooks の `renderCheckbox` は右下のセル（hooks 使わない × `{a()}` 形式）に該当するので、Hooks ルール上の問題は起きない（ただし「JSX に `{renderXxx()}` が現れる宣言性の低下」は別の論点として残る）。

## 判断基準

- **`<A />` を使うべき** → 独立したライフサイクル / 独立した state / key で識別したい / memo で再レンダー切り離したい場合。「ツリーにぶら下げて React に管理させたい」とき。

```tsx
// 各 ItemRow が独自の hover state を持ちたい
import { useState } from 'react';

function ItemRow({ item }: { item: Item }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <li
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ background: isHovered ? '#eee' : 'transparent' }}
    >
      {item.name}
    </li>
  );
}

function ItemList({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((item) => (
        <ItemRow key={item.id} item={item} /> // ← それぞれ独立した isHovered
      ))}
    </ul>
  );
}
```

- **`{a()}` でいい** → 単に JSX を切り出したいだけで、独立した管理対象にする必要がないとき。**ただしその関数内で hooks を使ってはいけない**。

```tsx
// 単に JSX の切り出し。hooks は使わない
import { useState } from 'react';

function App() {
  const [items, setItems] = useState<Item[]>([]);

  const renderEmptyState = () => (
    <div>
      <p>アイテムがありません</p>
      <button onClick={() => fetchItems().then(setItems)}>再読み込み</button>
    </div>
  );

  return (
    <div>
      {items.length === 0 ? renderEmptyState() : <ItemList items={items} />}
    </div>
  );
}
```

## まとめ

- `<A />` は Fiber ノードを作る（レンダー時に生成）、`{a()}` は親に取り込まれる。
- hooks は呼び出し元コンポーネントに登録される。
- 公式ルール「Components should only be used in JSX」は hooks の有無を問わず適用される。実害が最も大きいのは「hooks を持つ関数を `{a()}` で呼ぶ」ケース。
- 「コンポーネントに切り出すかどうか」の判断基準は **ライフサイクルを分けたいかどうか**。

## 参考

- React 公式「React calls Components and Hooks」: https://react.dev/reference/rules/react-calls-components-and-hooks
- React 公式「Rules of Hooks」: https://react.dev/reference/rules/rules-of-hooks
- React 公式「Components and Hooks must be pure」: https://react.dev/reference/rules/components-and-hooks-must-be-pure
- React（legacy）「Reconciliation」: https://legacy.reactjs.org/docs/reconciliation.html
- Kent C. Dodds「Don't call a React function component」: https://kentcdodds.com/blog/dont-call-a-react-function-component
- uhyo「Render hooks をコンポーネントの拡張として理解する」: https://qiita.com/uhyo/items/cb6983f52ac37e59f37e
