---
title: useState と useReducer の使い分け
tags: [react, hooks, useState, useReducer, reducer, dispatch, state, 設計]
---

## TL;DR

- まず `useState` が前提。**state 更新のバグに頻繁に遭遇する／コードに構造を入れたい**ときに `useReducer` を検討する（react.dev の明言）。
- `useReducer` の本質は「state の更新ロジックをコンポーネント外の純粋関数（reducer）に集約し、**変更を action 経由に縛る**」こと。直接 set するのではなく「何が起きたか（action）」を dispatch する。
- 利点: 更新ロジックの集約／「how（reducer）と what happened（action）」の分離／純粋関数なので単体テストしやすい／`console.log` で全更新とその原因を追える。
- 欠点（公式も明記）: reducer と dispatch の**両方を書くボイラープレートが増える**／単純な state には過剰／デバッグ時にステップ数が増える／間接的になる。
- どちらが正解ということはない。**好みの問題**で、同一コンポーネント内で `useState` と `useReducer` を併用してもよい。

---

## 背景：何に悩むのか

`useState` は手軽だが、state 更新ロジックが多数のイベントハンドラに散らばると、

- どこで・どういう更新が起きるのか追いにくい
- 不正な状態（ありえない組み合わせ）を作ってしまうバグが出る

という辛さが出てくる。「変更方法を縛りたい（決まった操作からしか state を変えられないようにしたい）」というのが `useReducer` を検討する動機になる。

---

## useReducer の「変更を縛れる」とはどういうことか

`useState` は呼び出し側がどんな値でも自由に `setState` できる。一方 `useReducer` では、

- コンポーネント側にできるのは `dispatch(action)`、つまり「**何が起きたか**を通知する」ことだけ。
- 実際にどう state が変わるかは reducer が一手に決める。

```tsx
// useState: 呼び出し側が好きに値を入れられる
setStatus('loading');
setStatus('badValue'); // これも通ってしまう

// useReducer: 許された action しか起こせない。遷移ルールは reducer 内に閉じる
dispatch({ type: 'fetch' });    // idle/error → loading
dispatch({ type: 'resolved' }); // loading → success
// 不正な遷移は reducer 側で弾ける／そもそも該当 action を用意しない
```

これにより「取りうる状態」と「許される遷移」を reducer に集約でき、ステートマシン的に状態を管理できる。これが「変更方法を縛れる」の中身。

---

## 公式が示す使い分けの目安

react.dev は「どちらが絶対」とは言わず、次の基準を示している。

> 誤った状態更新によるバグに頻繁に遭遇し、コードにより多くの構造を導入したい場合は reducer の利用を推奨する。すべてに reducer を使う必要はなく、自由に組み合わせてよい。

**useReducer に切り替えるサイン:**

- 誤った state 更新のバグに**頻繁に**遭遇する
- コードに**より多くの構造**を入れて見通しを良くしたい
- 多くのイベントハンドラが**似た方法で**state を更新している

**useState のままでよいケース:**

- state 更新が単純で、`useState` の方が読みやすいとき（無理に reducer 化しない）

---

## useState と useReducer の比較（公式の4観点）

| 観点 | useState | useReducer |
|---|---|---|
| **コードサイズ** | 前もって書く量が少ない | reducer + dispatch で多め。ただし**似た更新が多いほど**全体のコードは減る |
| **可読性** | 単純な更新では読みやすい | 複雑な更新で「how（reducer）／ what happened（action）」を分離でき読みやすい |
| **デバッグ** | どこで・なぜ誤ったか追いにくい | reducer に `console.log` を仕込めば**全更新とその原因（action）**を追える。ただしステップ数は増える |
| **テスト** | コンポーネントごとに実環境でテスト | reducer は純粋関数なので**単独で export してテスト**できる |

---

## useReducer のデメリット（公式の表現）

- **ボイラープレートが増える**：reducer 関数と dispatch の両方を書く必要がある。
- **単純なケースでは過剰**：`useState` の方が読みやすい場面で reducer を入れると、かえって複雑になる。
- **デバッグのステップ数が増える**：`useState` より多くのコードを追う必要がある。
- **間接的になる**：「what happened（dispatch）」と「how（reducer）」が分離されるぶん、処理が一直線でなくなる（可読性の利点の裏返し）。

---

## 判断フロー（実用上の目安）

1. まず `useState` で書く。
2. 「相互に関連する複数 state」「決まった状態遷移」「同種の更新ハンドラが増えてきた」「不正な state のバグが出る」のいずれかに当てはまったら `useReducer` を検討。
3. それでも state が単純なら `useState` のままでよい。**好みの問題**であり、同一コンポーネントで併用してもよい。

> 具体的なシグネチャ・書き換え手順・action 設計・TypeScript での型付けは
> [useReducer の基本・パターン](./useReducerの基本と使いどころ.md) を参照。

---

## まとめ

- `useReducer` は「state 更新を action に縛り、ロジックを純粋関数に集約する」ための hook。状態遷移を厳格に管理したいときに効く。
- 切り替えのサインは「更新バグの頻発」「構造を入れたい」「似た更新ハンドラが多い」。単純な state なら `useState` のままでよい。
- デメリットはボイラープレート増・単純ケースでの過剰・デバッグのステップ増・間接化。利点（集約・分離・テスト容易・追跡容易）とのトレードオフで選ぶ。
- 最終的には好みの問題で、両者は併用・相互変換が自由。

## 参考

- React 公式「Extracting State Logic into a Reducer」内 "Comparing useState and useReducer"（コードサイズ／可読性／デバッグ／テストの4観点比較、切り替えのサイン）: https://react.dev/learn/extracting-state-logic-into-a-reducer
- React 公式 useReducer リファレンス（シグネチャ・dispatch・action の慣習）: https://react.dev/reference/react/useReducer

（出典は react.dev・React 19 系の最新ドキュメント、2026-06-22 時点で確認）
