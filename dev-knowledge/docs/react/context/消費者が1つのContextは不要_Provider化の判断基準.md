---
title: 消費者が 1 つなら Context 化は不要 — Provider 化の判断基準
tags: [react, context, over-engineering, state-management, provider]
---

## TL;DR

- Context は「**複数の離れた子孫**で state を共有する」ための仕組み。消費者が 1 つしかないなら Context にする意味はない。
- 消費者が 1 つなら、props で直接渡すか、state を親コンポーネント内で持つだけで足りる。
- 不要な Context 化は、Provider の配置問題・`key` remount の副作用・Context 消費のための Body 分離など、**二次的な複雑性**を新たに生む。
- Context 化の前提条件は「**消費者が本当に複数いるか**」。1 つならやらない。

---

## 1. 問題

`useAppView` を Provider + Context 化したが、実際に `useAppView()` を呼ぶのは `AppShellBody` の **1 コンポーネントだけ**だった。

```tsx
// 消費者は AppShellBody 一つだけなのに Context を挟んでいる
function App() {
  return (
    <AppViewProvider>
      <AppShellBody /> {/* useAppView() を呼ぶのはここだけ */}
    </AppViewProvider>
  );
}

function AppShellBody() {
  const view = useAppView(); // 唯一の消費者
  return <>{/* ... */}</>;
}
```

## 2. 原因

Context は「複数の離れた子孫」で値を共有するための仕組み。消費者が 1 つしかないなら、次のどちらかで十分で、Context は抽象を一段増やしているだけになる。

- props で直接渡す
- state を親コンポーネント内で管理する

さらに、消費者が 1 つの Context 化は得が小さいだけでなく、次のような**二次的な複雑性**を新たに生む。

- **Provider の配置問題**: どこに Provider を置くか（消費側で描画するとねじれる → 別記事「Provider を return で描画する側は useContext できない」参照）。
- **`key` remount の副作用**: リセット目的で Provider に `key` を付けると、配下の in-flight な state まで巻き込んで消える。
- **Body 分離**: Context を消費するためだけの中間コンポーネント（`AppShellBody`）が生まれる。

## 3. 解決

Context をやめ、Provider は **App 直下に hoist**、`AppShellBody` の分離は撤去する。state は props / 親コンポーネントで持つ。

```tsx
function App() {
  const view = useAppView(); // Context を挟まず素の hook / state で十分
  return <AppShell view={view} />;
}
```

今後は「**消費者が本当に複数いるか**」を Context 化の前提条件にする。1 つしかいないなら Context にしない。

## 4. 判断のポイント

- Context 化の前に「消費者は何箇所あるか」を数える。**1 つなら即やめる**（props / 親 state で足りる）。
- 「Context を読むためだけの Body コンポーネント」が生まれていたら、そもそも Context が不要なサインのことが多い。
- 「prop drilling が辛い → 即 Context」という一般論の是非は別記事「Context を使う前に検討すること（コンポジション優先）」を参照。本記事はその中でも特に「消費者が 1 つ」というシンプルな足切り基準の実例。
