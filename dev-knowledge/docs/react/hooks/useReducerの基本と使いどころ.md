---
title: useReducer の基本・パターン・useState からの書き換え
tags: [react, hooks, useReducer, useState, reducer, dispatch, typescript, discriminated-union, state-machine, form]
---

## TL;DR

- `useReducer` は `useState` と等価な state 管理 hook。「state をどう変えるか（reducer）」と「何が起きたか（action を dispatch）」を分離する。
- シグネチャは `const [state, dispatch] = useReducer(reducer, initialArg, init?)`。第3引数 `init` を渡すと初期 state は `init(initialArg)` で遅延計算される。
- action は慣習として `{ type: '...' , ...追加情報 }` のオブジェクト。`type` は「何が起きたか」を表す。
- 威力を発揮するのは「相互に関連する複数 state」「前の state に依存する更新」「状態遷移が決まっている（フォーム・トグル群・ステートマシン）」場面。
- TypeScript では action を **discriminated union**（`type` をリテラルで判別）にすると、`switch (action.type)` で各 case の payload が型安全に絞り込まれる。
- reducer は純粋関数であること（state を mutate しない・副作用を持たない）が必須。

---

## 1. useState の単純な例 → useReducer に書き換える（等価な対比）

### カウンター

```tsx
// useState 版
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setCount(count - 1)}>-</button>
      <span>{count}</span>
      <button onClick={() => setCount(count + 1)}>+</button>
      <button onClick={() => setCount(0)}>reset</button>
    </>
  );
}
```

```tsx
// useReducer 版（等価）
import { useReducer } from 'react';

function reducer(state, action) {
  switch (action.type) {
    case 'increment': return state + 1;
    case 'decrement': return state - 1;
    case 'reset':     return 0;
    default: throw Error('Unknown action: ' + action.type);
  }
}

function Counter() {
  const [count, dispatch] = useReducer(reducer, 0);
  return (
    <>
      <button onClick={() => dispatch({ type: 'decrement' })}>-</button>
      <span>{count}</span>
      <button onClick={() => dispatch({ type: 'increment' })}>+</button>
      <button onClick={() => dispatch({ type: 'reset' })}>reset</button>
    </>
  );
}
```

ポイント: コンポーネント側は「`{ type: 'increment' }` を dispatch する＝何が起きたかを通知する」だけになり、`+1` という更新ロジックは reducer に集約される。

### フォーム

```tsx
// useState 版（フィールドごとに setter）
function Form() {
  const [name, setName] = useState('');
  const [age, setAge] = useState(0);
  return (
    <>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <input value={age} onChange={(e) => setAge(Number(e.target.value))} />
    </>
  );
}
```

```tsx
// useReducer 版（1 つの state オブジェクトにまとめる）
const initialState = { name: '', age: 0 };

function reducer(state, action) {
  switch (action.type) {
    case 'changed_name': return { ...state, name: action.value };
    case 'changed_age':  return { ...state, age: action.value };
    default: throw Error('Unknown action: ' + action.type);
  }
}

function Form() {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <>
      <input
        value={state.name}
        onChange={(e) => dispatch({ type: 'changed_name', value: e.target.value })}
      />
      <input
        value={state.age}
        onChange={(e) => dispatch({ type: 'changed_age', value: Number(e.target.value) })}
      />
    </>
  );
}
```

---

## 2. 基本シグネチャと遅延初期化

```tsx
const [state, dispatch] = useReducer(reducer, initialArg, init?);
```

- `reducer`: `(state, action) => nextState` の純粋関数。
- `initialArg`: 初期 state（または `init` に渡す元の値）。
- `init`（省略可）: 初期化関数。指定すると初期 state は `init(initialArg)` の結果になる。未指定なら `initialArg` がそのまま初期 state。

返り値は `[現在の state, dispatch 関数]` の 2 要素。`dispatch(action)` は **次のレンダー用に** state を更新する（dispatch 直後に state を読んでも古い値のまま）。

### init による遅延初期化

初期 state の計算が重い場合、`init` を渡すと「毎レンダーで計算し直す」のを避けられる。

```tsx
function createInitialState(username) {
  const todos = [];
  for (let i = 0; i < 50; i++) {
    todos.push({ id: i, text: username + "'s task #" + (i + 1) });
  }
  return { draft: '', todos };
}

// 第2引数を init に渡し、初期化は init(username) として実行される
const [state, dispatch] = useReducer(reducer, username, createInitialState);
```

注意: `useReducer(reducer, createInitialState(username))` と直接呼ぶと毎レンダーで関数が実行される（結果は捨てられるが計算は走る）。`init` 引数で関数自体を渡すのが遅延初期化のポイント。

---

## 3. action オブジェクトの設計（type と payload）

慣習として action は `type` を持つオブジェクトにする。`type` は「何が起きたか（ユーザーが何をしたか）」を表す文字列、それ以外のフィールドにイベントの付加情報を載せる。

```tsx
// type だけ
dispatch({ type: 'incremented_age' });

// type + 追加情報（react.dev では nextName のように直接フィールドを置く例が多い）
dispatch({ type: 'changed_name', nextName: e.target.value });

// payload にまとめるスタイル（Redux 系で一般的）
dispatch({ type: 'added', payload: { id, text } });
```

設計の指針（react.dev）:

- `type` は「どう state を変えるか」ではなく「**何が起きたか**」を表す名前にする（`set_field` より `changed_name` など）。
- 1 つのユーザー操作 = 1 つの action。フォームリセットなら `{ type: 'reset_form' }` 1 回で、フィールドごとに複数 dispatch しない。
- action に載せる情報は最小限に。

`payload` という単一キーにまとめるか、フィールドを直接置くかは流儀の差。react.dev のチュートリアルはフィールド直置き、Redux 文化では `payload` キーが一般的。どちらでもよい。

---

## 4. useReducer が威力を発揮する具体例

### (a) 相互に関連する複数の state

複数フィールドを 1 オブジェクトで持ち、更新ロジックを reducer に集約できる（上記フォーム例）。setter が散らばらず、「どの操作でどう変わるか」を 1 箇所で見渡せる。

### (b) 前の state に依存する更新

reducer は常に最新の `state` を引数で受け取るので、`state.count + 1` のような前依存更新を安全に書ける。

```tsx
function reducer(state, action) {
  switch (action.type) {
    case 'increment': return { ...state, count: state.count + 1 };
    default: throw Error('Unknown action');
  }
}
```

### (c) トグル群（同種の操作が多いリスト）

ハンドラが増えても action の type で分岐できるので、コンポーネント側がすっきりする。

```tsx
function reducer(tasks, action) {
  switch (action.type) {
    case 'added':
      return [...tasks, { id: action.id, text: action.text, done: false }];
    case 'toggled':
      return tasks.map((t) =>
        t.id === action.id ? { ...t, done: !t.done } : t
      );
    case 'deleted':
      return tasks.filter((t) => t.id !== action.id);
    default:
      throw Error('Unknown action: ' + action.type);
  }
}

const [tasks, dispatch] = useReducer(reducer, initialTasks);
// dispatch({ type: 'toggled', id }) のように使う
```

### (d) 状態遷移が決まっている（ステートマシン的）

「取りうる状態」と「許される遷移」が決まっているものは reducer と相性が良い。不正な遷移を reducer 側で弾ける。

```tsx
// idle → loading → success / error の遷移
const initial = { status: 'idle', data: null, error: null };

function reducer(state, action) {
  switch (action.type) {
    case 'fetch':    return { status: 'loading', data: null, error: null };
    case 'resolved': return { status: 'success', data: action.data, error: null };
    case 'rejected': return { status: 'error',   data: null, error: action.error };
    default: throw Error('Unknown action: ' + action.type);
  }
}
```

useReducer が有効な目安（react.dev）: イベントハンドラをまたいで state 更新が多い／state 更新のバグが頻発する／構造を入れて見通しを良くしたい、というとき。reducer は純粋関数なので、コンポーネントから切り出して単体テストしやすく、`console.log` を仕込めばすべての更新とその原因を追える利点もある。逆に単純な state なら `useState` のままで十分。両者は同じコンポーネント内で併用・相互変換が自由。

---

## 5. TypeScript での action 型付け（discriminated union）

`type` フィールドをリテラル型で持たせた **discriminated union** にすると、`switch (action.type)` の各 case 内で action の payload が自動的に絞り込まれる（型安全）。

```tsx
import { useReducer } from 'react';

type State = { name: string; age: number };

// 各 action を | で union。type がリテラルで判別子になる
type Action =
  | { type: 'changed_name'; value: string }
  | { type: 'changed_age'; value: number }
  | { type: 'reset' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'changed_name':
      // ここでは action は { type: 'changed_name'; value: string } に絞り込まれる
      return { ...state, name: action.value };
    case 'changed_age':
      return { ...state, age: action.value }; // action.value は number
    case 'reset':
      return { name: '', age: 0 };
    default: {
      // 全 case を網羅していれば action は never になる（網羅性チェック）
      const _exhaustive: never = action;
      throw Error('Unknown action: ' + (_exhaustive as Action).type);
    }
  }
}

function Form() {
  const [state, dispatch] = useReducer(reducer, { name: '', age: 0 });
  // dispatch({ type: 'changed_name', value: 'x' }) // OK
  // dispatch({ type: 'changed_name', value: 1 })   // 型エラー（value は string）
  return null;
}
```

ポイント:

- union の各メンバーが必要な payload だけを持つので、`changed_name` に number を渡すなどのミスがコンパイル時に弾かれる。
- `default` で `never` 代入を使うと、後から action を増やしたとき網羅漏れを型エラーで気づける（網羅性チェック）。
- `useReducer<React.Reducer<State, Action>>(...)` のようにジェネリクスで明示することもできるが、reducer の引数・返り値に型を付けておけば多くの場合は推論で足りる。

---

## まとめ

1. `useReducer` は state を「reducer（どう変わるか）」と「dispatch する action（何が起きたか）」に分離する hook。`useState` と等価で相互変換可能。
2. シグネチャは `useReducer(reducer, initialArg, init?)`。`init` を関数で渡すと初期 state を遅延計算できる。
3. action は `{ type, ...情報 }` の慣習。`type` は「何が起きたか」を表す。
4. 相互に関連する複数 state・前依存更新・決まった状態遷移（フォーム／トグル群／ステートマシン）で威力を発揮する。
5. TypeScript では action を discriminated union にすると payload が型安全に絞り込まれ、`never` 代入で網羅性も担保できる。
6. reducer は純粋関数（mutate しない・副作用なし）が必須。

## 参考

- React 公式 useReducer リファレンス（シグネチャ・init による遅延初期化・dispatch・action の慣習・カウンター/フォーム例）: https://react.dev/reference/react/useReducer
- React 公式「Extracting State Logic into a Reducer」（useState→useReducer の 3 ステップ書き換え・action 設計・使いどころ・reducer を純粋に保つ）: https://react.dev/learn/extracting-state-logic-into-a-reducer
