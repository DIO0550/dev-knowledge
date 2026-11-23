---
title: 楽観更新の rollback は snapshot 全体復元ではなく inverse operations 方式で戻す
tags: [react, state-management, optimistic-update, rollback, inverse-operations]
---

## TL;DR

- 楽観更新の失敗時に「更新前の snapshot 全体で復元」する方式は、**楽観更新の進行中に外部（ファイル watcher・WebSocket・別操作など）から入った変更まで巻き戻してしまう**。
- 楽観更新を操作列（operation）として表し、rollback 時は**各操作の逆操作（inverse）を現在の state へ適用**する。自分が触れた箇所だけを戻せるため、外部変更を保持できる。
- `remove` の逆操作は `insert` とし、計画時に記録したインデックスへ挿し戻す。`apply → invert` で元に戻ることを round-trip テストで固定する。

## 背景・射程

UI の応答性を上げるために楽観更新を行う場面で、同時に外部からの状態更新（ファイル watcher、WebSocket のプッシュ、並行する別リクエストなど）が入りうる構成を対象とする。

単一のユーザー操作しか state を書き換えない閉じた画面であれば、単純な snapshot 復元でも破綻しにくい。一方、外部更新と並行する state では「楽観更新が失敗したときに何をどこまで戻すか」が設計上の分岐点になる。

## 判断軸・比較

| 方式 | 外部変更が並行したときの挙動 | 実装コスト |
|---|---|---|
| snapshot 全体復元 | 更新前の状態に丸ごと戻るため、**外部変更が消える** | 低い |
| `current == optimistic` 比較＋復元 | 外部変更が入ると一致せず **rollback がスキップされる**（消えるか戻せないかの二択） | 低い |
| **inverse operations 方式** | 現在の state に対して逆操作を当てるため、**自分の変更だけを戻し外部変更を残せる** | 中（操作定義＋逆操作が必要） |

### NG：snapshot 全体を比較・復元する方式

```ts
// 更新前 snapshot を丸ごと戻すと、進行中に入った外部変更まで消える
if (deepEqual(current, optimistic)) {
  setState(snapshotBeforeOptimistic);
}
```

`current == optimistic` の一致を条件にしても、「外部変更が入った瞬間に rollback できなくなる」か「条件を外すと外部変更を上書きして消す」のジレンマから抜け出せない。

## 指針

楽観更新を「operation の列」として表現し、rollback では snapshot への置換ではなく**現在の state に対する逆操作の適用**で差分を巻き戻す。

```ts
type Op =
  | { kind: 'add'; path: Path; item: Item }
  | { kind: 'remove'; path: Path; index: number; item: Item }; // 計画時に元 index を記録

// 逆操作を現在の state に適用し、自分が触れた箇所だけを戻す
function invert(op: Op): (state: State) => State {
  switch (op.kind) {
    case 'add':
      return (state) => removeById(state, op.path, op.item.id);
    case 'remove':
      return (state) => insertAt(state, op.path, op.index, op.item);
  }
}
```

- **順序の復元**：`remove` の逆操作では、操作計画時に記録した数値 `index` へ要素を挿し戻すことで元の並び順を再現できる（外部更新で配列長が変わっている場合は `Math.min(op.index, list.length)` でクランプする）。
- **複数操作の巻き戻し**：操作列 `[op1, op2, ...]` を適用した場合は、**逆順**に `invert(op)` を適用する。
- **不変条件の担保**：`apply` してから `invert` を当てると元の state に一致する **round-trip テスト**を書いておくと、操作種別を増やした際の巻き戻し漏れを防げる。
