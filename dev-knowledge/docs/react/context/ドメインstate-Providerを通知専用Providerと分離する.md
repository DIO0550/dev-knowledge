---
title: ドメイン state Provider が Toast に依存するのは層の逆転 — 通知専用 Provider で分離する
tags: [react, provider, separation-of-concerns, architecture, toast, context]
---

## TL;DR

- ドメイン state を管理する Provider が内部で `useToastDispatch` を呼んで通知を発火するのは、**state 管理が UI presentation に依存する層の逆転**。
- 副作用（ネスト順制約・テストでの toast mock 必須）を生む。
- state が Context から observable（loading / error が外から観測可能）になっているなら、**通知専任の Provider を切り出して**ドメイン Provider の子に置くことで、ドメイン Provider を通知から完全に切り離せる。

---

## 問題

`ProjectProvider`（ドメイン state を管理する Provider）が内部で `useToastDispatch` を呼び、警告 toast を発火していた。

```tsx
// ❌ ドメイン state 管理が UI presentation(toast) に依存
function ProjectProvider({ children }) {
  const toast = useToastDispatch();
  // ...state 管理の中で
  if (someWarning) toast.warn("...");
  // ...
}
```

これは**ドメイン state 管理が UI presentation に依存する層の逆転**。副作用として以下が生じる。

- **ネスト順制約**: `ProjectProvider` は必ず `ToastProvider` より内側に置かねばならない。
- **テストの負担**: `ProjectProvider` を単体テストするだけで toast の mock が必須になる。

## 原因

元々は「Container が state 管理も通知も内蔵する」という all-in-one 設計だった。

その後の 3 分割レビューで state が **observable** になり（`loading` / `error` も Context から観測可能になった）、通知を「state を外から見て発火する別レイヤ」として切り離せる条件が整った。

## 解決

**通知専任の Provider**（`ProjectNotificationsProvider`）を切り出し、`ProjectProvider` の**子**に配置する。

- `ProjectNotificationsProvider` は副作用専用。`ProjectProvider` が公開する observable な state（loading / error など）を Context 経由で読み、必要なら toast を発火する。
- `ProjectProvider` 自身は通知に**一切依存しない**。

```tsx
// ✅ Provider ツリー: ドメイン → 通知 → UI の順
<ProjectProvider>
  <ProjectNotificationsProvider>{/* ここで toast を発火 */}
    <AppShell />
  </ProjectNotificationsProvider>
</ProjectProvider>
```

```tsx
// 通知は state を「外から観測して」発火する副作用専用レイヤ
function ProjectNotificationsProvider({ children }) {
  const { error } = useProjectState(); // ドメイン Provider の observable な state を読む
  const toast = useToastDispatch();
  useEffect(() => {
    if (error) toast.warn(error.message);
  }, [error, toast]);
  return <>{children}</>;
}
```

これにより `ProjectProvider` は通知への依存が消え、ネスト順制約もテストでの toast mock も不要になる。

## 教訓

- ドメイン state 層が UI presentation（toast など）を**呼びに行く**のは層の逆転。依存の向きは「presentation → domain」であるべき。
- 分離の前提は state が **observable** であること。loading / error を Context で公開できれば、通知は「state を外から見て反応する」副作用レイヤに追い出せる。
- 「1 つの Provider が全部やる」all-in-one 設計は、責務が観測可能になった時点で分割の好機。
