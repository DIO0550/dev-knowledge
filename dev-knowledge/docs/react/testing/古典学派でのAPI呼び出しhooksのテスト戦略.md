---
title: 古典学派でのReact API呼び出しhooksテスト戦略（モック境界とテストケース数）
tags: [react, testing, hooks, 古典学派, MSW, TanStack-Query, 同値分割, 単体テスト]
---

## TL;DR

- 古典学派ではプロセス外依存（HTTP境界）だけをモック化する。hooks内部の関数・useQuery等はプロダクションコードのまま動かす。具体的にはMSWでネットワーク層をインターセプトする。
- テストケース数は「APIの返却パターン数」ではなく「hooks側の観察可能な振る舞いの分岐数」で決まる。hooks内部に分岐がなければ、異なるレスポンスパターンでも1テストで代表させて十分。
- 「どのレスポンスパターンでhooksの振る舞いが変わるか」を基準にテストを分け、「同じ振る舞いになるレスポンスパターン」は同値クラスとしてまとめる。

## このドキュメントの射程

React で API を呼び出すカスタムhooks（例: `useUserList`）をテストするとき、古典学派（デトロイト学派 / Khorikov『単体テストの考え方/使い方』）の原則に沿ってどう設計するか。対象は主にTanStack Query + MSW環境だが、fetch/axios + useEffect構成でも考え方は同じ。

## モック境界: 何をモック化し、何をしないか

### 古典学派の原則

- **モック化する**: テストケース間で共有されるプロセス外依存（= HTTP API）
- **モック化しない**: プライベート依存（axios, fetch, useQuery, APIクライアント関数など hooks 内部の全て）

### ロンドン学派寄り（避けたい例）

```ts
// ❌ 実装の詳細に結びつく
jest.mock('axios');
(axios.get as jest.Mock).mockResolvedValue({ data: users });

// ❌ useQuery自体をモック化
jest.mock('@tanstack/react-query');
```

axiosからfetchへの変更、APIクライアント関数の抽出など、振る舞いに影響しないリファクタリングでテストが壊れる。

### 古典学派寄り（推奨）

```ts
// ✅ HTTP境界だけをMSWでモック化
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.get('/api/users', () =>
    HttpResponse.json([{ id: 1, name: 'Alice' }])
  )
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

hooks内部でaxiosを使おうがfetchを使おうが、TanStack Queryに乗せ換えようが、振る舞いが同じならテストは壊れない。

### TanStack Query使用時の最低限の設定

```tsx
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>
    {children}
  </QueryClientProvider>
);
```

`retry: false` は必須。デフォルトだとエラーケースで3回リトライしてテストが遅くなる。

## テストケース数: 何を基準に決めるか

### 原則

テストケース数を決めるのは **APIが何パターンのレスポンスを返しうるか** ではなく、**hooks側のコードに振る舞いの分岐がいくつあるか**。

これは2つの原則の組み合わせ:

- **古典学派**: 「観察可能な振る舞い」を検証する。実装の詳細（どのステータスコードが来たか）ではなく、hooks側の出力（data, isError, errorMessage等）で判断する
- **同値分割法（ブラックボックステスト技法）**: 同じ出力をもたらす入力群は1つの同値クラスとして代表値1つで検証すれば十分

※ 同値分割法は古典学派固有の技法ではなく、より古いブラックボックステストの技法。ただし古典学派はブラックボックステスト寄りの立場なので、自然に組み合わさって使われる。

### パターン別: hooks内に分岐がある場合

```ts
export function useUserList() {
  const query = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  const code = query.data?.resultCode;

  return {
    ...query,
    errorType:
      code === 'E001' ? 'validation' :
      code === 'E401' ? 'auth' :
      code === 'E404' ? 'notFound' :
      code?.startsWith('E') ? 'unknown' : null,
  };
}
```

→ hooks内に4分岐あるので **4ケース + 正常系1ケース** 書く。各分岐が別々の「観察可能な振る舞い」を持つため。

```ts
test('正常時にdataが返る', ...)
test('E001のときerrorTypeがvalidationになる', ...)
test('E401のときerrorTypeがauthになる', ...)
test('E404のときerrorTypeがnotFoundになる', ...)
test('その他Eコード（E500等）のときerrorTypeがunknownになる', ...) // 代表1つ
```

E500とE999は同じ分岐（`startsWith('E')`）に入るので、代表値1つでOK。

### パターン別: hooks内に分岐がない場合（pass through）

```ts
export function useUserList() {
  const query = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  return {
    data: query.data?.data,
    resultCode: query.data?.resultCode,
    isLoading: query.isLoading,
  };
}
```

→ hooks内に分岐がないので **正常系1ケース + エラー系の代表1ケース** で十分。

### パターン別: 分岐がコンポーネント側にある場合

hooksはresultCodeを露出するだけで、コンポーネント側でResultCodeごとに表示を分岐するケース。

- **hooksテスト**: 「エラー時にresultCodeが入る」を代表1つ
- **コンポーネントテスト**: コンポーネント内の分岐数分テストを書く

分岐が存在するレイヤーでテストを書く。

### 判断の簡易ルール

> テスト対象のhooksのコード内に、そのレスポンスパターンで分岐する if / 三項演算子 / 派生state があるか？
>
> - ある → その分岐数分テストを書く
> - ない → 既存の同値クラスに吸収（代表1つで十分）

## まとめ

古典学派でReactのAPI呼び出しhooksをテストするときは「HTTP境界だけMSWでモック化、テストケース数はhooks側の振る舞い分岐で決める」。APIが返すレスポンスのバリエーションの多さ自体はテストケース数に影響せず、hooks/コンポーネントのどこに分岐コードがあるかが全てを決める。

## 参考

- Vladimir Khorikov『単体テストの考え方/使い方』（マイナビ出版, 2022）— 古典学派の原則、観察可能な振る舞い vs 実装の詳細
- TkDodo "Testing React Query" — https://tkdodo.eu/blog/testing-react-query
- TanStack Query Testing Guide — https://tanstack.com/query/latest/docs/framework/react/guides/testing
- MSW — https://mswjs.io/
- 同値分割法・境界値分析 — ブラックボックステスト技法（古典学派固有ではないが、古典学派と自然に組み合わさる）
