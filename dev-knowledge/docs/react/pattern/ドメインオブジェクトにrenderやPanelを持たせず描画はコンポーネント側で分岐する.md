---
title: ドメインオブジェクトに .render() / .Panel を持たせない — 描画はコンポーネント側で分岐する
tags: [react, rendering, component-pattern, separation-of-concerns, reconciliation, domain-design]
---

## TL;DR

- ドメインオブジェクトに `render()` メソッドや `.Panel` コンポーネントを持たせて `activeTab.render()` のように呼ぶのは避ける。
- 理由は 2 つ。**(1)** `render()` はただの関数呼び出しで React の reconciliation に参加しない。**(2)** ドメインがコンポーネントの知識を持つことになり、関心分離に反する。
- ドメイン側はデータ（`kind` / `id` / ラベル等）だけを保持し、**描画はコンポーネント内で switch / 条件分岐**に落とす。

## 遭遇した問題

Settings のタブ切り替えを実装する際、各タブをドメインオブジェクトとして定義し、描画をそのオブジェクトのメソッドに持たせる形になっていた。

```tsx
// 🔴 ドメインオブジェクトが「描き方」を知っている
const activeTab = {
  id: "general",
  label: "一般",
  render: () => <GeneralPanel />, // ← ドメインが JSX を返すメソッドを持つ
};

function SettingsView() {
  return (
    <div>
      <TabBar />
      {activeTab.render()} {/* ← メソッド呼び出しで描画 */}
    </div>
  );
}
```

`.render()` の代わりに `.Panel`（コンポーネントを値として持つプロパティ）を持たせて `<activeTab.Panel />` とするバリエーションも同じ問題を抱える。

## 原因

### 1. `render()` は reconciliation に参加しない

`activeTab.render()` はただの関数呼び出しで、戻り値が親の JSX にインライン展開されるだけ。`<Panel />` のような独立したレンダリング単位（Fiber ノード）にならないため、`React.memo` が効かず、そのメソッド内で hooks を呼ぶと親のフックとして登録されてしまう。

- このメカニクス自体の詳細は別記事参照:
  - [React の条件レンダリングは switch と if をどう使い分けるか（render 関数方式は避ける）](./条件レンダリングのswitchとifの使い分けとrender関数方式を避ける.md)
  - [React の `<A />` と `{a()}` の違い - Fiber ノードとフックの所属](../hooks/コンポーネント記法と関数呼び出しの違いとフックの所属.md)

### 2. ドメインがコンポーネントの知識を持つのは関心分離に反する

より本質的な問題はこちら。`activeTab` は「今どのタブが選択されているか」というデータであるべきなのに、`render()` / `.Panel` を持たせると「そのタブがどう描画されるか」という **UI の知識** までドメイン側が抱え込む。

- ドメイン層が React コンポーネント（JSX / `import` した Panel）に依存してしまい、UI を差し替えたい・テストでデータだけ扱いたいときに巻き込まれる。
- 「値」と「その値の描き方」が 1 か所に癒着し、責務が混ざる。

## 解決

**ドメイン側はデータのみ保持し、描画はコンポーネント内で分岐する。**

```tsx
// ✅ ドメインは「何のタブか」だけを持つ（描き方は知らない）
type TabId = "general" | "notifications" | "advanced";

type Tab = {
  id: TabId;
  label: string;
};

// ✅ 描画はコンポーネント内の switch + early return に集約
function TabPanel({ activeTabId }: { activeTabId: TabId }) {
  switch (activeTabId) {
    case "general":
      return <GeneralPanel />;
    case "notifications":
      return <NotificationsPanel />;
    case "advanced":
      return <AdvancedPanel />;
  }
}

function SettingsView({ tabs, activeTabId }: { tabs: Tab[]; activeTabId: TabId }) {
  return (
    <div>
      <TabBar tabs={tabs} activeTabId={activeTabId} />
      <TabPanel activeTabId={activeTabId} /> {/* ← JSX で使う = 独立した描画単位 */}
    </div>
  );
}
```

- `TabId` を discriminated union にしておけば、`switch` は case ごとに網羅性チェックが効き、タブ追加時のコンパイルエラーで漏れを検出できる。
- 各 `Panel` は `<TabPanel />` を通じて JSX で使われるので、Fiber ノードを持ち reconciliation / memo / hooks が正しく機能する。
- ドメイン（`Tab`）は `label` などの純粋なデータだけを持ち、UI への依存が消える。

### 判断の指針

- ドメインオブジェクトに「JSX を返すメソッド」や「コンポーネントを値で持つプロパティ」が生えたら、関心分離のサインとして疑う。
- 「どう描くか」はコンポーネントの責務。ドメインは「何か（`kind` / `id` / `status`）」だけを渡し、コンポーネント側で `switch` / `if` に落とす。

## まとめ

- `activeTab.render()` / `<activeTab.Panel />` は「reconciliation されない」だけでなく「ドメインが UI を知ってしまう」二重の問題がある。
- ドメインはデータ、描画はコンポーネント。分岐はコンポーネント内の `switch` / 条件分岐で書く。

## 参考

- React 公式: Rules of React — React calls Components and Hooks（https://react.dev/reference/rules/react-calls-components-and-hooks）
