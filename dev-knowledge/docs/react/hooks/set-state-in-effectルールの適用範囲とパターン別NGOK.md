---
title: useEffect内でsetStateを呼ぶルール（set-state-in-effect）の実際の適用範囲とパターン別NG/OK
tags: [react, useEffect, useState, anti-pattern, eslint-plugin-react-hooks, set-state-in-effect, rendering, performance]
---

## TL;DR

- 「useEffect内でuseStateのset関数を呼ぶな」は **全禁止ではなく**、Effect本体で **同期的に** setするケースだけが対象。
- `.then()` / async関数 / タイマー / イベントリスナー / cleanup 内での set は **ルール的にセーフ**（Effectの同期実行の外だから）。
- ローディング初期化などは「Effect本体で `setLoading(true)` する代わりに `useState(true)` で初期化する」のが正解。
- 本質は「stateに入れる必要のないものを入れない」「同期的な二重レンダーを避ける」の2点。

## このドキュメントの射程

`eslint-plugin-react-hooks` の `set-state-in-effect` ルール、および `eslint-react` の同名ルールが問題視している範囲を明確化し、実務で頻出するパターンをNG/OKで整理する。「Effect内で set = 悪」と丸暗記していると、本来必要な購読コールバック内の set まで避けてしまうので、境界を定義する。

## 原因

`set-state-in-effect` が問題にしているのは、**Effect本体で同期的に呼ばれる setState** に限定される。

同期setが問題な理由: React は Effect の同期実行中に setState が呼ばれると、ブラウザがペイントする前に即座に再レンダリングを走らせる。結果として「state更新を適用するために1回、その後Effectが走った後にもう1回」の二重レンダリングになる。1レンダーで済むはずのものが2レンダーになるのが本質的なムダで、視覚的なジャンクの原因にもなる。

一方で以下は **ルールがフラグしない**:

- `.then()` / async関数のコールバック内
- `setTimeout` / `setInterval` / `requestAnimationFrame` のコールバック内
- イベントリスナー (`addEventListener` のハンドラ) 内
- cleanup 関数内
- await 後の処理

理由は同じで、これらは「Effectの同期実行」の外で走るため、即時の二重レンダーを引き起こさないから。

## 解決（パターン別NG/OK集）

### パターン1: ローディング初期化

```tsx
// ❌ NG: Effect本体で同期set
function UserProfile({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    setLoading(true); // 同期set → 余計なレンダー
    fetchUser(userId).then((data) => {
      setUser(data);
      setLoading(false);
    });
  }, [userId]);
}

// ✅ OK: 初期値をtrueに
function UserProfile({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchUser(userId).then((data) => {
      setUser(data);
      setLoading(false); // .then内はOK
    });
  }, [userId]);
}
```

### パターン2: データ変換（派生値）

```tsx
// ❌ NG: Effectで変換してstateに詰める
function ProductList({ rawProducts }: { rawProducts: RawProduct[] }) {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    setProducts(rawProducts.map(normalize));
  }, [rawProducts]);
}

// ✅ OK: レンダー中に計算（重ければuseMemo）
function ProductList({ rawProducts }: { rawProducts: RawProduct[] }) {
  const products = useMemo(
    () => rawProducts.map(normalize),
    [rawProducts]
  );
}
```

### パターン3: propsから派生させたstate

```tsx
// ❌ NG: 派生値をstate化してEffectで同期
function OrderDetail({ orderId, orders }: Props) {
  const [selectedOrder, setSelectedOrder] = useState(null);

  useEffect(() => {
    setSelectedOrder(orders.find((o) => o.id === orderId) ?? null);
  }, [orderId, orders]);
}

// ✅ OK: stateにしない
function OrderDetail({ orderId, orders }: Props) {
  const selectedOrder = orders.find((o) => o.id === orderId) ?? null;
}
```

### パターン4: propが変わったらstateを全リセット

```tsx
// ❌ NG: Effectでリセット
function ProfilePage({ userId }: { userId: string }) {
  const [comment, setComment] = useState("");

  useEffect(() => {
    setComment("");
  }, [userId]);
}

// ✅ OK: 親からkeyを渡してコンポーネントごとリセット
function ProfilePageWrapper({ userId }: { userId: string }) {
  return <ProfilePage key={userId} userId={userId} />;
}

function ProfilePage({ userId }: { userId: string }) {
  const [comment, setComment] = useState(""); // keyが変わると自動リセット
}
```

### パターン5: propの一部だけ調整（レンダー中set）

`key` でコンポーネント全体をリセットしたくない場合の逃げ道。React公式が推奨するパターン。

```tsx
// ✅ OK: レンダー中に前回値と比較してset
function ItemList({ items }: { items: Item[] }) {
  const [selection, setSelection] = useState(null);
  const [prevItems, setPrevItems] = useState(items);

  if (items !== prevItems) {
    setPrevItems(items);
    setSelection(null);
  }
  // Reactは現在のレンダーを破棄して即座に再レンダリングを試みる
  // items !== prevItems の条件がないと無限ループになるので必須
}
```

これはEffect内setより効率的だが、それでも第一選択ではない。可能なら `key` かレンダー中計算で解決すべき。

### パターン6: Effect連鎖（chain of Effects）

```tsx
// ❌ NG: state→Effect→state→Effect の連鎖
function CheckoutForm() {
  const [items, setItems] = useState([]);
  const [subtotal, setSubtotal] = useState(0);
  const [tax, setTax] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setSubtotal(items.reduce((sum, i) => sum + i.price, 0));
  }, [items]);

  useEffect(() => {
    setTax(subtotal * 0.1);
  }, [subtotal]);

  useEffect(() => {
    setTotal(subtotal + tax);
  }, [subtotal, tax]);
}

// ✅ OK: 派生値はインラインで導出
function CheckoutForm() {
  const [items, setItems] = useState([]);
  const subtotal = items.reduce((sum, i) => sum + i.price, 0);
  const tax = subtotal * 0.1;
  const total = subtotal + tax;
}
```

itemsが1回変わるだけでスケジューラを3往復してからUIが落ち着く、というのが連鎖の実害。

### パターン7: ユーザー操作起点のロジック

```tsx
// ❌ NG: 購入処理をEffectに置く
function BuyButton({ product }: { product: Product }) {
  const [purchased, setPurchased] = useState(false);

  useEffect(() => {
    if (purchased) {
      fetch("/api/buy", { method: "POST", body: JSON.stringify(product) });
      showNotification("Thanks!");
    }
  }, [purchased]);

  return <button onClick={() => setPurchased(true)}>Buy</button>;
}

// ✅ OK: イベントハンドラに書く
function BuyButton({ product }: { product: Product }) {
  const handleBuy = async () => {
    await fetch("/api/buy", { method: "POST", body: JSON.stringify(product) });
    showNotification("Thanks!");
  };
  return <button onClick={handleBuy}>Buy</button>;
}
```

判断軸: 「コンポーネントが表示された結果」ならEffect、「ユーザーが何かをした結果」ならイベントハンドラ。

### パターン8: 外部システムとの購読（本来のEffect用途）

```tsx
// ✅ OK: 購読コールバック内でのsetは正しい使い方
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);   // ← コールバック内なのでOK
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
```

React公式が明言する「Effectのあるべき姿」の1つ: 外部システムからの更新を購読し、コールバックでsetStateを呼ぶ。

### パターン9: SSRハイドレーション（グレーゾーン）

```tsx
// ⚠️ ルールに引っかかるが、公式パターンとして広く採用されている
function ClientOnlyContent() {
  const [didMount, setDidMount] = useState(false);

  useEffect(() => {
    setDidMount(true); // ← set-state-in-effect ルールがflag
  }, []);

  if (!didMount) return null;
  return <ActualContent />;
}
```

React公式ドキュメント / Next.js / next-themes / MUI Joy UI などで採用されている `didMount` / `isClient` / `isMounted` パターン。ルール側が厳しすぎるという議論が GitHub Issue で継続中（facebook/react#34743）。

**対処**: `useSyncExternalStore` を使うか、そのファイルだけ `eslint-disable` する。

## まとめ

- `set-state-in-effect` は「Effect本体の同期set」だけを問題にしている。`.then` / async / listener / cleanup 内は対象外。
- 本質は「stateに入れる必要のないものを入れない」＋「同期的な二重レンダーを避ける」。ルールは症状の検出であって、原因は state 設計の問題であることが多い。
- 判断フローチャート: (1) レンダー中に計算できるか → できるなら state 不要。(2) prop変化で全リセットか → `key`。(3) 一部だけリセットか → レンダー中set + 前回値比較。(4) ユーザー操作起点か → イベントハンドラ。(5) 外部システム連携か → Effect + コールバック内 set（正しい用途）。

## 参考

- [set-state-in-effect – React](https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect)
- [You Might Not Need an Effect – React](https://react.dev/learn/you-might-not-need-an-effect)
- [set-state-in-effect | ESLint React](https://eslint-react.xyz/docs/rules/set-state-in-effect)
- [Bug: `react-hooks/set-state-in-effect` overly strict? #34743](https://github.com/react/react/issues/34743) — SSR hydration パターンなど false positive の議論
- [Self-Correcting Components (uhyo)](https://zenn.dev/uhyo/articles/state-update-while-rendering) — レンダー中setの理論的背景
