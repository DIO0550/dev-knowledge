---
title: 編集中の一時状態（draft + bounds）をドメインとして扱うべきか
tags: [typescript, ddd, frontend-architecture, state-management, canvas-editor, domain-modeling, ui-state, draft]
---

## TL;DR

- 「ドメインか否か」の二値ではなく、**どの基準で線を引くか**の問題。
- 判断軸は3つ: ①UIがなくても概念として存在するか ②実エディタの document/session 分割 ③ビジネスが下書きを気にするか（保存・復元要件）。
- 破棄されるだけの一時状態なら「エディタドメインの session 状態」、保存・復元対象なら「Draft エンティティ」に昇格する。
- どちらにせよ「ドメインではない＝モデリングしない」ではない。コンパニオンオブジェクトで不変条件ごと明示的にモデリングするのは妥当。

## このドキュメントの射程

キャンバスエディタでテキスト編集中の一時状態をどう位置づけるかの設計判断。

```ts
export type TextEdit = Readonly<{
  draft: string;
  /** 編集している文言が描かれている矩形。 */
  bounds: CanvasBounds;
}>;

export const TextEdit = {
  create(text: EditableText, bounds: CanvasBounds): TextEdit {
    return { draft: text.content, bounds };
  },
  withDraft(edit: TextEdit, draft: string): TextEdit {
    return { ...edit, draft };
  },
};
```

これを「ドメイン」として扱うべきか、単なるUI状態として扱うべきか。

## 判断軸

### ① UIがなくても概念として存在するか（古典的な区別）

- ドメイン状態 = ビジネスロジックに関わる情報で、UIが存在しなくても概念的に存在するもの。UI状態 = 特定のページやコンポーネントに固く結合した情報。
- `TextEdit` は微妙な位置。「編集中の下書き」はUIなしでは発生しない一方、`bounds`（描画矩形）は明確にプレゼンテーション寄り。

### ② 実際のキャンバスエディタの分け方（tldraw の document/session 分割）

- tldraw はスナップショットを2分割する: **document**（シェイプ・ページ・バインディング）はサーバー保存、**session**（カメラ・選択・UI状態）はユーザーごとにローカル保持。
- 編集中の一時状態は document ではないが、**editor という製品の第一級の状態**として、コンポーネントローカルの雑な状態ではなくストアで明示的にモデリングされている。
- 日本語圏の実例: ABEJA Tech Blog では「どの矩形を選択しているか」「変形中かどうか」を **UIロジック**として reducer に凝集し、ドメインロジックと分離している。

### ③ ビジネスが下書きを気にするか（Khorikov: Always-Valid Domain Model）

- フォームを途中保存して後で続きから編集したい要件が出たら、より緩い検証ルールを持つ**別エンティティ**を作る。
- つまり「下書きを保存する・復元する」が要件になった瞬間、Draft は独立したドメイン概念に昇格する。永続化・自動保存・共同編集が絡むなら `TextEdit`（`TextDraft`）はドメイン。

## 結論（このコードへの当てはめ）

- `draft` の確定操作（commit 時に `EditableText` へ戻す）までがライフサイクルなら、**エディタというドメインの一時的な集約**（tldraw でいう session 側）。
- `bounds` を持つ点で純粋なドメインというよりプレゼンテーションモデル寄り。`bounds` が commit に関与しないなら `draft` と分離する選択肢もある。
- キャンバスエディタでは「エディタの操作それ自体がドメイン」なので、業務アプリの基準（DB由来か否か）をそのまま持ち込む必要はない。
- 破棄されるだけの一時状態か、復元・保存対象かで呼び方を変えると意図が伝わる: **session state** vs **Draft entity**。

## まとめ

- 編集中状態は「アプリのドメイン（保存されるテキスト）」ではないが「エディタドメインの状態」であり、不変条件（編集中 bounds は不変など）ごと明示的にモデリングするのは実例・文献の両方から支持される。

## 参考

- Domain State VS UI State（Sangwin Gawande, Medium）: https://sangwin.medium.com/domain-state-vs-ui-state-5f43dc33c8e4
- tldraw Docs - Persistence（document/session 分割）: https://tldraw.dev/docs/persistence
- フロントエンドのロジックを凝集して、UIコンポーネントから切り離してみた（ABEJA Tech Blog）: https://tech-blog.abeja.asia/entry/frontend-logic-refactor-202510
- Always-Valid Domain Model（Vladimir Khorikov）: https://enterprisecraftsmanship.com/posts/always-valid-domain-model/
- Domain-Driven Design for Modern Frontend Apps（Feature-Sliced Design）: https://feature-sliced.design/blog/ddd-for-frontend-devs
