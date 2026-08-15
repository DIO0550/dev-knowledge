---
title: Featureフォルダ構成でコンポーネント専用hookはどこに置くか
tags:
  [
    react,
    hooks,
    folder-structure,
    colocation,
    feature-based-architecture,
    bulletproof-react,
    feature-sliced-design,
  ]
---

## TL;DR

- コンポーネント専用の hook は feature の `hooks/` フォルダではなく、**そのコンポーネントのフォルダ内にコロケーション**するのが主流の推奨。
- feature の `hooks/` フォルダは「feature 内の複数コンポーネントで共有される hook」の置き場として使う。
- 置き場所は使用スコープで決める: コンポーネント専用 → コンポーネントフォルダ内 / feature 内共有 → `features/<feature>/hooks/` / feature 横断 → `src/hooks/`。共有範囲が広がった時点で昇格させる。
- 反対側の視点: FSD はそもそも「hooks」という essence ベースのフォルダ名自体を否定しており、`components/` + `hooks/` 型を維持するかどうかが先行する設計判断になる。

## このドキュメントの射程

Feature フォルダ形式（feature 配下に `components/`・`hooks/` などの技術別フォルダを持つ構成）で、**特定のコンポーネントだけが使う hook** をどこに配置すべきかを扱う。

```
features/todo/
├── components/
│   └── TodoList/...
└── hooks/
    └── ???   ← TodoList 専用の hook もここに入れるべきか？
```

## 選択肢と各ソースの立場

### 1. コンポーネントフォルダ内にコロケーション（主流の推奨）

Josh Comeau（Delightful React File/Directory Structure）がこの問いに最も直接的に答えている:

> If a hook is specific to a component, I'll keep it alongside that component.（hook が特定コンポーネント専用なら、そのコンポーネントの隣に置く）

汎用的で複数コンポーネントから使われる hook だけが `src/hooks/` に集められる。複雑なコンポーネントは専用フォルダを持ち、サブコンポーネント・helper・型定義などの関連ファイルをすべてフォルダ内に隠蔽する。「そのコンポーネントの作業中にだけ見えればよい」という思想。

profy.dev（Screaming Architecture）も、グローバルな `hooks/`・`contexts/` フォルダが肥大化しコンポーネントのコードが複数フォルダに散らばる問題への解決策として、hook と context を可能な限りコンポーネントの隣へ移すコロケーションを結論としている。

背景にあるのは Kent C. Dodds のコロケーション原則「Place code as close to where it's relevant as possible」と、Dan Abramov に帰される「Things that change together should be located as close as reasonable」。コンポーネントとその専用 hook は典型的な「一緒に変更されるもの」に該当する。

### 2. feature の hooks/ にまとめる（bulletproof-react 型）

bulletproof-react は `features/<feature>/hooks/` を「その feature にスコープされた hook の置き場」と定義するのみで、コンポーネント単位のさらなるコロケーションには踏み込んでいない。この構成のまま専用 hook も `hooks/` に入れる運用は可能だが、Sandro Roth が弱点を指摘している: feature 内を型別（components / hooks）に分ける構造は大抵うまくいくものの、**コンポーネントと hook が密結合している場合、2 フォルダに分割するかガイドライン違反かの二択**になり、どちらも良い解決策ではない。

### 3. FSD: そもそも hooks フォルダを作らない

Feature-Sliced Design はセグメント名について「purpose（なぜ）を表すべきで、essence（何であるか）を表す `components` / `hooks` / `types` は悪いセグメント名」と明言する。FSD では hook は目的に応じて `model`（状態・ビジネスロジック）や `lib` に配置され、「hooks フォルダ」という概念自体が存在しない。`components/` + `hooks/` 型の feature 構成を前提とする限り FSD の直接の答えはないが、「技術種別で分けること自体が密結合コードを引き裂く」という問題意識は選択肢 1 と共通している。

## 解決

`components/` + `hooks/` 型を維持する場合、**使用スコープの 3 段階**で置き場所を決める:

```
src/
├── hooks/                          # ③ feature横断で共有される汎用hook
│   └── useDebounce.ts
└── features/
    └── todo/
        ├── components/
        │   ├── TodoList/
        │   │   ├── TodoList.tsx
        │   │   ├── useTodoListScroll.ts   # ① TodoList専用hook（コロケーション）
        │   │   ├── TodoList.test.tsx
        │   │   └── index.ts               # TodoList のみ re-export（hookは非公開）
        │   └── TodoFilter/
        │       └── ...
        ├── hooks/
        │   └── useTodos.ts                # ② feature内の複数コンポーネントが使うhook
        └── index.ts
```

- **① コンポーネント専用**: コンポーネントフォルダ内。`index.ts` からは export せず、専用であることを構造で保証する。
- **② feature 内共有**: `features/todo/hooks/`。
- **③ feature 横断**: `src/hooks/`。

### 昇格ルール

共有範囲が広がった時点で上の階層へ移す。Robin Wieruch: 「project フィーチャーだけが使う hook は `features/project/hooks/` に置き、customer フィーチャーも使うようになった日にトップレベルの `hooks/` に移す。トップレベルの技術フォルダは、本当にフィーチャー境界をまたぐものの置き場」。

freeCodeCamp の記事の具体例が判断タイミングとして分かりやすい: Menu コンポーネント専用だった `useClickOutside` を Dialog でも使いたくなった時点で「もはやコンポーネント専用ではない」ので Menu のフォルダから取り出して上位へ移す。

判断基準の目安: **コンポーネントの `index.ts` が export していないものを外から import したくなったら、それは置き場所を上げるシグナル**（freeCodeCamp の rule of thumb）。

## まとめ

- コンポーネント専用 hook はコンポーネントフォルダにコロケーションし、feature の `hooks/` は feature 内共有専用にする。置き場所 ＝ 使用スコープ、共有範囲が広がったら昇格。

## 参考

- Josh W. Comeau - Delightful React File/Directory Structure: https://www.joshwcomeau.com/react/file-structure/
- profy.dev - Popular React Folder Structures and Screaming Architecture: https://profy.dev/article/react-folder-structure
- Robin Wieruch - React Folder Structure Best Practices: https://www.robinwieruch.de/react-folder-structure/
- freeCodeCamp - The Best File Structure for Your React Components: https://www.freecodecamp.org/news/best-file-structure-for-react-components/
- bulletproof-react - Project Structure: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- Sandro Roth - How to structure your React projects: https://sandroroth.com/blog/project-structure/
- Feature-Sliced Design - Tutorial（セグメント名の原則）: https://feature-sliced.design/docs/get-started/tutorial
