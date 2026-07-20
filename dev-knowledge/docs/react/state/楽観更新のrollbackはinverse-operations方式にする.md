---
title: 楽観更新の rollback は snapshot 比較ではなく inverse operations 方式にする
tags: [react, optimistic-update, rollback, inverse-operations, state-management]
---

## 問題

`TaskLinks` の楽観更新（optimistic update）で、旧方式は「**`current == optimistic`（field 全体一致）のときだけ snapshot を復元**」だった。

しかし外部更新（watcher など）が併存すると、楽観更新中に外部から来た変更ごと巻き戻してしまう。

```ts
// 旧方式（動かないケースあり）: field 全体を snapshot と比較
function rollback(current, snapshot, optimistic) {
  if (deepEqual(current, optimistic)) {
    return snapshot; // ← 全体を戻す。外部変更も一緒に消える
  }
  return current;
}
```

## 原因

snapshot 全体比較では、**楽観更新中に外部から来た変更も「楽観更新前の状態」に巻き戻される**。

- 楽観更新 A を出した後、サーバ側の watcher が別フィールド B を更新して届く。
- A が失敗して rollback すると、全体 snapshot を復元する＝B の更新まで捨ててしまう。

必要なのは「**自分が触れた箇所だけ**を戻す」仕組み。全体一致を条件にしても、外部変更が混ざった瞬間に条件が崩れる（あるいは戻しすぎる）。

## 解決

**inverse operations 方式**を採用した。各 operation の**逆操作**を現在 state に適用し、**自分が触れた path のみ**を戻す。

```ts
// plan 時に、各操作と「その逆操作」を記録する
type Op =
  | { type: "set"; path: Path; value: unknown; inverse: unknown }
  | { type: "remove"; path: Path; index: number /* 復元先 */ };

// rollback: 逆操作を現在 state に適用（触れた path だけ変わる）
function rollback(current: State, ops: Op[]): State {
  let next = current;
  for (const op of ops.reverse()) {
    next = applyInverse(next, op); // op が触れた path のみ変更
  }
  return next;
}
```

ポイント:

- **`remove` の inverse は「plan 時に記録した snapshot 内の数値 index へ挿入」**する。remove の逆は insert だが、「どこへ戻すか」は削除時点の位置に依存するため、plan 時に index を控えておく。
- 逆操作は「自分が set/remove した path」しか触らないので、その間に外部から来た別 path の変更は保持される。

### round-trip テストで固定

「操作 → 逆操作」で元に戻ることを round-trip テストで固定し、inverse の実装ミス（特に remove/insert の index）を検知できるようにした。

```ts
test("apply then inverse restores touched paths only", () => {
  const after = applyOps(before, ops);
  const restored = rollback(withExternalChange(after), ops);
  // 自分が触れた path は before に戻り、外部変更は残る
  expect(restored).toEqual(mergeExternalChange(before));
});
```

## 教訓

- 楽観更新の rollback は「全体 snapshot 復元」ではなく「**自分が触れた path の逆操作**」で行う。外部更新との併存に耐える。
- `remove` の逆操作は挿入位置（index）が要る。plan 時点で snapshot 内の数値 index を記録しておく。
- inverse の正しさは round-trip テスト（操作→逆操作で戻る）で固定する。index ずれのようなバグはここで出る。
