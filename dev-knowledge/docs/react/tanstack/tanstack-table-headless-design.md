---
title: TanStack Table は行モデルと状態だけを返す headless テーブルで描画は利用者が組む
tags: [react, tanstack-table, headless-ui, state-management, typescript]
---

## TL;DR

- TanStack Table は「列定義 + データ → 行モデル（ソート・フィルタ・ページング済みの行）と状態」を計算するだけで、`<table>` の markup・CSS・a11y は利用者が書く
- headless の 2 派でいえば B 派（props 返し hook）。`useReactTable` は table インスタンスを返し、JSX は `flexRender` を使って利用者が組む
- 機能は `getSortedRowModel()` などの行モデル関数を「足した分だけ」有効になる。状態は内部管理（uncontrolled）でも `state` + `onXxxChange` で外出し（controlled）でもよい
- サーバー側で処理するときは `manualPagination` / `manualSorting` を立て、処理済みデータと `rowCount` を渡す。manual フラグは fetch はしない
- 2026-08 に v9 が stable になり、npm の `latest` は v9。`useTable` + `tableFeatures()` に変わったが、headless という設計思想は同じ

## 概要・対象

- 対象：`@tanstack/react-table` v8（最終 8.21.3）の API を中心に説明し、v9（確認時点 9.3.1）の差分を後半にまとめる
- 確認日：2026-11-25。v8 のコードはまだ多く現役なので v8 で概念を押さえ、新規なら v9 で書く想定

既存記事「hooks と UI の分離原則 - "headless" の 2 つの実装と英語圏ライブラリの慣行」の分類でいうと、TanStack Table は B 派（props 返し hook）に当たる。A 派（Radix UI のような非装飾コンポーネント）のように `<Table.Root>` 的な部品は一切提供しない。hook が返すのは「描画に必要な計算結果と操作関数」を持った table インスタンスで、`<table>` を書くか `<div role="grid">` を書くか、仮想スクロールにするかは利用者が決める。

## 仕組み・仕様

### 全体の流れ

```text
data + columns(ColumnDef[])
        │
        ▼
useReactTable({ getCoreRowModel, getSortedRowModel, ... , state })
        │   行モデルのパイプライン:
        │   core → filtered → sorted → (grouped/expanded) → paginated
        ▼
table インスタンス
  ├─ table.getHeaderGroups()  → <thead> を組む材料
  ├─ table.getRowModel().rows → <tbody> を組む材料
  └─ table.setSorting() / column.toggleSorting() など操作関数
        │
        ▼
利用者の JSX（flexRender でセル定義を描画）
```

### ColumnDef と columnHelper

列は `ColumnDef<TData>` の配列で定義する。`createColumnHelper<TData>()` を使うと `accessor` のキー補完と `getValue()` の型推論が効く。

```tsx
import { createColumnHelper } from '@tanstack/react-table';

type Person = { name: string; age: number };

const columnHelper = createColumnHelper<Person>();

// columns はコンポーネント外（またはメモ化）で安定させる
const columns = [
  columnHelper.accessor('name', { header: '名前' }),
  columnHelper.accessor('age', {
    header: '年齢',
    cell: (info) => `${info.getValue()} 歳`, // getValue() は number
  }),
  columnHelper.display({ id: 'actions', cell: () => <button>編集</button> }),
];
```

- `accessor`：データの値を持つ列（ソート・フィルタ対象になる）
- `display`：値を持たない列（操作ボタン、チェックボックスなど）
- `group`：ヘッダーをまとめる列

`header` / `cell` には文字列・関数・コンポーネントを渡せる。どれが来ても描画できるようにするのが `flexRender(def, context)` で、関数ならコンテキストを渡して呼び、そうでなければ値をそのまま返す。

### 行モデル関数で機能をオプトインする

v8 では、機能ごとの行モデル関数を渡したものだけがパイプラインに入る。

```tsx
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),           // 必須
  getFilteredRowModel: getFilteredRowModel(),   // クライアントでフィルタ
  getSortedRowModel: getSortedRowModel(),       // クライアントでソート
  getPaginationRowModel: getPaginationRowModel(), // クライアントでページング
});
```

`table.getRowModel()` はパイプライン最後の結果（この例ならページング後の 1 ページ分）を返す。`table.getPrePaginationRowModel()` のように途中段の結果も取れる。

### 描画は利用者が書く

```tsx
<table>
  <thead>
    {table.getHeaderGroups().map((hg) => (
      <tr key={hg.id}>
        {hg.headers.map((header) => (
          <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
            {flexRender(header.column.columnDef.header, header.getContext())}
            {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? null}
          </th>
        ))}
      </tr>
    ))}
  </thead>
  <tbody>
    {table.getRowModel().rows.map((row) => (
      <tr key={row.id}>
        {row.getVisibleCells().map((cell) => (
          <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
        ))}
      </tr>
    ))}
  </tbody>
</table>
```

ソートのクリック、ソート方向の表示、ページングボタンなどはすべて table / column の関数（`getToggleSortingHandler()`, `getIsSorted()`, `nextPage()`, `getCanNextPage()` など）を JSX に配線して作る。

### 状態の管理：uncontrolled と controlled

何も指定しなければ sorting / columnFilters / pagination などの状態は table 内部で持つ。初期値だけ変えたいなら `initialState` を使う。

外から読み書きしたいとき（URL と同期する、サーバーへ送るなど）は、その状態のスライスだけを `state` と `onXxxChange` のペアで外出しする。

```tsx
const [sorting, setSorting] = useState<SortingState>([]);

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  state: { sorting },
  onSortingChange: setSorting, // 値または updater 関数が渡ってくる。useState の setter をそのまま渡せる
});
```

`state` だけ渡して `onSortingChange` を渡さないと、クリックしても状態が更新されず固まる。必ずペアで渡す。

### サーバーサイド処理：manualPagination / manualSorting

データ件数が大きく、ソート・ページングをサーバーでやる場合は manual フラグを立ててクライアント側の処理をスキップさせる。

```tsx
const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
const [sorting, setSorting] = useState<SortingState>([]);

// 状態をクエリキーに含めて取得（TanStack Query の例）
const { data } = useQuery({
  queryKey: ['people', pagination, sorting],
  queryFn: () => fetchPeople({ pagination, sorting }),
  placeholderData: keepPreviousData,
});

const table = useReactTable({
  data: data?.rows ?? emptyRows, // emptyRows はモジュールスコープの定数
  columns,
  rowCount: data?.total,         // 総件数。pageCount を直接渡してもよい
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,
  manualSorting: true,
  state: { pagination, sorting },
  onPaginationChange: setPagination,
  onSortingChange: setSorting,
});
```

- manual フラグは「クライアントで処理しない」という意味でしかなく、fetch はしない。状態を controlled にし、その状態でサーバーに問い合わせる配線は利用者が書く
- manual にした段の行モデル関数（`getSortedRowModel` など）は不要
- `rowCount`（または `pageCount`）を渡さないと、`getCanNextPage()` や総ページ数が正しく出ない

## 使いどころ・注意点

### 向いているケース

- デザインシステムに合わせた独自の見た目のテーブルを作りたい
- ソート・フィルタ・ページング・行選択・列の表示切替などのロジックを自前で書きたくない
- 仮想スクロール（TanStack Virtual）と組み合わせて大量行を表示したい

逆に「すぐ使える見た目のデータグリッドが欲しい」なら、AG Grid や MUI X Data Grid のような描画込みのコンポーネントの方が早い。headless は自由度と引き換えに markup を書く量が増える。

### ハマりどころ

- `data` と `columns` は参照を安定させる。`data={res ?? []}` のように毎レンダー新しい配列を作ると、行モデルが毎回再計算され、最悪無限レンダーになる
- 行のキーは `row.id`。デフォルトは配列インデックスなので、ソート・ページングで行が入れ替わる場合は `getRowId: (row) => row.id` を指定した方が行選択などが安定する
- サーバー取得データを `useEffect` で別の state にコピーしてから渡さない。Query の結果をそのまま `data` に渡す

### v9 での変化（2026-08 stable）

v9 は 2026-08-04 に stable としてリリースされ、npm の `latest` も v9 になっている。主な変化は次のとおり。

| 項目 | v8 | v9 |
|---|---|---|
| hook | `useReactTable` | `useTable`（`useReactTable` 相当は `@tanstack/react-table/legacy` の `useLegacyTable` で一時的に残る、非推奨） |
| 機能の有効化 | `get*RowModel()` をオプションに渡す | `tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), ... })` で明示登録し、未使用機能は tree-shaking される |
| core 行モデル | `getCoreRowModel()` が必須 | 不要 |
| 状態の読み取り | `table.getState()` | `table.state`（TanStack Store ベース。selector や `table.Subscribe` で購読範囲を絞れる） |
| 全体の変更通知 | `onStateChange` | 廃止。スライスごとの `onSortingChange` 等を使う |
| 描画 | `flexRender()` | `<table.FlexRender cell={cell} />` が追加（`flexRender` も引き続き使える） |
| 共通設定 | なし | `createTableHook()` でアプリ共通の features・コンポーネントを束ねられる |

```tsx
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';

// features はモジュールスコープで安定させる
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

const table = useTable({ features, columns, data });
```

`state` + `onSortingChange` による controlled state や `manualPagination` / `manualSorting` + `rowCount` の考え方は v9 でもそのまま使える。「計算は Table、markup は利用者」という headless の分担も変わらない。

## まとめ

TanStack Table は B 派 headless の代表で、行モデルのパイプラインと状態だけを提供する。機能はオプトイン、状態はスライス単位で controlled にでき、サーバー処理は manual フラグで段ごとに切り替える。新規導入なら v9 の `useTable` + `tableFeatures()` で書く。

## 参考

- [TanStack Table Introduction](https://tanstack.com/table/latest/docs/introduction)
- [TanStack Table: Table State Guide (React)](https://tanstack.com/table/latest/docs/framework/react/guide/table-state)
- [TanStack Table: Pagination Guide](https://tanstack.com/table/latest/docs/guide/pagination)
- [Announcing TanStack Table v9](https://tanstack.com/blog/announcing-tanstack-table-v9)
- [Migrating to TanStack Table V9 (React)](https://tanstack.com/table/latest/docs/framework/react/guide/migrating)
- [@tanstack/react-table（npm）](https://www.npmjs.com/package/@tanstack/react-table)
