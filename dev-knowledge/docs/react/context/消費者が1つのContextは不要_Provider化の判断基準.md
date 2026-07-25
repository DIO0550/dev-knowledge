---
title: 消費者が 1 つなら Context 化は不要 — Provider 化の判断基準
tags: [react, context, useContext, over-engineering, state-management, provider, composition]
---

## TL;DR

- Context は「**離れた複数のコンポーネント**（distant components in different parts of the tree）」で値を共有するための仕組み。消費者が 1 つしかないなら公式のユースケースに当てはまらず、Context にする意味はない。
- React 公式も「prop を数階層深く渡す必要がある **だけ** では Context に入れる理由にならない」と明言している。まず props / コンポジションを試すのが先。
- 消費者が 1 つなら、props で直接渡すか、state を親コンポーネント内で持つだけで足りる。
- 不要な Context 化は、Provider の配置問題・`key` remount の副作用・Context 消費のための Body 分離など、**二次的な複雑性**を新たに生む。
- Context 化の前提条件は「**消費者が本当に複数（かつ離れて）いるか**」。1 つならやらない。

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

Context は「離れた複数の子孫」で値を共有するための仕組みであって、prop drilling を短絡的に消すための道具ではない。React 公式ドキュメント "Passing Data Deeply with Context" は、Context に手を出す前にまず次を試すよう促している。

> Just because you need to pass some props several levels deep doesn't mean you should put that information into context.

Context が正当化されるのは、値を使う場所が「離れた・別の場所」に散っているときだと明記されている。

> if some information is needed by **distant components in different parts of the tree**, it's a good indication that context will help you.

消費者が 1 つしかない今回のケースは、この「distant components in different parts of the tree」に当てはまらない。公式が Context の前に勧める代替（props を直接渡す／コンポーネントを切り出して `children` で渡す）で十分足りる。にもかかわらず Context を挟むと、抽象を一段増やしているだけになり、次のような**二次的な複雑性**を新たに生む。

- **Provider の配置問題**: `useContext` は「呼び出したコンポーネントより上にある最も近い Provider」を探し、**自分自身が return で描画する Provider は見ない**（公式リファレンス）。そのため消費側で Provider を描画すると値が取れず、配置に頭を悩ませることになる。
- **`key` remount の副作用**: リセット目的で Provider に `key` を付けると、配下の in-flight な state まで巻き込んでリセットされる。
- **Body 分離**: Context を消費するためだけの中間コンポーネント（`AppShellBody`）を切り出す羽目になる。

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

- Context 化の前に「消費者は何箇所あるか」を数える。**1 つなら即やめる**（props / 親 state で足りる）。公式も「まず props、次に `children` コンポジション」を先に試せと言っている。
- 「離れた場所か」も併せて見る。近い数階層のバケツリレーは Context の理由にならない（公式: prop を数階層深く渡す必要があるだけでは不十分）。
- 「Context を読むためだけの Body コンポーネント」が生まれていたら、そもそも Context が不要／Provider の配置が一段低いサインのことが多い。
- 「prop drilling が辛い → 即 Context」という一般論の是非は別記事「Context を使う前に検討すること（コンポジション優先）」を参照。本記事はその中でも特に「消費者が 1 つ」というシンプルな足切り基準の実例。

## 参考

- [Passing Data Deeply with Context – React](https://react.dev/learn/passing-data-deeply-with-context)（"Before you use context" / "Use cases for context" の節）
- [useContext – React](https://react.dev/reference/react/useContext)（Provider は呼び出し元より上の最も近いものが探索される仕様）
- 関連記事: 「Context を使う前に検討すること（コンポジション優先）」「Provider を return で描画する側は useContext できない — hoist で中間コンポーネントを消す」
