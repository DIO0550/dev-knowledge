---
title: ページ内スクロール（ジャンプ）の設計判断軸 — ref命令 / state依存 / context購読
tags: [react, scroll, scrollIntoView, useRef, useEffect, useLayoutEffect, context, design-pattern, anti-pattern]
---

## TL;DR

- 「state変更してからスクロール」と「contextでグローバル化」は排他ではなく、**判断軸が別**。まず問題を分解する。
- 特定要素への**ジャンプは命令的動作**。第一選択は `ref` + イベントハンドラで直接 `scrollIntoView()` を呼ぶこと。state も context も要らない。
- スクロール先が**レンダー結果に依存する**（条件付き表示・リスト追加後・エラー箇所）ときだけ、state変更を依存配列に入れた `useEffect` / `useLayoutEffect` 内でスクロールする。
- **context 化が正当なのは「スクロール状態（位置・方向）を複数コンポーネントで購読する」場合のみ**。一度きりのジャンプ命令を context に載せるのはオーバーエンジニアリング。

## このドキュメントの射程

- 「ページ内の特定要素へジャンプ（スクロール）させたい」ときに、`useState` で state を変えてからスクロールすべきか、それとも context 等でスクロール処理をグローバルに持つべきか、という設計の迷いを整理する。
- 対象は React（関数コンポーネント + Hooks）。

## 原因（なぜ迷うか）

「state を噛ませる」も「context 化」も、それぞれ**別の問題を解く手段**なのに、「スクロール」という同じ動詞でまとめてしまうと選択肢が並列に見えてしまう。実際には解いている問題が違う。

React のレンダーライフサイクルを押さえると切り分けられる:

- レンダー（JSX → 仮想DOM → diff）
- 実DOMへのコミット（ここで `ref.current` に実DOMノードがセットされる）
- `useLayoutEffect`（paint 前・同期）
- `useEffect`（paint 後）

DOM ref を安全に読めるのは**コミット後の Effect 内**。render 中やイベントハンドラで「まだ描画されていない要素」を掴もうとすると、対象が DOM に無い / 古い状態になる。だから「新しいレンダーを待ってからスクロールしたい」ケースだけ state を経由する必要が出る。

## 解決（判断軸で切り分ける）

### 判断軸1: スクロール先は「レンダー結果」に依存するか

- **依存しない（既存の固定要素へ飛ぶだけ）** → `useState` 不要。イベントハンドラ内で直接 `ref.scrollIntoView()` を呼べば十分。これは共有状態ではなく **imperative（命令的）な一度きりの処理**。
- **依存する（条件付き表示・リスト末尾追加後・フォームのエラー箇所へ飛ぶ）** → state を変え、その state を依存配列に入れた `useEffect` / `useLayoutEffect` 内でスクロールする。理由は、対象要素がコミットされてからでないと ref が有効にならないため。
- ちらつきを抑えたい測定系（paint 前に読みたい）は `useLayoutEffect`、paint 後の遅延測定でよければ `useEffect`。

### 判断軸2: context でグローバル化すべきか

- **すべき: スクロール状態（位置・方向・可視性）を複数コンポーネントが購読する場合。** 例）スクロール量でヘッダーを出し入れする、パララックス。スクロールイベントは複数箇所で同じハンドラを走らせても無駄なので、provider を1箇所だけ置き、単一リスナーで DOM ツリー全体へ配る。大量スクロール UI では各コンポーネントが個別にリスナーを張るより性能的にも有利。
- **すべきでない: 特定要素への「ジャンプ」。** これは状態の購読ではなく一度きりの命令。context 化は基本オーバーエンジニアリング。`ref` + ハンドラで局所的に完結させる。

### 整理表

| ケース | 推奨 |
|---|---|
| 既存要素へ飛ぶだけ | ハンドラ内で直接 `ref.scrollIntoView()`（state も context も不要） |
| レンダー結果に依存して飛ぶ | state 変更 → 依存配列付き `useEffect` / `useLayoutEffect` 内でスクロール |
| スクロール位置/方向を複数箇所が購読 | context で単一リスナー共有 |

```tsx
// ケースA: 既存の固定要素へ飛ぶだけ → state も context も不要
function TableOfContents() {
  const sectionRef = useRef(null);

  const handleJump = () => {
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <button onClick={handleJump}>本文へ移動</button>
      {/* ...中略... */}
      <section ref={sectionRef}>本文</section>
    </>
  );
}

// ケースB: 条件付きで現れる要素へ飛ぶ → state を依存配列に入れて Effect でスクロール
function SubmitForm() {
  const [error, setError] = useState(null);
  const errorRef = useRef(null);

  // error が立って要素がコミットされてから scrollIntoView が有効になる
  useLayoutEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [error]);

  if (!error) return null;
  return (
    <>
      <p ref={errorRef}>{error}</p>
      {/* ...フォーム本体... */}
    </>
  );
}
```

補足: 検索で見かける `setTimeout(fn, 0)` を挟むスクロール回避策は、非同期レンダーやアニメーション完了待ちが絡む特殊ケースの対症療法。まず `useLayoutEffect` で解決できないか試すのが筋で、安易に `setTimeout` を常用しない。

## まとめ

ジャンプ単体なら `ref` ベースのローカルな命令実行が第一選択。state を噛ませるのは「新しいレンダーを待つ必要がある」とき、context 化は「スクロール状態を広く購読させたい別要件がある」ときだけ。`scrollIntoView` は render 中に読まない命令的ハンドルの代表例で、`useRef` の正しい用途に一致する。

## 参考

- React 公式のレンダー/コミット/Effect ライフサイクル（`useLayoutEffect` は paint 前、`useEffect` は paint 後）
- scrollIntoView を useEffect + ref で呼ぶ基本形（Codemzy / Carl Rippon のフォームエラー例）
- スクロール状態を Context で単一リスナー共有する構成（pinkdroids "moving header with react hooks and context" / react.wiki useScrollPosition）
- useRef の用途整理（DOM 命令・測定・サードパーティ連携にのみ ref を使い、UI に反映する値は useState）
