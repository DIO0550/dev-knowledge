---
title: useEffectEvent の使い分けは「呼び出し側 Effect の同期意図」で決まる
tags: [react, react-19.2, useEffectEvent, useEffect, hooks, reactivity, anti-pattern, dependency-array]
---

## TL;DR

- `useEffectEvent` で wrap して良いかは、**wrap される関数の中身（props 関数か値読み取りか、ロジックの有無）では決まらない**
- 判定基準は呼び出し側 Effect の同期意図ただ一点: 「wrap した関数が読む値の変化で Effect が再走るべきか」
  - **Yes** → deps に入れる（wrap しない）
  - **No** → wrap が正当（最新値だけ読みたい）
- 公式の例（`canMove` / `muted` / `theme` / `count`）はすべて**値を読む関数を wrap している**。「値を読まない純粋ロジックだけが対象」という読み方は誤り
- React 19.2 で正式版になった

## 遭遇した問題

「props で渡された **関数** を `useEffectEvent` で wrap するのは分かるが、props/state の **値** を読むだけの関数を wrap するのはアリか？」という疑問。

```ts
const { a } = props;
const fnA = useEffectEvent(() => { console.log(a); });
```

このコードだけ見て「アリ／ナシ」を判定したくなる。さらに公式ドキュメントの

> エフェクトから発火する、真にイベントとしてのロジックにのみ使用してください。

の「ロジック」を「値を読まない純粋な処理」と解釈すると、上のコードは「値を読んでいる＝ロジックではない＝NG」に見える。だが公式の全例は値を読んでいるので、何かが矛盾している。

## 原因

公式の「ロジック」は **「関数のコード本体」** という意味で、「値を読まない処理」という意味ではない。実際、公式ドキュメントの代表例はすべて値を読む関数を wrap している:

| 例 | wrap される関数が読む値 |
|---|---|
| `onTick` | `count`, `increment`（state） |
| `onMove` | `canMove`（state） |
| `onConnected` | `muted`, `theme`（props/state） |

そもそも値を読まないなら `useEffectEvent` を使う動機自体がない。「**最新の値を読みたいが Effect の deps には入れたくない**」というのが唯一の存在意義だからである。

API 設計者の Dan Abramov 本人による説明:

> you only really know whether something should be reactive or not next to the actual callsite.

「ある値がリアクティブであるべきかどうかは、その関数を呼び出している Effect の文脈ではじめて決まる」。**判定が wrap 側ではなく呼び出し側にある** ことが API の設計思想。

公式 API リファレンスでも明示:

> This design reinforces that Effect Events conceptually belong to a particular effect, and are not a general purpose API to opt-out of reactivity.

「特定の Effect に属する」「リアクティビティから降りる汎用 API ではない」。

## 解決

同じ形の「値を読む関数」でも、**呼び出している Effect の同期意図**で判定が反転する。

### ✅ canMove パターン（合法）

Effect の役割が「一度だけリスナを登録する」のとき、リスナ内部の値の変化で再登録するのは無意味。値を非リアクティブにするのが正しい。

```ts
function Canvas() {
  const [canMove, setCanMove] = useState(true);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const onPointerMove = useEffectEvent((e: PointerEvent) => {
    if (canMove) setPosition({ x: e.clientX, y: e.clientY });
  });

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []); // ← canMove を deps に入れたらチェックボックス操作のたびに add/remove が起きる
}
```

### 🔴 page パターン（誤用）

Effect の役割が「`page` が変わったら再フェッチ」なら、`page` を非リアクティブにすると Effect の役割と矛盾する。

```ts
// 🔴 NG: deps を short にする目的だけで wrap
function ItemList({ page }: { page: number }) {
  const [items, setItems] = useState([]);

  const fetchData = useEffectEvent(async () => {
    const data = await fetch(`/api/items?page=${page}`).then(r => r.json());
    setItems(data);
  });

  useEffect(() => {
    fetchData();
  }, []); // ← page が変わっても再フェッチされない＝バグ
}

// ✅ OK: page は Effect 本来の依存値
function ItemList({ page }: { page: number }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    (async () => {
      const data = await fetch(`/api/items?page=${page}`).then(r => r.json());
      setItems(data);
    })();
  }, [page]);
}
```

### 判定ステップ

1. wrap したい関数を、それを **呼び出している Effect** とセットで眺める
2. その関数内で読む値が変わったとき、Effect は再走るべきか？
   - **Yes** → deps に入れる。`useEffectEvent` で wrap しない
   - **No** → wrap が正当（最新値だけ読みたい）
3. wrap 単独では判定不能。`const fnA = useEffectEvent(() => console.log(a))` の例も、`fnA` を呼ぶ Effect の役割次第で OK/NG が反転する

## まとめ

`useEffectEvent` の判定は wrap 側の関数の形ではなく、**呼び出し側 Effect の同期意図に常に依存する**。「props 関数 vs 値関数」「値を読まないロジックだけ wrap」というフレーミングは誤読の元。

## 参考

- [useEffectEvent – React](https://react.dev/reference/react/useEffectEvent)
- [Separating Events from Effects – React](https://react.dev/learn/separating-events-from-effects)
- [React 19.2 Release Notes](https://react.dev/blog/2025/10/01/react-19-2)
- [RFC: useEvent (reactjs/rfcs)](https://github.com/reactjs/rfcs/blob/useevent/text/0000-useevent.md)
- [Dan Abramov's HN comment on useEvent design](https://news.ycombinator.com/item?id=35188970)
