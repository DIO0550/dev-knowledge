---
title: ドメイン state Provider が Toast に依存するのは層の逆転 — 通知専用 Provider で分離する
tags: [react, provider, separation-of-concerns, architecture, toast]
---

## TL;DR

- ドメイン state を管理する Provider が内部で通知（Toast）を発火すると、**state 管理が UI presentation に依存する層の逆転**になる。
- 副作用（通知）は専任の Provider に切り出し、state Provider の子として配置する。
- 分離できる前提条件は「state が外から observable であること」。loading / error が Context から観測できるなら、通知はそれを見て発火する別レイヤーに追い出せる。

---

## 1. 問題

`ProjectProvider`（ドメイン state 管理）が内部で `useToastDispatch` を呼び、警告 toast を発火していた。

```tsx
function ProjectProvider({ children }) {
  const toast = useToastDispatch();
  // ... state 更新の途中で toast.warn(...) を発火
}
```

これは state 管理が UI presentation（通知の見せ方）に依存している状態。副作用として次の制約が生まれる。

- **ネスト順の制約**: `ProjectProvider` は Toast Provider より内側に置かないと壊れる。
- **テストの制約**: `ProjectProvider` のテストで毎回 toast を mock する必要がある。

## 2. 原因

元は「Container が state 管理も通知も内蔵する」という all-in-one 設計だった。state の変化と通知が同じコンポーネントに癒着していたため切り離せなかった。

その後の 3 分割レビューで state が **observable** になった（loading / error も Context から観測できる）ため、通知を外から観測して発火する形に変えられるようになった。

## 3. 解決

通知専任の `ProjectNotificationsProvider`（副作用専用）を切り出し、`ProjectProvider` の**子**として配置する。

```tsx
// Provider ツリーの順序
<ProjectProvider>
  <ProjectNotificationsProvider>
    <AppShell />
  </ProjectNotificationsProvider>
</ProjectProvider>
```

- `ProjectNotificationsProvider` は `ProjectProvider` が公開する state（loading / error など）を購読し、必要なタイミングで toast を発火するだけ。
- `ProjectProvider` は通知に**一切依存しない**。Toast のことを知らないので、ネスト順制約もテストの mock も消える。

## 4. 判断のポイント

- **依存の向き**: ドメイン state（下位・安定）が UI presentation（上位・可変）に依存したら逆転。通知は state を「見る」側であって、state に「埋め込む」ものではない。
- 分離の前提は **state が observable であること**。内部に隠れた state を通知に使っていると切り出せない。まず state を Context に露出させる（loading / error を観測可能にする）のが先。
- 副作用専用 Provider は「描画しない・state を持たない・購読して発火するだけ」の薄い層にすると役割が明確になる。
