---
title: 楽観更新の rollback を snapshot 比較から inverse operations 方式に変えた設計判断
tags: [react, optimistic-update, rollback, inverse-operations, state-management]
---

## TL;DR

- 楽観更新の失敗時に「更新前 snapshot 全体で復元」する方式は、**楽観更新中に外部（watcher 等）から来た変更ごと巻き戻す**。
- 各 operation の**逆操作（inverse）を現在の state に適用**し、自分が触れた path だけを戻す方式に変える。外部変更は保持される。

## 遭遇した問題

`TaskLinks` の楽観更新で、旧方式は「`current == optimistic`（field 全体が一致）のときだけ snapshot を復元」だった。しかし外部更新（ファイル watcher など）が併存すると、その外部変更ごと巻き戻してしまう。

```ts
// 旧: field 全体を比較して snapshot 復元
if (deepEqual(current, optimistic)) {
  setState(snapshotBeforeOptimistic); // ← 外部変更も消える
}
```

## 原因

**snapshot 全体比較 = 「楽観更新前の状態にまるごと戻す」** なので、楽観更新の最中に外部から入った変更も「楽観更新前」に戻される。必要なのは「**自分（楽観更新）が触れた箇所だけ**を戻す」仕組み。

- field 全体一致を条件にしても、外部変更が入ると `current != optimistic` になり復元が走らない、または復元すると外部変更を潰す、というジレンマになる。

## 解決

**inverse operations 方式**に変更する。楽観更新を「operation の列」として表現し、rollback 時は各 operation の**逆操作を現在の state に適用**する。

- rollback は snapshot への置換ではなく、**現在 state からの差分巻き戻し**なので、自分が触れた path だけが戻り、外部変更は残る。
- `remove` の inverse は `insert`。どこに挿し戻すかは、plan 時に記録した **snapshot 内の数値 index** へ挿入する。

```ts
type Op =
  | { kind: "add"; path: Path; value: Link }
  | { kind: "remove"; path: Path; index: number; value: Link }; // index を plan 時に記録

// 逆操作を現在 state に適用（触れた path だけ戻る）
function invert(op: Op): (s: State) => State {
  switch (op.kind) {
    case "add":
      return (s) => removeAt(s, op.path); // add の逆は remove
    case "remove":
      return (s) => insertAt(s, op.path, op.index, op.value); // remove の逆は index 復元
  }
}
```

- `remove` の逆は「plan 時に記録した数値 index に value を挿し戻す」ことで順序も復元できる。
- **round-trip テスト**（apply → invert で元に戻る）で不変条件を固定した。

## まとめ

- 楽観更新の rollback は snapshot 全体復元にしない（外部変更を巻き込む）。
- operation の inverse を現在 state に適用し、触れた path だけ戻す。`remove` の逆は記録済み index への insert。round-trip テストで担保する。
