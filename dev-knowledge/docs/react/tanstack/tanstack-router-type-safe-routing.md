---
title: TanStack Router は Register とルートツリーの型推論で Link と search params を型安全にする
tags: [react, typescript, tanstack-router, routing, validation]
---

## TL;DR

- `declare module '@tanstack/react-router'` で `Register` に `typeof router` を登録すると、`Link` / `useNavigate` / `useSearch` などがアプリのルートツリーの型で補完・検査される。
- ルートツリーは file-based routing（router plugin が `routeTree.gen.ts` を生成）が公式推奨。code-based は `getParentRoute` と `addChildren` を自分で書く必要がある。
- search params は route の `validateSearch` で検証と型付けを同時に行う。Zod v4 / Valibot / ArkType は Standard Schema 準拠なのでスキーマを直接渡せる（Zod v3 は `@tanstack/zod-adapter` が必要）。
- 読むときは `Route.useSearch()`、ルート外では `useSearch({ from: ... })` で対象ルートを絞る。絞らないと全ルートの union 型になり、型チェックも遅くなる。

## 概要・対象

- 対象: TanStack Router（React）v1。確認時点の最新は `@tanstack/react-router` 1.170.x、`@tanstack/router-plugin` 1.169.x（確認日 2026-11）。
- 公式ドキュメントの Type Safety / File-Based Routing / Code-Based Routing / Search Params ガイドと、公式 example（basic-react-query-file-based）を元に整理した。

## 仕組み・仕様

### Register による型登録

TanStack Router は「ルート定義から型を推論し、それを router インスタンスの型に集約する」設計になっている。ライブラリが export する `Link` や hooks はそのままだとアプリのルートを知らないので、declaration merging で router の型を登録する。

```tsx
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
```

これ以降、`<Link to>` の `to` は存在するパスの literal union になり、パスに `$postId` があれば `params` が必須になる。`search` も遷移先ルートの `validateSearch` の型で検査される。

```tsx
<Link to="/posts/$postId" params={{ postId: '1' }}>詳細</Link>
// to="/post" のような存在しないパスや params の欠落はコンパイルエラー
```

### from / strict で型を絞る

`useNavigate` / `useSearch` / `useParams` などは「今どのルートにいるか」を `from` で受け取る。

- `from` を省略すると、全ルートの型の union になる。
- `from` が型的に正しくても実行時のルートと一致しなければ例外になる。
- 複数ルートから使う共通コンポーネントでは `strict: false` を付けると実行時エラーが消え、緩い（全フィールドが optional な）型になる。

```tsx
const navigate = useNavigate({ from: Route.fullPath })
navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })
```

公式は型チェック性能の観点でも `from` / `to` で絞ることを推奨している。また `LinkProps` をそのまま props の型に使うと型が巨大になるので、`as const satisfies LinkProps` や `LinkProps<RegisteredRouter, '/posts/'>` のように絞る。

### file-based routing と code-based routing

| 観点 | file-based（推奨） | code-based |
| --- | --- | --- |
| ルートツリーの構築 | router plugin がファイル構成から `routeTree.gen.ts` を生成 | `createRoute` と `addChildren` で手書き |
| 親子関係の型 | 生成コードが自動で結ぶ | 各ルートに `getParentRoute` を書く |
| code splitting | `autoCodeSplitting` で自動 | 手動 |

file-based では bundler plugin（Vite / Rspack / Webpack / Esbuild、または CLI）が dev / build 中にファイルを監視して `routeTree.gen.ts` を生成する。Vite では React plugin より前に置く。

```ts
// vite.config.ts（抜粋）
plugins: [
  tanstackRouter({ target: 'react', autoCodeSplitting: true }),
  react(),
],
```

```tsx
// src/routes/posts.$postId.tsx
export const Route = createFileRoute('/posts/$postId')({
  component: PostComponent,
})
```

主なファイル命名規則は `__root.tsx`（ルート）、`index.tsx`（親パスに完全一致）、`$postId.tsx`（動的パラメータ）、`$.tsx`（splat）、`_layout.tsx`（パスを増やさないレイアウト）、`posts.$postId.tsx`（ドットでネスト表現するフラット形式）。ディレクトリ形式とフラット形式は混在できる。

`routeTree.gen.ts` は手で編集しない（再生成で上書きされる）。router-plugin の skill ドキュメントはこのファイルをコミットするよう指示しており、Vite ガイドは linter / formatter の対象外にすることを推奨している。

code-based の場合は `getParentRoute` が型推論の起点になる。

```tsx
const rootRoute = createRootRoute()
const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'about',
})
const routeTree = rootRoute.addChildren([aboutRoute])
```

公式は「code-based routing はほとんどのアプリで推奨しない」と明記している。

### search params の型付け（validateSearch）

URL の search は JSON としてパースされた後、`validateSearch` を通って型付きオブジェクトになる。戻り値の型が `Route.useSearch()` と `Link` の `search` の型になり、子ルートにも引き継がれる。

```tsx
import { z } from 'zod' // Zod v4

const productSearchSchema = z.object({
  page: z.number().catch(1),
  sort: z.enum(['newest', 'price']).catch('newest'),
})

export const Route = createFileRoute('/shop/products')({
  validateSearch: productSearchSchema, // Standard Schema なので直接渡せる
})

function Products() {
  const { page, sort } = Route.useSearch()
}
```

- 関数形式でも書ける: `validateSearch: (search: Record<string, unknown>): ProductSearch => ...`
- Zod v4 / Valibot 1.0 / ArkType 2.0 / Effect Schema は Standard Schema 実装なのでアダプタ不要。Zod v3 は `zodValidator(schema)`（`@tanstack/zod-adapter`）で包む。
- `.catch()` は不正値を黙ってデフォルトへ落とす。`.default()` を使うと `Link` 側で `search` が必須になる。Zod v3 で `.catch()` を使うと型が `unknown` になるため、アダプタの `fallback(schema, value)` を使う。
- `validateSearch` が throw するとルートの `errorComponent` が描画され、`error.routerCode` は `VALIDATE_SEARCH` になる。
- `retainSearchParams` / `stripSearchParams` を `search.middlewares` に置くと、リンク生成時に特定 param を引き継いだり、デフォルト値と同じ param を URL から落としたりできる。

## 使いどころ・注意点

- `Register` を書き忘れると補完が効かず、`to` が実質 `string` 扱いになる。router を作るファイルで必ず宣言する。
- 共通コンポーネントで `useSearch()` を引数なしで呼ぶと全ルートの union になる。所属ルートが決まっているなら `from`、決まっていないなら `strict: false` を明示する。
- code-split されたコンポーネントからは `getRouteApi('/shop/products').useSearch()` を使うと、route 定義を import せずに同じ型が得られる。
- search params はユーザーが自由に書き換えられる入力なので、`validateSearch` では例外で落とすより `.catch()` 等でフォールバックする方が体験を壊しにくい。

## 参考

- [Type Safety | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/guide/type-safety)
- [Register type | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/api/router/RegisterType)
- [File-Based Routing | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing)
- [Code-Based Routing | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/routing/code-based-routing)
- [Installation with Vite | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/installation/with-vite)
- [Search Params | TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
- [router-plugin SKILL.md（@tanstack/router-plugin 1.168.48）](https://unpkg.com/@tanstack/router-plugin@1.168.48/skills/router-plugin/SKILL.md)
