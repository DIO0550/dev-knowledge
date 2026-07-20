---
title: Provider key remount で state リセットは anti-pattern — in-flight 通知が消える
tags: [react, context, key-remount, anti-pattern, state-management]
---

## 問題

project 切り替え時に、`<Provider key={projectId}>` のように **`key` を変えて Provider を unmount/remount** し、state をリセットする手法を採用していた。

```tsx
// project が変わると Provider ごと作り直して state を初期化する狙い
<AppProvider key={projectId}>
  <App />
</AppProvider>
```

## 原因

`key` remount は、その Provider 配下の**全 children の state も巻き込んで**作り直す。結果として、Toast・LiveRegion などの **in-flight な通知がドロップ**される（表示中/送信中のものが消える）。

React Router 的な思考モデルでは、route が変わっても state の強制リセットは不要 —— **同じ画面なら新しいデータで再描画するだけ**でよい。`key` による全リセットは目的（データの差し替え）に対して過剰。

## 解決

- `key` を撤去し、Provider は `App` 直下に **hoist**（1 箇所に固定）する。
- state のリセットが必要なら、`key` で全 unmount するのではなく、**必要な state だけを新データで更新**する。
- そもそも消費者が 1 つしかない Context は、`useState` で足りる（Context 化自体を見直す）。

```tsx
// key を外し、Provider は hoist。データ切り替えは state 更新で表現
<AppProvider>
  <App projectId={projectId} />
</AppProvider>
```

- 教訓: `key` remount は「その subtree の全 state を捨ててよい」ときだけ使う。通知・アニメーション・非同期処理など in-flight な状態がぶら下がっているなら使わない。

## 環境

- React（Context / Provider・`key` による remount）
