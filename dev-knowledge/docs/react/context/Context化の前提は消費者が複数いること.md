---
title: Provider 化の判断基準 — 消費者が 1 つなら Context にする意味がない
tags: [react, context, over-engineering, state-management]
---

## 問題

`useAppView` を Provider + Context 化したが、実際に `useAppView()` を呼ぶのは
`AppShellBody` **1 コンポーネントだけ**だった。

```tsx
// Provider を挟んだが、消費者は Body 1 つだけ
<AppViewProvider>
  <AppShellBody /> {/* ← ここでしか useAppView() を呼ばない */}
</AppViewProvider>
```

## 原因

Context は「**複数の離れた子孫**で state を共有する」ための仕組み。
消費者が 1 つしかないなら、props で直接渡すか、その state を親コンポーネント内で
`useState` で持つだけで十分。

不要な Context 化は次のような**二次的な複雑性**を生む。

- **Provider の配置問題**（どの高さに置くか、`value` の memo 化など）。
- **key remount の副作用**（Provider に `key` を付けて state リセットすると配下の in-flight 通知が飛ぶ）。
- **Body 分離**（Provider の下に消費用の Body を切り出す不自然な分割）。

これらは「消費者が複数いる」状況では割に合うが、消費者が 1 つなら**得が無いコスト**でしかない。

## 解決

- Provider は **App 直下に hoist**（配置問題を消す）、切り出していた **Body は撤去**。
- 消費者が 1 つなら Context をやめ、`useState` + props で足りる。

```tsx
// 消費者が 1 つなら Context 不要。親で state を持って渡すだけ
function App() {
  const view = useAppView(); // ただの hook / state
  return <AppShellBody view={view} />;
}
```

### 今後の前提条件

Context 化する前に「**消費者が本当に複数いるか**」を確認する。1 つなら Context にしない。

> 関連: 「Context を使う前に検討すること（コンポジション優先）」「Provider key remount での state リセットは anti-pattern」

## まとめ

- Context は「複数の離れた子孫で共有する」ための道具。**消費者 1 つでは意味が無い**。
- 消費者が 1 つなら props / 親の `useState` で十分。Context は Provider 配置・key remount・Body 分離という二次コストを増やすだけ。
- Context 化の前提条件は「消費者が複数いること」。ここを最初に確認する。
