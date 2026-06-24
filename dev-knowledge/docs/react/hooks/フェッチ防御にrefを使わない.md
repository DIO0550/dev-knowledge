---
title: useEffect / event handler でのフェッチ防御に ref を使わない — render rule と escape hatch から導く
tags: [react, useEffect, useRef, useState, data-fetching, anti-pattern, StrictMode, escape-hatch, AbortController, race-condition, react-query, SWR, event-handler, custom-hook]
---

## TL;DR

- `useEffect` 内のフェッチに限らず、**event handler やカスタムフック内の通常関数**でも、二重発火・ローディング表示・取得中フラグを `useRef` で防御するのは公式のいずれの推奨にも合致しないアンチパターン。
- 判定軸はただ 1 本：**render で読むなら `useState`、event handler 内だけで使うなら `ref` も可**（公式 `useRef` リファレンス）。「ローディング中」「取得中」は ほぼ確実に render で読むので `useState` 一択。
- StrictMode の二重発火対策は「防ぐ」のではなく「結果を捨てる」が公式設計。`let ignore = false` + cleanup（または `AbortController` + cleanup で abort）が公式のフェッチ＆無視イディオム。
- event handler の連打防止は **`useState` + `disabled`** が第一選択。ref は `disabled` 属性で受けられないグローバル `keydown` リスナーなどに限定。
- ref は escape hatch であり、cleanup を絡めない ref フラグは StrictMode の意図（バグ炙り出し）を潰し、本番の remount にも対応できない。
- 実運用では TanStack Query / SWR が `isLoading` / `isFetching` / `isPending` を提供し、deduplication も込み。`useEffect` でフェッチを書き直さない方が筋がよい（公式も同様に推奨）。

## このドキュメントの射程

`useEffect` 内でのフェッチに限らず、**event handler やカスタムフック内の通常関数**（`onClick` / `onSubmit` ハンドラ、`useXxx` がコールバックとして返す関数など）からのフェッチも同じ原則の対象とする。

AI（および古めの Stack Overflow 記事群）が書きがちな、`useRef` による以下の 4 パターンを扱う：

1. **StrictMode の二重発火を `hasFetchedRef` で抑制するパターン**（`useEffect`）

   ```ts
   const hasFetched = useRef(false);
   useEffect(() => {
     if (hasFetched.current) return;
     hasFetched.current = true;
     fetchData();
   }, []);
   ```

2. **ローディング状態を `isLoadingRef` で管理するパターン**（`useEffect` / event handler 両方）

   ```ts
   const isLoadingRef = useRef(false);
   // …render で isLoadingRef.current を読んでスピナーを出そうとする
   ```

3. **取得中フラグを `inFlightRef` で重複呼び出し防止に使うパターン**（`useEffect` 内）

   ```ts
   const inFlightRef = useRef(false);
   const load = async () => {
     if (inFlightRef.current) return;
     inFlightRef.current = true;
     try { /* ... */ } finally { inFlightRef.current = false; }
   };
   ```

4. **event handler / カスタムフックが返す関数の中で `inFlightRef` で連打防止するパターン**

   ```tsx
   // カスタムフック内
   function useSubmitForm() {
     const inFlightRef = useRef(false);
     const submit = async (payload: Payload) => {
       if (inFlightRef.current) return;
       inFlightRef.current = true;
       try { await api.submit(payload); } finally { inFlightRef.current = false; }
     };
     return { submit };
   }

   // コンポーネント側
   const { submit } = useSubmitForm();
   return <button onClick={() => submit(data)}>送信</button>;
   ```

いずれも、React 公式・コアチーム・主要 OSS メンテナの推奨と整合しない。前提環境は React 18 / 19、StrictMode 有効、関数コンポーネント＋ Hooks。

## 原因

### React 公式が定める「state か ref か」の判定軸

`useRef` リファレンスは明確に線を引いている：

> Information that's used for rendering should be state instead.
> （render に使う情報は state に置くべき）

`Referencing Values with Refs` ページも同じ：

> When a piece of information is used for rendering, keep it in state. When a piece of information is only needed by event handlers and changing it doesn't require a re-render, using a ref may be more efficient.

つまり線引きは 1 本：**render で読むなら state、event handler 内だけで使うなら ref**。

「ローディング中」「取得中」はスピナー表示、ボタンの `disabled`、スケルトン、エラー UI の出し分けなど、ほぼ確実に render で読む。**この瞬間に ref は公式定義から外れる**。

さらに公式は「ref は escape hatch であり、しばしば必要にはならない」「アプリケーションロジックやデータフローの多くを ref に依存させているなら設計を見直すべき」と明示している。

### StrictMode の二重発火に対する公式設計

`react.dev` の `useEffect` リファレンスは、フェッチの race condition 対策として `let ignore = false` をエフェクト内ローカルで宣言し、cleanup で `ignore = true` にする「fetch-and-ignore」イディオムを示している。ref は出てこない。

これは「二重実行を **防ぐ**」のではなく「古い結果を **捨てる**」設計思想。StrictMode の二重マウントだけでなく、依存値の連続変化による race も同じ仕組みで吸収できる。

Dan Abramov（React コアチーム）の GitHub 上の回答も同様で、「`ignore` フラグは二重フェッチ自体は防がないが最初の結果を無視するので何も起きなかったのと同じ。開発時の余分なフェッチに害はなく、本番では 1 回しか走らない」と整理している。

### なぜ AI が ref で書きがちか（推測）

Stack Overflow と古いブログに `hasFetchedRef` 系の記事が大量に蓄積されており、学習データ上の頻度が高いことが原因と思われる。「StrictMode の二重発火 = 悪、止めるべきもの」と捉えた解説が多い一方、StrictMode の意図（バグ炙り出し）を尊重して「結果側で冪等化する」公式パターンを正面から書いた記事は相対的に少ない。

### ref 防御が筋悪な実務的理由

仮に「UI には何も出さない、本当に防御フラグだけ」のニッチ条件であっても、ref フラグには次の負債がある：

- **どのみち再レンダリングは起きる**：`setData` を呼べば再レンダリングが走るので、「再レンダリングを避けたいから ref」という動機がフェッチコンテキストでは成立しない。
- **abort できていない**：ref で 2 回目を撃たなくても、進行中の最初のリクエストはネットワーク上で生きている。`AbortController` で abort する方が本質的。
- **cleanup を絡めない ref パターンは StrictMode の意図を潰す**：開発時に二重実行が起きないなら、本番 remount（戻る→再表示など）の挙動を検証する機会も失われる。
- **`useEffectOnce` 系の ref 実装は cleanup を呼ばないので壊れている**：Jack Herrington も「`useRef` で `useEffect` の二重呼び出しを打ち消そうとすることに強く反対する。最初の `useEffect` で呼ばれるコンポーネントと 2 回目に呼ばれるコンポーネントが同じである保証がない」と明言。

## 解決

### 1. 「StrictMode の二重発火」への対処

ref ではなく、**ローカル変数 `ignore` + cleanup**（公式パターン）か、**`AbortController` + cleanup の abort** を使う。

```ts
// ❌ ref で防御するパターン
const hasFetched = useRef(false);
useEffect(() => {
  if (hasFetched.current) return;
  hasFetched.current = true;
  fetchData();
}, []);

// ✅ 公式: fetch-and-ignore
useEffect(() => {
  let ignore = false;
  fetchData().then(result => {
    if (!ignore) setData(result);
  });
  return () => {
    ignore = true;
  };
}, []);

// ✅ さらに良い: AbortController で実リクエストもキャンセル
useEffect(() => {
  const controller = new AbortController();
  fetch("/api/data", { signal: controller.signal })
    .then(res => res.json())
    .then(setData)
    .catch(err => {
      if (err.name !== "AbortError") throw err;
    });
  return () => controller.abort();
}, []);
```

### 2. 「ローディング状態」の管理

JSX で読む情報なので **`useState` 一択**。ref で書くと render で `ref.current` を読むことになり、公式が明示的に禁じる規約違反になるうえ、更新時に再レンダリングが走らずスピナーが出ない・ボタンが無効化されない、というバグも生む。

```tsx
// ❌ ref でローディング管理
const isLoadingRef = useRef(false);
return (
  <>
    {isLoadingRef.current && <Spinner />}                        {/* render で ref を読む規約違反 */}
    <button disabled={isLoadingRef.current}>送信</button>        {/* 同上 */}
  </>
);

// ✅ useState 一択
const [isLoading, setIsLoading] = useState(false);
return (
  <>
    {isLoading && <Spinner />}
    <button disabled={isLoading}>送信</button>
  </>
);
```

### 3. 「取得中フラグでの重複呼び出し防止」（event handler / カスタムフック含む）

これは `useEffect` よりむしろ event handler や、カスタムフックがコールバックとして返す関数の中で問題になりやすい。

ボタン操作なら **`useState` + `disabled`** が第一選択。`disabled` 属性がそもそも DOM レベルで二重発火を遮断するため、追加の防御フラグ自体が不要になることが多い。

```tsx
// ❌ ref で連打防止
const inFlightRef = useRef(false);
const handleClick = async () => {
  if (inFlightRef.current) return;
  inFlightRef.current = true;
  try { await submit(); } finally { inFlightRef.current = false; }
};

// ✅ useState + disabled
const [isSubmitting, setIsSubmitting] = useState(false);
const handleClick = async () => {
  setIsSubmitting(true);
  try { await submit(); } finally { setIsSubmitting(false); }
};
return <button onClick={handleClick} disabled={isSubmitting}>送信</button>;
```

カスタムフックから handler を返す場合も同じ原則。フックの内側で `useState` を持ち、`isSubmitting` を一緒に返すのが標準形：

```tsx
// ❌ カスタムフックの中で ref 防御
function useSubmitForm() {
  const inFlightRef = useRef(false);
  const submit = async (payload: Payload) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try { await api.submit(payload); } finally { inFlightRef.current = false; }
  };
  return { submit };
}

// ✅ useState を返して呼び出し側で disabled に流す
function useSubmitForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = async (payload: Payload) => {
    setIsSubmitting(true);
    try { await api.submit(payload); } finally { setIsSubmitting(false); }
  };
  return { submit, isSubmitting };
}

// 呼び出し側
const { submit, isSubmitting } = useSubmitForm();
return <button onClick={() => submit(data)} disabled={isSubmitting}>送信</button>;
```

#### 「最後の入力で上書き」型の連打対応

連打を「ブロックする」のではなく「最後の操作だけを反映する」のが適切な場面（検索クエリ、フィルタ変更、再フェッチなど）では、`AbortController` を `useRef` に保持して、新しい呼び出しで前のリクエストを abort するのが筋。これは ref の正当な用途（render を経由しない、event handler 内でだけ参照する mutable な値の保持）に合致する。

```ts
function useSearch() {
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const controllerRef = useRef(null);

  const search = async (query: string) => {
    controllerRef.current?.abort();              // 前の呼び出しがあれば中断
    const controller = new AbortController();
    controllerRef.current = controller;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/search?q=${query}`, { signal: controller.signal });
      const data = await res.json();
      setResults(data);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      throw err;
    } finally {
      if (controllerRef.current === controller) setIsLoading(false);
    }
  };

  return { search, results, isLoading };
}
```

ここでの `controllerRef` は「render では絶対に読まない / event handler 内でだけ参照する / 再レンダリングを起こす必要がない mutable オブジェクト」という ref の本来の用途に正確に当てはまる。一方の `isLoading` は UI に出すので `useState`。役割で明確に分離する。

#### ref が許容される数少ない例外

- `disabled` 属性でインターセプトできない、`window.addEventListener("keydown", ...)` のようなグローバルリスナーでの連打防止
- UI に一切影響しない analytics 一発打ち（送信したかどうかを render で読まない）
- 上記の `AbortController` 保持のような、render を一切経由しない mutable な値の保持

### 4. 実運用

公式自身が `useEffect` でのフェッチを消極推奨に格下げしており、フレームワーク組み込みのデータフェッチ機構（Next.js、Remix）か、TanStack Query / useSWR / React Router 6.4+ のクライアントキャッシュを推奨している。

これらは `isLoading` / `isFetching` / `isPending` を初めから提供し、内部で deduplication も行うため、上記の防御コードを書く必要自体がなくなる。`useEffect` 内のフェッチは「車輪の再発明」(TkDodo)。

### 判定樹（まとめ）

| 何をしたいか                                            | 正解                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| render に出る情報（スピナー、disabled、エラー UI）      | `useState` 一択                                               |
| ボタン連打防止（onClick / onSubmit / フックの返す関数） | `useState` + `disabled` が第一選択                            |
| 検索などで最後の入力だけ反映したい                      | `AbortController` を `useRef` に保持し、新呼び出しで前を abort |
| `useEffect` 内の進行中リクエストのキャンセル            | `AbortController`（cleanup で abort）                         |
| StrictMode の二重発火対応                               | `let ignore` + cleanup、または `AbortController`              |
| 本番運用のデータフェッチ                                | TanStack Query / SWR / フレームワーク組み込み機構             |
| ref が妥当な数少ない場面                                | グローバル `keydown` 連打防止、AbortController 保持など        |

## まとめ

ref はあくまで escape hatch。`useEffect` のフェッチ防御だけでなく、event handler やカスタムフックが返す関数の連打防止でも、ref フラグでの抑制は公式の判定軸（render rule）・StrictMode の意図・cleanup 設計のいずれにも反する。「render で読むなら state、event handler 内だけで使うなら ref」の 1 本線を守れば、4 つのサブケースはすべて自然に解ける。`AbortController` の保持のように ref が正当に活きる場面は、「render を経由しない mutable な値」という ref 本来の用途に合致するときに限られる。

## 参考

- [useEffect – React](https://react.dev/reference/react/useEffect)（公式 fetch-and-ignore イディオム）
- [useRef – React](https://react.dev/reference/react/useRef)（"Information that's used for rendering should be state instead"）
- [Referencing Values with Refs – React](https://react.dev/learn/referencing-values-with-refs)（ref は escape hatch）
- [Manipulating the DOM with Refs – React](https://react.dev/learn/manipulating-the-dom-with-refs)（"step outside React" のための ref）
- [You Might Not Need an Effect – React](https://react.dev/learn/you-might-not-need-an-effect)
- [Bug: v18 - How to deal with useEffect being called twice in Strict Mode? · facebook/react#24455](https://github.com/facebook/react/issues/24455)（Dan Abramov の ignore フラグ回答）
- [React 18 useEffect Double Call for APIs: Emergency Fix - Jack Herrington](https://dev.to/jherr/react-18-useeffect-double-call-for-apis-emergency-fix-27ee)（useRef 反対の明言）
- [Simplifying useEffect - TkDodo](https://tkdodo.eu/blog/simplifying-use-effect)（react-query/SWR/RTK Query 推奨）
- [How to replace useState with useRef and be a winner - thoughtspile](https://thoughtspile.github.io/2021/10/18/non-react-state/)（"refs are fine as long as you don't use their current value in render"）
