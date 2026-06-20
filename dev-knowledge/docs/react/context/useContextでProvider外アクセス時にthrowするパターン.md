---
title: useContext で Provider 外アクセス時に throw するパターン
tags: [react, hooks, context, useContext, typescript, design]
---

## TL;DR

- React の `useContext` は **Provider 必須/任意を区別しない**汎用 API。Provider が無ければ defaultValue を返すのが正式仕様。
- そのため「Provider 必須」にしたいコンテキストでは、**利用者側が null/undefined 初期値 + 実行時 throw で必須化を肩代わり**する必要がある。
- これは公式が直接示すパターンではないが、TanStack Query を含む実プロダクト・標準的コミュニティドキュメントで広く採用された定石。
- throw は積極的な美徳というより、「黙って壊れる」より「明示的に落ちる」方がマシという消極的な選択。本質は React のコンテキスト API が必須/任意を型で区別できないことの実行時パッチ。

---

## 1. 何が問題か

Provider が値を注入して初めて意味をなすコンテキスト（認証情報、API クライアント、setState 系関数など）では、「Provider が無い」は正常系にありえない状態であり、返せる妥当なデフォルト値が存在しない。

```tsx
const MyContext = createContext<MyValue | null>(null);

function useMyContext() {
  return useContext(MyContext); // 型は MyValue | null → 消費側が毎回 null チェックを強いられる
}
```

論理的には Provider 内なら null にならないのに、型上は null がありうる。このギャップをどう埋めるかが論点。

---

## 2. 選択肢の比較

Provider 無しで呼ばれたときの挙動として、実質的に以下しかない。

| 方式 | 挙動 | 問題 |
| --- | --- | --- |
| `null` をそのまま返す | 消費側に null が渡る | 毎回 `if (!ctx)` が必要。「Provider 忘れ」と「正常だが値なし」を区別できない |
| `{} as Hoge` / `null!` / `undefined!` で嘘の値 | 型エラーは消えるが実体は空 | `ctx.user.name` で原因から遠い場所で `Cannot read property of undefined`。型に嘘をつくので補完・型チェックも当てにならない |
| **throw する** | 即座に「Provider が無い」と分かる | 利用者が手で書く必要がある（後述の構造的問題） |

throw が選ばれるのは、**他がもっと悪いから**。値を返せない以上、残るのは「黙って壊れる」か「明示的に落ちる」かで、後者を選んでいるだけ。

### `{} as Hoge` について

`{} as Hoge` は「中身は空だがコンパイラには Hoge だと思い込ませる」型の嘘。Provider 付け忘れを検出できず、嘘の型が伝播する。広く使われてはいるが、コミュニティの議論では「型安全性を捨てた劣った選択肢」という位置づけ。

### 本物のデフォルト値があるなら話は別

判断軸はシンプルで「**本物の妥当なデフォルト値が存在するか**」。

- 存在する（テーマ、ロケール、フィーチャーフラグなど Provider 無しでも成立する初期値）→ 素直にデフォルト値方式が正しい。
  ```tsx
  const ThemeContext = createContext<Theme>("light"); // 健全
  ```
- 存在しない（`{} as Hoge` や `null!` で誤魔化すしかない）→ それは型に嘘をついているサイン。`null`/`undefined` 初期値 + throw 方式にする。

---

## 3. throw は「想定内エラー」ではない

「throw するなら try/catch すべきでは？」という直感は通常のエラー処理としては正しいが、このパターンの throw は性質が違う。

- 投げているのは**開発者の実装ミス**（Provider の付け忘れ）であって、ユーザー入力やネットワークのような想定内の失敗ではない。
- 回復可能エラー（recoverable）と、バグそのもの（programmer error）の区別。後者を try/catch で握りつぶすとバグが隠れて余計たちが悪い。
- Rust で言えば前者が `Result`、後者が `panic!` / `expect()` に対応。

正しく Provider でラップしていれば throw には**一生到達しない**。到達したらそれは設定漏れのバグなので、開発中に即座に気づける（＝狙い通り）。

本番でのフォールバックが欲しいなら、個別の try/catch ではなく **Error Boundary** で受ける。

```tsx
<ErrorBoundary fallback={<ErrorPage />}>
  <MyProvider>
    <App />
  </MyProvider>
</ErrorBoundary>
```

整理: 想定内の失敗は Result/state で扱う / 実装ミスは throw で早く落とす / 最後の砦に Error Boundary。throw 方式は真ん中に属し、個別キャッチの想定がそもそも無い。

---

## 4. なぜ公式に無いのか（設計レベルの違和感）

「Provider 必須なら React 自身がエラーを返す設計であるべきで、なぜ利用者が手で throw を書かされるのか」という違和感は本質を突いている。

- React 公式は「意味のあるデフォルト値が無いなら null を指定せよ」「デフォルト値は最後の手段のフォールバック」までしか規定しない。その null をどう扱うかはユーザーランドに委ねている。
- 根本原因: React は「**Provider 必須のコンテキスト**」と「**Provider 任意のコンテキスト**」を区別する手段を持っていない。両方とも同じ `createContext` / `useContext` で扱われ、必須かどうかは利用者の意図でしかなく API のシグネチャに現れない。
- だから「Provider が無いのはエラー」と React が判断する根拠がなく、defaultValue を返すしかない。結果「必須にしたい人は自分で null を入れて自分で throw してね」になる。

`createRequiredContext<T>()` のような、defaultValue を取らず Provider 外アクセスを React 自身がエラーにする API があれば利用者が throw を書く必要はなかった。コミュニティのヘルパー群（`createCtx`, `createStrictContext`, `react-ensure-provider` 等）は、全部「本来 React にあってほしかったその API」の再発明。同じものが何度も自作されている時点で API に穴があるとも言える。

**結論**: これは「throw が良いパターンか」の話ではなく「React のコンテキスト API が必須/任意を区別しない設計だから、必須化を利用者が肩代わりさせられている」という構造の問題。throw 方式はその肩代わりの中で一番マシなやり方が定着しただけ。型で Provider を強制できない（型システムの限界）以上の妥協が throw、という見方が一番しっくりくる。

---

## 5. 実プロダクトでの採用例: TanStack Query

最も使われているライブラリの一つである TanStack Query が、まさにこのパターンを採用している。

```tsx
// packages/react-query/src/QueryClientProvider.tsx
export const QueryClientContext = React.createContext<QueryClient | undefined>(
  undefined,
)

export const useQueryClient = (queryClient?: QueryClient) => {
  const client = React.useContext(QueryClientContext)

  if (queryClient) {
    return queryClient
  }

  if (!client) {
    throw new Error('No QueryClient set, use QueryClientProvider to set one')
  }

  return client
}
```

ポイント:
- `undefined` 初期値 + Provider 外で throw、という議論してきたパターンそのもの。
- `queryClient?` を引数で直接渡せる逃げ道（DI 的な口）を用意しているのが実装上うまい。テスト時や Provider を使わないケースに対応できる。
- `null` ではなく `undefined` を採用。`null` を正当な値として使いたいコンテキストでは `undefined` の方が衝突しにくく安全、という程度の差。

---

## 6. ヘルパー実装（定型化したい場合）

肩代わりが避けられない以上、ヘルパーで一箇所に閉じ込めて二度と書かない、が現実解。

### タプル返し版

```tsx
import { createContext, useContext } from "react";

function createSafeContext<T>(name: string) {
  const Context = createContext<T | null>(null);
  Context.displayName = name; // DevTools 用

  function useSafeContext(): T {
    const ctx = useContext(Context);
    if (ctx === null) {
      throw new Error(`use${name} must be used within ${name}Provider`);
    }
    return ctx;
  }

  return [useSafeContext, Context.Provider] as const;
}
```

ポイント:
- `T | null` で型を作り、内部で null チェックして narrowing → 戻り値は `T` に確定（消費側は null チェック不要）。
- 末尾の `as const` でタプル型として推論させ、分割代入の各要素の型を保つ。
- `Context` 自体を返さないことで、外から直接 `useContext(Context)` してアサーションを飛ばすことを構造的に防ぐ。

使用例:

```tsx
interface AuthValue {
  user: User;
  logout: () => void;
}

const [useAuth, AuthProvider] = createSafeContext<AuthValue>("Auth");

function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(/* ... */);
  const value = useMemo<AuthValue>(
    () => ({ user, logout: () => setUser(/* ... */) }),
    [user],
  );
  return <AuthProvider value={value}>{children}</AuthProvider>;
}

function Header() {
  const { user, logout } = useAuth(); // 型は AuthValue、null チェック不要
  return <button onClick={logout}>{user.name}</button>;
}
```

### オブジェクト返し版

```tsx
function createSafeContext<T>(name: string) {
  const Context = createContext<T | null>(null);
  Context.displayName = name;

  function useSafeContext(): T {
    const ctx = useContext(Context);
    if (ctx === null) {
      throw new Error(`use${name} must be used within ${name}Provider`);
    }
    return ctx;
  }

  const Provider = ({ value, children }: { value: T; children: React.ReactNode }) => (
    <Context.Provider value={value}>{children}</Context.Provider>
  );

  return { useContext: useSafeContext, Provider } as const;
}
```

- タプル返し: 呼び出し側で自由に命名できる（`const [useAuth, AuthProvider] = ...`）。
- オブジェクト返し: 名前は固定されるが、返り値が何か一目でわかる。
- `null` を正当な値として使いたい場合は `undefined` 初期値に置き換える（挙動は同じ）。

### 注意: ヘルパー化は過剰になりうる

コンテキストが数個しかないなら、汎用ヘルパーで抽象化を一段挟むより、各コンテキストに素直な `useXxx` フックを直書きする方が読みやすいこともある。`createSafeContext` のような汎用ヘルパーは、コンテキストが多く定型コードがうるさい場合に元が取れる。

---

## まとめ

1. Provider 必須コンテキストでは返せる妥当なデフォルト値が無いので、throw が最もマシな選択。
2. throw は実装ミス検出のためで、try/catch する想定はない（必要なら Error Boundary）。
3. 公式に無いのは「劣るから」ではなく、React のコンテキスト API が必須/任意を区別しない設計のしわ寄せ。
4. TanStack Query 等が実際に採用している確立されたイディオム。
5. 本物のデフォルト値があるならデフォルト値方式が正しい。無いなら null/undefined + throw、定型化するならヘルパーに閉じ込める。
