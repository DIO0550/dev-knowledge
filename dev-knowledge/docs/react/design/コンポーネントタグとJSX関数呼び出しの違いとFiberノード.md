---
title: React の `<A />` と `{a()}` の違い - Fiber ノードとフックの所属
tags: [react, fiber, jsx, hooks, mental-model, reconciliation, react-rules]
---

## TL;DR

- `<A />` は React に「A 専用の Fiber ノードを作って」と伝える書き方。A の state, effect, key, ref はそのノードに紐づく。
- `{a()}` はただの関数呼び出し。戻り値（React Element）が**親の children に展開**されるだけで、A 専用のノードは作られない。
- `a()` の中で hooks を呼ぶと、それは **呼び出し元のフックとして登録**される。
- React 公式ルール「Never call component functions directly」が具体的な問題として挙げているのは「**hooks を持つ関数を `{a()}` で呼ぶ**」ケース。ただしルール自体は hooks の有無を問わず「JSX で使え」と推奨している点に注意。

## このドキュメントの射程

- React で JSX に書く `<A />` と `{a()}` の振る舞いの違いを Fiber tree レベルで整理する。
- 公式ルール「Never call component functions directly」の適用範囲を明確化する。
- render hooks パターンがなぜ「ライフサイクルが変にならず」動くかを理解するための基礎。
- 「コンポーネントに切り出すか / ただの関数で十分か」の判断基準。

## 内部メカニクス

### `<A />` の場合

```tsx
<div><A /></div>
// ↓ Babel/TS が変換（旧 transform の例）
React.createElement("div", null, React.createElement(A, null));
```

→ React は A を「コンポーネント」として認識し、**Fiber tree に A 専用のノードを作る**。state, effect, reconciliation, key, ref はこのノード単位で管理される。

### `{a()}` の場合

```tsx
<div>{a()}</div>
// ↓
React.createElement("div", null, a());
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

React 公式ドキュメント `react.dev/reference/rules/react-calls-components-and-hooks` には以下のルールがある（逐語）。

> Components should only be used in JSX. Don't call them as regular functions.

そして bad example として `{Article()}` が挙げられている。

```tsx
return <Layout>{Article()}</Layout>; // 🔴 Bad: Never call them directly
// ✅ Good
return <Layout><Article /></Layout>;
```

このルールの理由として公式が挙げているのは（逐語）:

> If a component contains Hooks, it's easy to violate the Rules of Hooks when components are called directly in a loop or conditionally.

つまり**最も具体的で深刻な問題は「hooks を持つ関数を `{a()}` 形式で呼ぶ」こと**。hooks を持たない純粋な JSX 生成関数の呼び出しは、Rules of Hooks の観点では多くの場合そのまま動く。

ただし公式ルールの文言は「hooks を持つ場合に限る」とは書いておらず、無条件に「JSX で使え」と推奨している点には注意したい。公式が `<A />` 形式の利点として挙げている理由は hooks 以外にもある:

- **Components become more than functions**（hooks による local state がコンポーネントの identity に結びつく）。
- **Component types participate in reconciliation**（tree 構造の認識・`key` による安定した identity に使われる）。
- **React can enhance your user experience**（concurrent rendering 等の最適化のため。レンダリングの合間にブラウザ処理を挟める）。
- DevTools のツリーに現れ、可観測性が保たれる。

したがって「hooks を持たないなら `{a()}` でも問題ない」は Rules of Hooks の文脈では正しいが、「だから公式ルールの対象外」と一般化するのは言い過ぎ。**純粋な JSX 生成関数であっても、安全側に倒すなら `<A />` を使う**のが公式の意図に沿う（特に「今は hooks を持たないが後で追加する」ケースで静かに壊れるのを防げる）。

## hooks の所属がどう変わるか

### a() が hooks を呼ばない場合 → ただの JSX 切り出し

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

  // 下の 2 つは React から見て同じ（Rules of Hooks 上の問題は起きない）
  return (
    <div>
      {renderCheckbox()}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.currentTarget.checked)}
      />
    </div>
  );
}
```

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
  // ❌ a の中で useState を呼んでいるため Hooks ルール違反
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

これを `<A />` 形式で書くと正しく動く。

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

uhyo 氏の Qiita 記事でも、フックの中で別のフックを使う場合の帰属について以下のように説明している。

> ただし、実際の React ではステートはコンポーネントに属するものですから、コンポーネントをカスタムフックにした時点で `useState` はそのコンポーネントではなく `useCheckbox` を呼び出した親側に属するように変わります。

## 振る舞いマトリクス

| | hooks 使う | hooks 使わない |
|---|---|---|
| `<A />` で使う | **正しい使い方**（コンポーネント） | OK（state なしコンポーネント） |
| `{a()}` で使う | **危険**（親のフックになる、条件付き呼び出しで Hooks ルール違反） | 動くが非推奨（後述） |

公式ルールが最も警告しているのは左下のセル。render hooks の `renderCheckbox` は右下のセル（hooks 使わない × `{a()}` 形式）に該当するので、Hooks ルール上の問題は起きない。ただし右下も「Rules of Hooks 上は問題ない」だけで、reconciliation・`key`・DevTools 可視性・将来の変更耐性の観点からは `<A />` 形式が安全、という公式の推奨は残る。

## 判断基準

- **`<A />` を使うべき** → 独立したライフサイクル / 独立した state / key で識別したい / memo で再レンダーを切り離したい場合。「ツリーにぶら下げて React に管理させたい」とき。

```tsx
import { useState } from 'react';

type Item = { id: string; name: string };

// 各 ItemRow が独自の hover state を持ちたい
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

- `<A />` は Fiber ノードを作る、`{a()}` は親に取り込まれる。
- hooks は呼び出し元コンポーネントに登録される。
- 公式ルール「Never call component functions directly」が具体的に問題視するのは「hooks を持つ関数を `{a()}` で呼ぶ」ケース。ただしルール自体は hooks の有無を問わず JSX 利用を推奨しており、純粋関数でも `<A />` のほうが安全。
- 「コンポーネントに切り出すかどうか」の判断基準は **ライフサイクルを分けたいかどうか**。

## 参考

- React 公式「React calls Components and Hooks」: https://react.dev/reference/rules/react-calls-components-and-hooks
- React 公式「Rules of Hooks」: https://react.dev/reference/rules/rules-of-hooks
- React 公式「Components and Hooks must be pure」: https://react.dev/reference/rules/components-and-hooks-must-be-pure
- Kent C. Dodds「Don't call a React function component」: https://kentcdodds.com/blog/dont-call-a-react-function-component
- uhyo「Render hooks をコンポーネントの拡張として理解する」: https://qiita.com/uhyo/items/cb6983f52ac37e59f37e
