---
title: TanStack のライブラリは Query・Router・Table・Form・Virtual・Start が stable でそれ以外は発展途上
tags: [react, tanstack, tanstack-start, tanstack-virtual, library-selection]
---

## TL;DR

- TanStack は「型安全・headless・フレームワーク非依存の core + 各フレームワーク向けアダプタ」という共通方針のライブラリ群。必要なものだけ個別に入れる
- 2026-11-25 時点で stable なのは Query（v5）・Router（v1）・Table（v9）・Form（v1）・Virtual（v3）・Start（v1）
- DB は 1.0 RC、Pacer と Hotkeys は beta、Store・Devtools・Intent・CLI は alpha 扱い。AI は 1.x だが登場したばかり
- Virtual は「大量の行を見える分だけ描画する」headless な仮想化ユーティリティ。Start は Router の上に SSR・サーバー関数を足したフルスタックフレームワーク

## 概要・対象

- 確認日：2026-11-25。tanstack.com の「All Libraries」ページのバッジと、npm の `latest` タグ・リリース日時で確認した
- 安定度は「stable = 1.0 以上のメジャーが `latest`」「RC / beta / alpha = 公式サイトのバッジや docs の記載」で判断した。数か月で変わるので、使う前に npm と公式ドキュメントを再確認する

## 仕組み・仕様

### 共通の設計方針

- core（`@tanstack/query-core`, `@tanstack/table-core` など）は UI フレームワークに依存せず、`@tanstack/react-*` / `vue-*` / `solid-*` などのアダプタが薄く包む
- 描画は持たない（headless）。Table・Form・Virtual はいずれも状態と計算だけを返し、markup は利用者が書く
- TypeScript の推論を前提に API が設計されている（Router のパス・search params、Form のフィールド名、Table の列 accessor など）
- 状態管理の土台として TanStack Store が使われており、Table v9 や Form の状態はこの上に乗っている

### ライブラリ一覧

| ライブラリ | 何をするか | 確認時点のバージョン | 安定度（2026-11-25） |
|---|---|---|---|
| Query | サーバー状態の取得・キャッシュ・再検証・ミューテーション | `@tanstack/react-query` 5.108.4（v5.0.0 は 2023-10） | stable |
| Router | 型安全なクライアントルーティング。ファイルベース / コードベース、search params のスキーマ検証、loader | `@tanstack/react-router` 1.170.46（v1.0.0 は 2023-12） | stable |
| Start | Router ベースのフルスタックフレームワーク（SSR・ストリーミング・サーバー関数） | `@tanstack/react-start` 1.169.7（1.0 stable 宣言は 2026-10-13） | stable |
| Table | headless なテーブル / データグリッドのロジック | `@tanstack/react-table` 9.3.1（v9.0.0 は 2026-08-04） | stable |
| Form | 型安全な headless フォーム状態管理とバリデーション | `@tanstack/react-form` 1.33.5（v1.0.0 は 2025-03）。v2 は alpha | stable |
| Virtual | 長いリスト・グリッドの仮想化 | `@tanstack/react-virtual` 3.14.28（v3.0.0 は 2023-12） | stable |
| DB | API や同期エンジンのデータを型付きコレクションにし、live query と楽観的更新を提供するクライアントデータ層 | `@tanstack/db` 1.0.0-rc.1.5 | RC（2026-10-29 に RC1） |
| Pacer | debounce・throttle・rate limit・queue・batch のユーティリティ | `@tanstack/pacer` 0.23.1 | beta（docs に API 変更の可能性ありと明記） |
| Hotkeys | スコープ・シーケンス・再割り当て対応のキーボードショートカット | `@tanstack/hotkeys` 0.33.1 | beta |
| Store | フレームワーク非依存のリアクティブストア。他ライブラリの内部基盤 | `@tanstack/store` 0.11.3 | alpha（サイトのバッジ） |
| AI | TypeScript 向けの AI アプリ構築部品 | `@tanstack/ai` 1.8.0（1.0.0 は 2026-10-22） | 1.x だが新しい（サイトでは fresh バッジ） |
| Devtools / Intent / CLI | 共通 devtools パネル / npm パッケージに AI エージェント向け skill を同梱する仕組み / プロジェクト scaffold | 0.x | alpha |

このほか Charts、Markdown、Highlight、Redact（React の代替ランタイム）といった新しいライブラリも一覧に並んでいる。

### Virtual の概要

画面に見えている行だけを DOM に描画し、スクロール位置に応じて差し替える。headless なので「どの index をどの位置に置くか」だけを計算し、markup とスタイルは利用者が書く。

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

function BigList({ items }: { items: string[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35, // 行の推定高さ（px）
  });

  return (
    <div ref={parentRef} style={{ height: 400, overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div
            key={v.key}
            style={{ position: 'absolute', top: 0, width: '100%', transform: `translateY(${v.start}px)` }}
          >
            {items[v.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
```

使いどころは数千行以上のリスト・テーブル・無限スクロール。TanStack Table の `table.getRowModel().rows` を `count` に渡して組み合わせるのが定番。行の高さが可変なら `measureElement` で実測させる。

### Start の概要

TanStack Router の型安全なルーティングをそのまま使い、SSR・ストリーミング・型付きサーバー関数・ミドルウェアを足したフルスタックフレームワーク。Vite ベースで、デプロイ先は Nitro 経由で Netlify / Cloudflare / Vercel などから選べる。ルートごとに SSR するか、データだけサーバーで読むか、クライアント描画にするかを選べる。

使いどころは「Next.js のような RSC 中心の設計より、クライアント主導の SPA に SSR とサーバー関数を足したい」「Router の型安全をサーバー側まで通したい」ケース。SPA で十分なら Router 単体でよい。

## 使いどころ・注意点

- まず入れるのは Query（サーバー状態）で、あとは必要に応じて Router / Table / Form / Virtual を足す。全部セットで使う必要はない
- stable なものでもマイナー版の更新頻度が高い（Router・Start は 1.1xx 台）。lockfile で固定し、更新は changelog を見てまとめて行う
- RC / beta / alpha のもの（DB・Pacer・Store など）は API 変更があり得る前提で、隔離しやすい場所から試す
- Table は 2026-08 に v9 へ上がり API が大きく変わった。ネット上の記事は v8 前提のものが多いので、バージョンを確認してから参考にする

## 参考

- [TanStack All Libraries](https://tanstack.com/libraries)
- [TanStack Start 1.0](https://tanstack.com/blog/tanstack-start-1-0)
- [Announcing TanStack Table v9](https://tanstack.com/blog/announcing-tanstack-table-v9)
- [Announcing TanStack Form v1](https://tanstack.com/blog/announcing-tanstack-form-v1)
- [TanStack DB 1.0 RC1: Going All In on Oracles](https://tanstack.com/blog/tanstack-db-1.0-rc1-going-all-in-on-oracles)
- [TanStack Virtual Introduction](https://tanstack.com/virtual/latest/docs/introduction)
- [TanStack Pacer Overview](https://tanstack.com/pacer/latest/docs/overview)
