---
title: モジュールは「単位ごとにフォルダを切り、index で公開 API を絞る」— folder-by-feature と barrel の使いどころ
tags: [typescript, project-structure, folder-convention, barrel, public-api, colocation, frontend, ddd]
---

## 問題

肥大化した `index.ts`（600 行超）を分割するとき、最初は
「責務名」でファイルを切った（`plan.ts` / `linkOperation.ts` / `candidates.ts`）。
分割はできたが、ファイル名を見ても
**どれが公開 API でどれが内部実装かが分からない**という問題が残った。

「型（または機能）名でフォルダを切り、中に `index.ts` と `__tests__/` を置く」
という規約に落ち着いたが、これは自プロジェクト固有のローカルルールなのか、
一般的な設計原則の一種なのかを整理したい。

## 結論（先に）

この規約は特定の名前を持つ「業界標準ルール」ではないが、
実際には**広く共有されている 3 つの一般原則の組み合わせ**として説明できる。

1. **分割の軸は「技術的な種類」ではなく「機能／概念（＝ドメインの単位）」にする**（folder-by-feature）
2. **各単位の境界に 1 つだけ index（barrel）を置き、公開してよいものだけを re-export する**（public API / encapsulation）
3. **テストは対象コードの隣に置く**（colocation, `__tests__/`）

「1 型名 = 1 フォルダ」というのは、この 3 原則を**「型」という粒度に当てはめた具体化**であり、
粒度を「機能（feature/slice）」に取れば Feature-Sliced Design などとほぼ同じ形になる。

## 原則 1：technical-type ではなく feature/概念で切る

`components/` `hooks/` `utils/` のように**技術的役割で切る（folder-by-type）**と、
1 つの機能を理解するのに 5〜7 個のフォルダを横断することになり、
変更が多数のフォルダに散らばって refactoring の難度が上がる、というのが
スケール時の典型的な失敗として繰り返し指摘されている。

対して**機能・概念単位で切る（folder-by-feature）**と、関連コードが 1 か所に集まり、
「一緒に変わるものが一緒に置かれる」状態になる。Feature-Sliced Design はこれを
「各機能を “ミニアプリケーション” として扱う」と表現する。

`plan.ts` のような**責務名**は主観的で粒度が揺れやすいが、
**型名／機能名**でフォルダを切ると、フォルダ名がそのまま「その単位が何であるか」を表す。
ディレクトリツリーがドメインの一覧になる（folder structure が自己記述的になる）。

## 原則 2：境界に 1 つだけ index を置き、公開 API を絞る

各単位（フォルダ）に `index.ts` を 1 つ置き、
**外に見せてよいものだけを re-export、それ以外は内部実装として隠す**。
FSD はこれを "public API file" と呼び、

> 「このファイルは他レイヤーが使ってよいものだけを export する。内部実装は隠れたままになり、破壊的変更は public API に限定される」

と説明する。これにより「どれが公開 API か」がフォルダ名＋その `index.ts` を見るだけで分かる。
＝ 冒頭の「責務名ファイルだと公開/内部が分からない」問題が、境界の明示で解消される。

### 注意：barrel は「境界に 1 つ」まで。ネストさせない

ただし `index.ts`（barrel）は**万能ではなく、使いすぎると害になる**ことが強く指摘されている。

- **循環参照**：barrel から import するのが癖になり、意図せず循環依存を作りやすい。
- **開発時パフォーマンス**：barrel は re-export 先を芋づる式に読み込む。ある実プロジェクトでは
  内部 barrel を撤去したらロードされるモジュールが 11k → 3.5k（約 68% 減）になり、起動が速くなった。
- **barrel hell**：`index.ts` が別の `index.ts` を re-export…と入れ子になると、遅く絡まった依存鎖ができる。

共通する推奨は
**「barrel は “外の世界が消費する単位の縁（＝公開境界）” に置くもので、アプリ内部の隅々に撒くものではない」**。
したがって本規約でも、

- ルート（ドメイン／機能の入口）の `index.ts` は **re-export のみ**にして公開 API の目次にする（＝境界の barrel）。
- 各単位フォルダ内部からは、**barrel 経由ではなく実ファイルを直接 import** する（＝内部で barrel をネストさせない）。

とするのが、可読性の利点を取りつつ barrel の弊害（循環・遅さ）を避けるバランスになる。

## 原則 3：テストはコードの隣に置く（colocation）

`__tests__/` を対象コードと同じフォルダに置く（colocation）のは、
モダンな JS/TS では一般的なプラクティスとして定着している。

- 対象コードとテストの間の移動（ディレクトリ横断）が減る。
- 「このコードにテストがあるか」がひと目で分かり、テストの優先度が上がる。
- `src` と `test` で**並行したフォルダ構造を二重管理しなくて済む**。
- 実例として React 本体のリポジトリも、`src` パッケージの隣に `__tests__/` を colocate している。

なお **unit テストは colocate、integration/e2e は専用フォルダ**に分けるのが目安、
という補足も広く共有されている。

## まとめ

- 「1 型名 = 1 フォルダ（`index.ts` + `__tests__/`）」は固有ルール名ではなく、
  **folder-by-feature ＋ public API(barrel at boundary) ＋ test colocation** という一般原則の具体化。
- 分割の軸は technical-type ではなく**機能・概念（型）**にする。フォルダ名が単位名になり自己記述的になる。
- 境界に **1 つだけ** barrel を置いて公開 API を絞る。**内部でネストさせない**（循環・遅さ・barrel hell を避ける）。
- テストは対象の隣に colocate する。
- 粒度を「型」に取るか「機能（slice）」に取るかは**設計判断**。小さいドメインなら型単位、
  大きな機能なら feature 単位、と対象の大きさで選べばよい。

## 環境・再現条件

- TypeScript（フロントエンド）のモジュール／ドメイン層の構成に関する規約。
- 特定ライブラリには依存しない（Vite/webpack いずれの barrel パフォーマンス議論にも通じる一般論）。
- 発端: 自プロジェクト（Tauri + React）の 600 行 `index.ts` 分割時の知見を、一般原則に照らして整理したもの。

## 参考

- Feature-Sliced Design, "The Perfect Folder Structure for Scalable Frontend" — https://feature-sliced.design/blog/frontend-folder-structure
- Infinum Frontend Handbook, "React / Project structure" — https://infinum.com/handbook/frontend/react/project-structure
- Fotis Adamakis, "A Front-End Application Folder Structure that Makes Sense" — https://fadamakis.com/a-front-end-application-folder-structure-that-makes-sense-ecc0b690968b
- TkDodo, "Please Stop Using Barrel Files" — https://tkdodo.eu/blog/please-stop-using-barrel-files
- Basarat, "Barrel — TypeScript Deep Dive" — https://basarat.gitbook.io/typescript/main-1/barrel
- Marc Nuri, "What are Barrel Exports in JavaScript and TypeScript?" — https://blog.marcnuri.com/barrel-exports-javascript-typescript
- Mario Dias, "Colocation of Tests: A Cross-Language Perspective" — https://itsmariodias.medium.com/colocation-of-tests-a-cross-language-perspective-982e75c872d8
- Corey Cleary, "Where to put your tests in a Node project structure" — https://www.coreycleary.me/where-to-put-your-tests-in-a-node-project-structure
