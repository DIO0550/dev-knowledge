---
title: state を set する操作が失敗しうるとき、結果をどう扱うか
tags: [react, hooks, state, setState, cqs, custom-hooks, error-handling, design]
---

## このドキュメントの射程

React のカスタムフックで、**state を更新する操作**を提供する。
その操作が**失敗しうる**(不変条件で弾く・バリデーションで拒否する)とき、
成功/失敗や失敗理由を、どう呼び出し側に伝えるかという設計問題を扱う。

配列への要素追加(`add`)を例に使うが、論点は add 固有ではない。
オブジェクトの一部更新、単一値の差し替え、`remove` や `update` でも、
「`setState` を伴う操作が条件付きで失敗しうる」なら同じ話が当てはまる。
着目すべきは「コレクション操作」ではなく「**set する操作の結果の扱い方**」。

## 出発点: 同期操作の場合をどうするか

**非同期**の操作(fetch などサーバー通信を伴うもの)で結果を受け取る方法は、
定石がはっきりしている。`await` で待つか、コールバックで受け取るか。
失敗もその経路で自然に扱える。これはよく知られている。

問題は**同期的に state を set するだけ**の操作。
ネットワークも Promise も挟まず、その場で state を更新して終わる。
こういう操作で「弾いて、結果(成功/失敗・理由)を知りたい」とき、
何が定石なのかは、非同期ほど語られていない。

このドキュメントが扱うのはこの**同期 set のケース**。
そして中心的な主張は次の一点:

> **React では、同期的に state を set する操作で、
> その場で結果を return するスタイルはあまり取らない。**

`Array.push` が `length` を返すような「set した結果をその場で返す」発想は、
命令的な世界のもの。React の同期 set 操作では、結果は戻り値ではなく
**次レンダーの state / コールバック / 事前クエリ** のいずれかで受け取るのが基本。
以降の3パターンは、いずれもこの「戻り値で返さない」方針の具体的な形。
次節は、なぜ戻り値で返すのがうまくないのかの裏付け。

## なぜ素朴に「戻り値で返す」がうまくないのか

命令的なAPIは破壊的操作の戻り値で結果を返すことがある
(例: `Array.push` は新しい `length` を返す)。
だが React で `setState` を伴う操作にこれを持ち込むと噛み合わない。理由:

### 1. 真実の源(source of truth)は次レンダーの state

`setState` を呼んでも、その場で新しい state が手に入るわけではない。
結果は再レンダー後の state に現れる。
操作の戻り値で結果を返すと、「戻り値」と「次レンダーの state」の2箇所に
結果が存在し、どちらを見るべきか曖昧になる(真実の源の二重化)。

### 2. CQS(Command Query Separation)違反

state を変える操作は「コマンド」。コマンドが値も返すと、
状態変更と値返却の2責務が混ざる。
ただし CQS は「1つの関数が両方やるな」であって「結果を返す関数を持つな」では
ない。結果を返す責務を別経路に切り出せば守れる(後述の3パターン)。

### 3. setState の updater 内で結果を取り出すのはアンチパターン

`setItems(prev => ...)` の updater は「現在の state から次の state を計算する
純粋関数」であるべき。updater 内で外側変数に代入したりコールバックを呼んで
結果を取り出すと:

- StrictMode の開発時二重実行で updater が複数回呼ばれ、結果が壊れる/重複発火
- バッチング下では `setState` 直後に updater が走る保証がなく、
  戻り値の時点で結果が未確定(`undefined`)の可能性がある

→ **判定と結果の発火は、updater の「外」で行う。**

## 結果の伝え方 — 3つのパターン

「結果がどこに、いつ現れるか」で分かれる。例は配列の add だが、
set する操作なら何でも同型。

### パターン1: 結果自体を state として保持する

成功分の state と並んで、**失敗分も state として持つ**。
結果が残るので、レンダー時に「弾かれた一覧」を表示し続けられる。

```ts
type RejectReason = "DUPLICATE" | "LIMIT_EXCEEDED" | "INVALID";

function useItemList<T>(keyOf: (i: T) => string | number, max?: number) {
  const [items, setItems] = useState<T[]>([]);
  const [rejections, setRejections] =
    useState<{ item: T; reason: RejectReason }[]>([]);

  const add = useCallback((item: T) => {        // コマンド: 何も返さない
    const reason = findReason(items, item, keyOf, max);
    if (reason) {
      setRejections((prev) => [...prev, { item, reason }]);  // 失敗も state へ
      return;
    }
    setItems((prev) => [...prev, item]);
  }, [items, keyOf, max]);

  return { items, rejections, add };
}
```

- 結果の置き場所: **state(永続)** / 観測: 操作後の再レンダーで読む
- 向く用途: 弾かれた一覧を UI に残す、後で参照する
- トレードオフ: state が増える。いつクリアするか(寿命)を設計する必要

### パターン2: コールバックを受け取って結果を流す

操作にコールバックを渡し、結果をそこへ通知する。
「操作が結果を返す」のではなく「フックが起きたことを通知する」構図。
state には残さず、その場で発火するだけ。

```ts
type AddOutcome<T> =
  | { type: "ADDED"; item: T }
  | { type: "REJECTED"; item: T; reason: RejectReason };

const add = useCallback(
  (item: T, onResult?: (o: AddOutcome<T>) => void) => {
    // 判定もコールバック発火も updater の「外」で行う
    const reason = findReason(items, item, keyOf, max);
    if (reason) { onResult?.({ type: "REJECTED", item, reason }); return; }
    setItems((prev) => [...prev, item]);
    onResult?.({ type: "ADDED", item });
  },
  [items, keyOf, max]
);
```

- 結果の置き場所: **イベント(一過性)** / 観測: 操作時に発火
- 向く用途: トースト表示・ログなど「一度反応すれば終わり」の即時反応
- トレードオフ: 結果が残らない。判定ロジックはフック内部に閉じる
  (カプセル化と好相性)

### パターン3: チェックと操作を分離する

判定を副作用のないクエリ(`validate` / `canAdd`)として切り出し、
コマンド(`add`)と分ける。結果は**操作の前に問い合わせる**。CQS的に最も明快。

```ts
// クエリ: 値を返すが副作用なし
const validate = useCallback((item: T): RejectReason | null =>
  findReason(items, item, keyOf, max), [items, keyOf, max]);

// コマンド: 何も返さない。内部でも防御(無条件 set を防ぐ最終ガード)
const add = useCallback((item: T) => {
  setItems((prev) =>
    findReason(prev, item, keyOf, max) ? prev : [...prev, item]);
}, [keyOf, max]);
```

```tsx
// 呼び出し側が順序を制御。UIの事前無効化にも使える
const reason = validate(item);
<button disabled={!!reason} onClick={() => add(item)}>追加</button>
```

- 結果の置き場所: **クエリの戻り値** / 観測: 操作の前に問い合わせ
- 向く用途: 事前バリデーション、ボタンの事前無効化
- トレードオフ: 不変条件の判断が「外に晒される」。
  カプセル化(フック内に閉じ込める)とは相性が悪い

## 比較

| | 結果の置き場所 | タイミング | 向く用途 | カプセル化 |
|---|---|---|---|---|
| 1. state に保持 | state(永続) | 操作後に観測 | 弾かれた一覧を残す | ○ |
| 2. コールバック | イベント(一過性) | 操作時に発火 | トースト・ログ等の即時反応 | ◎ |
| 3. チェック分離 | クエリの戻り値 | 操作前に問い合わせ | 事前無効化・バリデーション | △(外に晒す) |

**3つは排他ではなく組み合わせられる。** 例: 3で事前に止め、すり抜けた分は
2で通知し、1で履歴も残す。
選択軸は (a) 結果の寿命(一過性か永続か)、(b) 判定が操作の前に欲しいか後でいいか、
(c) カプセル化をどこまで重視するか。

## 共通の注意点

### 判定ロジックは1箇所に一元化する

`validate` と `add` 内など、判定が複数箇所に重複しがち。
ロジックを1関数にまとめ、適用する state だけ変える(`items` か updater 内の `prev` か)。

```ts
const findReason = <T,>(
  list: readonly T[], item: T,
  keyOf: (i: T) => string | number, max?: number
): RejectReason | null => {
  if (list.some((i) => keyOf(i) === keyOf(item))) return "DUPLICATE";
  if (max !== undefined && list.length >= max) return "LIMIT_EXCEEDED";
  return null;
};
```

### 失敗理由は code / message を分離して構造化する

`react-dropzone` の `FileRejection` がよい手本:

```ts
interface FileError { message: string; code: string; }  // 表示用 / 機械可読
interface FileRejection { file: File; errors: FileError[]; }
```

`code`(分岐用)と `message`(表示用)を分けると、UI とロジックが疎結合になる。

### state の二重管理に注意

「フック内部の state」と「呼び出し側が別に持つ state」が二重化するとズレる。
react-dropzone の既知の例: 同じファイルを削除→再追加しようとすると、
内部 state にまだ残っていて受理されず、拒否コールバックも呼ばれないため
再追加をハンドリングできない、という報告がある。
→ state は1箇所に寄せる。分けるなら判定は常に一方を基準にする。

## 周辺事情

### 汎用リストフックは判定を持たない

`react-use` / `@uidotdev/usehooks` / `reactuse` などの `useList` 系は、
`push` が `void` で判定も通知もない。
「何を入れてよいか」はドメイン固有なので、汎用層は素朴な set 操作だけ提供し、
不変条件は自作フック(ドメイン層)に委ねる役割分担。
「汎用の add は判定しない」のは、この層分離の結果であって矛盾ではない。

### react-dropzone はコールバック方式の手本

`onDrop(acceptedFiles, fileRejections, event)` で受理/拒否を分けて渡し、
`onDropAccepted` / `onDropRejected` で通知する(パターン2)。
さらに `acceptedFiles` / `fileRejections` を state としても保持(パターン1)し、
1 と 2 が併存できる実例になっている。失敗理由を構造化する設計も含め、
set 操作の結果通知を設計する際の参考実装として有用。

## 結論

- 非同期操作は `await` / コールバックで結果を受け取る定石があるが、
  **同期的に state を set するだけの操作**でも、React では
  **その場で結果を return しない**のが基本。
- `setState` を伴う操作の結果は、「操作の戻り値で返す」より
  **state に保持(1) / コールバックで通知(2) / 事前クエリ(3)** の
  いずれか、または組み合わせで伝える。これは add に限らず set する操作全般に当てはまる。
- 戻り値で返すのは、真実の源の二重化・CQS違反・updater内アンチパターンを
  招くため避ける。
- 選び方は「結果の寿命」「判定が操作の前に欲しいか」「カプセル化の重視度」で決まる。
  カプセル化優先ならコールバック(2)、明快さと事前UI制御なら分離(3)、
  履歴を残すなら保持(1)。
- 判定は1箇所に一元化、失敗理由は code/message を分離、state は1箇所に寄せる。
- 判定と結果の発火は必ず setState updater の「外」で行う。
