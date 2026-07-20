---
title: Provider 化の判断基準 — 消費者が 1 つなら Context にする意味がない
tags: [react, context, over-engineering, state-management, design]
---

## 問題

`useAppView` を Provider + Context 化したが、実際に `useAppView()` を呼ぶのは `AppShellBody` **1 コンポーネントだけ**だった。

## 原因

Context は「**複数の離れた子孫**で state を共有する」ための仕組み。消費者が 1 つしかないなら、props で直接渡すか、その state を親コンポーネント内で `useState` するだけで十分。

不要な Context 化は、次のような**二次的な複雑性**を生む。

- Provider をどこに置くかという配置問題
- `key` remount による副作用（配下の in-flight な state が巻き込まれる）
- Body（Provider 消費のためだけの中間コンポーネント）分離

得られる共有のメリットは無い（消費者が 1 つだから）のに、コストだけ払うことになる。

## 解決

- Provider は撤去し、state は親（`App` 直下など）で `useState` する。中間の Body 分離も撤去。
- 今後は **「消費者が本当に複数いるか」を Context 化の前提条件**にする。

```tsx
// before: 消費者1つなのに Provider + Context + Body 分離
// after: 親で持って props で渡すだけ
function App() {
  const [view, setView] = useState<AppView>("board");
  return <AppShellBody view={view} onChangeView={setView} />;
}
```

- 判断軸: 「この state を読む場所は 2 箇所以上に散らばっているか？」YES なら Context を検討、NO なら state リフトアップ + props で十分。

## 環境

- React（Context / Provider の設計判断）
