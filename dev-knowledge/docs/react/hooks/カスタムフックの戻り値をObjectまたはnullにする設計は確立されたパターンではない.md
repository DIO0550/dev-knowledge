---
title: カスタムフックの戻り値を `Object | null` にする設計はReactコミュニティで確立されたパターンではない
tags: [react, custom-hook, typescript, hook-design, nullable, discriminated-union]
---

## TL;DR

- 「特定のstateがundefinedの時にnullを返し、それ以外はオブジェクトを返す」というカスタムフックの戻り値設計は、Reactコミュニティで名前付きで確立されたパターンとしては見つからない。
- 似た形のパターンは存在するが、いずれも対象が異なる(コンポーネントの話、throwの話、内部フィールドだけnullの話)。「カスタムフックの戻り値全体を `Object | null` にする」とは別物。
- 主流は「常にオブジェクトを返し、内部のドメインフィールドだけ nullable」もしくは discriminated union。

## このドキュメントの射程

以下のような形のカスタムフックが「Reactコミュニティで採用されている確立されたパターン」なのかを整理する。

```ts
const useUserProfile = (userId: string) => {
  const [user, setUser] = useState(undefined)
  // ...
  if (user == null) { return null }
  return { /* nullいがいのオブジェクト */ }
}
```

呼び出し側は `const result = useUserProfile(userId); if (!result) return null;` のようなガードを書くことになる。

## 調査結果と各パターンとの差

### 1. コンポーネントの Guard Clause Rendering / Early Return

Reactで確立されたパターンとして広く紹介されている。ただし**これはコンポーネントの話で、カスタムフックの話ではない**。

コンポーネントで `return null` が成立するのは、戻り値が `ReactNode` で、`null` が「何も描画しない」というReact固有の意味を持つから。カスタムフックは普通の関数で、戻り値の `null` に特別な意味はない。コンポーネントの慣行をそのままフックに持ち込むのは、両者の性質を取り違えた類推になる。

### 2. useContext ラッパーの Strict Context パターン

形は最も近いが、**`throw`が定石で`return null`ではない**。Kent C. Dodds由来、Chakra UI採用、JulianGaramendyのcreateStrictContextなどで紹介されている。

```ts
function useBook() {
  const value = useContext(BookContext)
  if (!value) throw new Error('useBook used without BookContext.Provider')
  return value  // ← null を return しない
}
```

`throw`が選ばれる理由は、`return null`にすると呼び出し側がガードを書き忘れたときにサイレントに失敗してしまうから。Provider未配置を「叫ばせる」ためのパターンであって、nullで返す設計とは目的が逆。

### 3. useAuth / useUser 系の主流形

認証・ユーザー系のフックはコミュニティで最も多く書かれているフックの一つだが、主流形は「**常にオブジェクトを返し、内部の `user` だけ `User | null`**」。

```ts
// 主流
const useAuth = () => {
  // ...
  return { user, login, logout }  // user: User | null
}

// 質問のパターン(主流ではない)
const useAuth = () => {
  // ...
  if (!user) return null
  return { user, login, logout }
}
```

主流形なら `login` / `logout` などのアクションはuserがnullでも呼べる。質問のパターンだとnullの間は何のアクションも呼べなくなる。

### 4. 公式 `useFriendStatus`

React公式ドキュメントの例では `boolean | null` を返している。ただしこれは**戻り値がプリミティブ値1個**のケース。「オブジェクトを丸ごとnullableにする」例ではない。

### 5. データ取得系ライブラリ(SWR / TanStack Query)

`{ data, error, isLoading, status }` のように**常に同じシェイプのオブジェクトを返し、内部の `data` だけ `T | undefined`** にするのがデファクト。フック全体を `Object | null` にする設計は採用されていない。

## なぜ広まっていないのか

1. **コンポーネントの`return null`と混同を招く** — フックの戻り値としてのnullには、Reactとしての特別な意味がない。
2. **Provider未配置の表現はthrowが好まれている** — サイレント失敗を避けるため。
3. **action(setter / refetch等)を共存できなくなる** — nullの間は何のアクションも呼べないという制約が生まれる。
4. **状態の表現が貧弱** — `ある / ない`の2状態しか表現できず、loading / error / empty などを区別したくなった時にbreaking changeになる。

## 推奨される代替案

### (A) 常にオブジェクト + 内部フィールドだけ optional (SWR / useAuth方式)

```ts
type UseUserProfileResult = {
  user: User | undefined  // 取得前は undefined
  refetch: () => void
}

const useUserProfile = (userId: string): UseUserProfileResult => {
  const [user, setUser] = useState(undefined)

  const refetch = useCallback(async () => {
    const result = await fetchUser(userId)
    setUser(result)
  }, [userId])

  useEffect(() => { void refetch() }, [refetch])

  return { user, refetch }
}
```

呼び出し側は常に分割代入でき、`user` の有無だけで分岐すればよい。`user` が undefined の間でも `refetch` は呼べる、というのが元のパターンとの本質的な差。

```ts
const { user, refetch } = useUserProfile(userId)
if (user === undefined) return
return
```

### (B) discriminated union (状態を型で区別したい時)

state(状態)と action(操作)を分離する形が筋がいい。

```ts
type UserProfileState =
  | { status: 'pending' }
  | { status: 'ready'; user: User }
  | { status: 'error'; error: Error }

const useUserProfile = (userId: string) => {
  const [state, setState] = useState({ status: 'pending' })

  const refetch = useCallback(async () => {
    setState({ status: 'pending' })
    try {
      const user = await fetchUser(userId)
      setState({ status: 'ready', user })
    } catch (error) {
      setState({ status: 'error', error: error as Error })
    }
  }, [userId])

  useEffect(() => { void refetch() }, [refetch])

  return { state, refetch } as const
}
```

呼び出し側では `state.status` で switch すれば exhaustive にチェックでき、状態追加(例えば `empty`)に強い。action は state の分岐から独立しているので、どの状態でも常に呼べる。

```ts
const { state, refetch } = useUserProfile(userId)
switch (state.status) {
  case 'pending': return
  case 'error':   return
  case 'ready':   return
}
```

discriminated union に action を一緒に詰め込む書き方(各バリアントに `refetch` を持たせる)も成立するが、毎バリアントで同じフィールドが繰り返されるので、state と action を分離する形のほうが扱いやすい。

## まとめ

「フックの戻り値全体を `Object | null` にする」はReactコミュニティで名前付きで確立されたパターンではない。似た形はコンポーネントや`useContext`ラッパーに存在するが、対象も意図も別物。普通は「常にオブジェクト + 内部nullable」か discriminated union を採る。

## 参考

- React公式ドキュメント(legacy) `useFriendStatus`の例: https://legacy.reactjs.org/docs/hooks-custom.html
- Kent C. Dodds "Stop using isLoading booleans": https://kentcdodds.com/blog/stop-using-isloading-booleans
- JulianGaramendy "Why I never use React.useContext"(createStrictContext): https://juliangaramendy.dev/blog/strict-react-context
- Codeminer42 "You are using React Context WRONG": https://blog.codeminer42.com/you-are-using-react-context-wrong/
- TkDodo on TanStack Query: https://github.com/TanStack/query/discussions/1331
- Steve Kinney "Discriminated Unions" in React with TypeScript: https://stevekinney.com/courses/react-typescript/typescript-discriminated-unions
