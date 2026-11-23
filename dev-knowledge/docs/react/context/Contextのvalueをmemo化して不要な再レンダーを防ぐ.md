---
title: Context の value を memo 化して不要な再レンダーを防ぐ
tags: [react, context, use-context, use-memo, performance, rerender]
---

## TL;DR

- Provider の `value` に**インラインのオブジェクト/配列リテラル**を渡すと、Provider が再レンダーするたびに**毎回新しい参照**になり、その Context を読む全コンシューマが再レンダーされる。
- 値が実際には変わっていなくても「参照が変わった」だけで再レンダーが走るのが問題。
- 解決は **`value` を `useMemo` でメモ化**し、依存配列が変わったときだけ新しい参照にすること。
- Kent C. Dodds「How to use React Context effectively」が Provider 実装で `useMemo` を使う理由がこれ。

---

## 1. 何が起きるか（問題のある例）

```tsx
function CountProvider({ children }) {
  const [count, setCount] = useState(0);

  // ❌ 毎レンダーで { count, setCount } の新しいオブジェクトが生成される
  return (
    <CountContext.Provider value={{ count, setCount }}>
      {children}
    </CountContext.Provider>
  );
}
```

`CountProvider`（またはその親）が何らかの理由で再レンダーされるたびに、`value` のオブジェクトリテラルは**新しい参照**になる。React は Context の値の変化を `Object.is` による参照比較で判定するため、中身が同じでも参照が違えば「変わった」と見なし、`useContext(CountContext)` している**すべてのコンシューマが再レンダー**される。

`count` が変わっていない再レンダー（兄弟 state の更新、親の再レンダー等）でもコンシューマが巻き込まれる点が無駄。

---

## 2. 解決（改善例）

```tsx
function CountProvider({ children }) {
  const [count, setCount] = useState(0);

  // ✅ count が変わったときだけ新しい value になる
  const value = useMemo(() => ({ count, setCount }), [count]);

  return (
    <CountContext.Provider value={value}>{children}</CountContext.Provider>
  );
}
```

- `setCount`（useState の setter）は React が同一参照を保証するので依存に入れても入れなくても安定。`count` が変われば当然 value も変わるべきなので依存に入れる。
- これで「value の中身が実際に変わったときだけ」コンシューマが再レンダーされる。

---

## 3. 補足: primitive を直接渡すなら memo は不要

`value` がオブジェクトや配列でなく**プリミティブ単体**（数値・文字列・boolean）なら、参照同一性の問題は起きないので `useMemo` は不要。

```tsx
// theme が "light" 等の文字列なら memo 不要
<ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
```

memo が要るのは「**毎レンダー新しい参照が作られるオブジェクト/配列/関数**を value に載せるとき」。

---

## 4. それでも全コンシューマが再レンダーされる点に注意

`useMemo` は「**値が変わっていないのに**再レンダーされる」無駄を防ぐだけ。値が実際に変わったときは、その Context を読む**全コンシューマ**が再レンダーされる仕様自体は変わらない（React の Context は selector を持たない）。

- 頻繁に変わる値と滅多に変わらない値が混在する場合は、**Context を分割**する（例: [state と dispatch を Context で分割する](./stateとdispatchをContextで分割する.md)）。
- 巨大 state で部分購読したいなら、Context 単体では限界があり、`useSyncExternalStore` ベースの自前ストアや状態管理ライブラリの検討対象になる（依存を増やしたくない場合は、まず Context 分割や `useSyncExternalStore` で対処する）。

---

## まとめ

1. Provider の `value` にオブジェクト/配列リテラルを直書きすると毎レンダー参照が変わり、全コンシューマが無駄に再レンダーされる。
2. `value = useMemo(() => ({...}), [deps])` で参照を安定させる。
3. プリミティブ単体なら memo 不要。
4. memo しても「値が実際に変わった時に全コンシューマが再レンダー」は残る → 必要なら Context 分割で対処。

> 参考: Kent C. Dodds "How to use React Context effectively"
