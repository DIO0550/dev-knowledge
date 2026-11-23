---
title: Provider の key remount で state をリセットするのは anti-pattern — in-flight 通知が消える
tags: [react, context, key-remount, anti-pattern, state-management, react-router]
---

## TL;DR

- `<Provider key={projectId}>` のように **key を変えて Provider を unmount/remount** すると、state はリセットされるが**配下の全 children の state も巻き込んで破棄**される。
- Toast・LiveRegion など **in-flight（処理中）の通知がドロップ**される事故につながる。
- key remount は撤去し、Provider は App 直下に **hoist**。切り替え時は「同じ画面を新しいデータで再描画するだけ」で state 強制リセットは不要。
- 消費者が 1 つしかない Context は、そもそも `useState` で足りることが多い。

---

## 1. 問題

project 切り替え時に、`key` で Provider を作り直して state をリセットする手法を採っていた。

```tsx
// project が変わるたびに Provider ごと作り直す
<ProjectProvider key={projectId}>
  <AppShell />
</ProjectProvider>
```

`key` が変わると React は古い `ProjectProvider` を **unmount** し、新しいものを **mount** し直す。狙いは「前 project の state を確実に捨てる」ことだが、副作用として **`AppShell` 配下のすべての state も一緒に破棄**される。

その結果、`AppShell` の中で表示中だった Toast や LiveRegion の **in-flight 通知が remount で消える**。ユーザーがまだ読んでいない通知が、project 切り替えの瞬間に無言でドロップされる。

## 2. 原因

`key` の変更は React にとって「別のコンポーネント」を意味する。ツリー全体を作り直すので、リセットしたかった state だけでなく、**その Provider の子孫が持つ無関係な state まで巻き添え**になる。

思考モデルの誤りとして、React Router の挙動と混同しているケースが多い。route が変わっても state を強制リセットする必要はなく、**同じ画面なら新しいデータで再描画するだけ**でよい。key remount は「作り直し」という強い手段を、単なる「再描画」で済む場面に持ち込んでいる。

## 3. 解決

- `key` を撤去する。
- Provider は **App 直下に hoist** し、project 切り替えでは state を新しい値で更新するだけにする。
- project 変更に伴うリセットが必要なら、`useEffect`（依存に `projectId`）や derived state で**必要な部分だけ**を更新する。ツリーごと作り直さない。

```tsx
// App 直下に 1 度だけ mount。切り替えは state 更新で表現する
<ProjectProvider>
  <AppShell />
</ProjectProvider>
```

さらに、この Context の**消費者が 1 箇所しかない**なら、Context 自体が過剰なことも多い。その場合は `useState` に落とすと Provider 階層自体が消える。

## 4. 判断のポイント

- **key remount は「ツリーごと捨てる」核弾頭**。リセットしたいのが特定の state だけなら、そこだけを更新する手段（state 更新・`useEffect`・derived state）を選ぶ。
- key remount を検討したら、まず「**配下に in-flight な state（通知・アニメーション・入力途中の値など）がないか**」を確認する。あるなら巻き添えで消える。
- 「route/選択対象が変わったら state を全部リセットしたい」は多くの場合思い込み。**同じ画面を新データで描画するだけ**で足りないか先に疑う。
- 消費者が 1 つの Context は `useState` で十分。Provider を残す理由が薄いなら畳む。
