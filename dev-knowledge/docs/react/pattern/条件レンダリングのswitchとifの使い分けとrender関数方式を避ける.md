---
title: React の条件レンダリングは switch と if をどう使い分けるか（render 関数方式は避ける）
tags: [react, typescript, conditional-rendering, switch, discriminated-union, react-memo, rules-of-react, react-compiler]
---

## TL;DR

- **JSX を返す関数を `{renderContent()}` のように通常の関数として呼ぶ方式は避ける。** コンポーネント化して JSX（`<ContentView />`）で使う。
- 分岐は「判定対象が何か」で使い分ける：**単一の判別子（`kind` / `type` / `status`）との等価比較なら switch + early return**、**複数条件の組み合わせ・範囲・優先順位のある判定なら if ガード節**。
- `React.memo` はコンポーネント型にしか効かない。render 関数方式は memo 不可・hooks 不可・React Compiler 非対応の三重苦。

## 遭遇した問題

- variant ごとの UI 出し分けを実装する際、次の 2 案で迷った。
  1. switch を持つただの関数を定義し、親の JSX 内で `{renderContent(content)}` と呼ぶ
  2. コンポーネントとして定義し、内部で if / switch の early return で分岐する
- 案 1 は `React.memo` が使えないのではという懸念があった。

## 原因

- **render 関数方式は React から見るとコンポーネントではない。** 関数として呼んだ時点で、その中身は親コンポーネントの JSX にインライン展開された扱いになり、独立したレンダリング単位（reconciliation の参加者）にならない。
- そのため：
  - **`React.memo` が効かない**（memo は props 比較で再レンダリングをスキップする仕組みなので、コンポーネント型が前提。関数呼び出しは毎回実行される）。
  - **hooks が使えない**（state が親に紐づき、条件分岐と組み合わさると "Rendered more hooks than during the previous render" の原因になる）。
  - **React Compiler で壊れる**（Compiler はコンポーネント境界を前提に最適化するため、JSX を返す関数の直接呼び出しは非対応パターンとして知られている）。
- react.dev の Rules of React（"React calls Components and Hooks"）でも、コンポーネントを通常の関数として直接呼ばず JSX でのみ使うことが明示されている。React に呼ばせることで、ツリー上の同一性に紐づく state、reconciliation への参加、再レンダリングのスキップ、DevTools での認識が得られる。

## 解決

**方針：分岐は必ずコンポーネント内の early return として書く。switch / if の選択は判定対象で決める。**

### switch が向くケース：単一の判別子で分岐が決まる

discriminated union の `kind` との等価比較だけで分岐が完結する場合。case ごとに narrowing が効き、default 不要で網羅性チェックに任せられる（variant 追加時にコンパイルエラーで漏れを検出できる）。

```tsx
type Content =
  | { kind: "text"; body: string }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; duration: number };

// ✅ コンポーネント化 + switch + early return
function ContentView({ content }: { content: Content }) {
  switch (content.kind) {
    case "text":
      return <TextView body={content.body} />;
    case "image":
      return <ImageView url={content.url} />;
    case "video":
      return <VideoView url={content.url} duration={content.duration} />;
  }
}

// 親では JSX で使う（memo の適用単位にもなる）
<ContentView content={content} />
```

```tsx
// 🔴 避ける：render 関数方式（memo 不可・hooks 不可・Compiler 非対応）
function renderContent(content: Content) {
  switch (content.kind) { /* ... */ }
}
// 親: {renderContent(content)}
```

### if ガード節が向くケース：判定が単一の値に還元できない

- 複数変数の組み合わせ（`!user`、`user.isSuspended` など）
- 範囲・比較（`items.length === 0`、`score >= 80`）
- **判定順序に意味がある**場合（error と empty が同時に真になりうるが error を優先したい等）。switch の case は概念的に排他・対等だが、if 連鎖は「上から順に評価する」優先順位を構造で表現できる。

if-else のネストではなく、単一 if のガード節を並べてメインの return を最後に置く形にする。

```tsx
function UserList({ users, error, isLoading }: Props) {
  if (isLoading) return <Spinner />;
  if (error) return <ErrorView error={error} />;
  if (users.length === 0) return <EmptyState />;

  return (
    <ul>
      {users.map((u) => (
        <UserRow key={u.id} user={u} />
      ))}
    </ul>
  );
}
```

### 判断基準まとめ

| 状況 | 選択 |
|---|---|
| variant ごとに渡す props が違う・narrowing が必要 | switch + early return |
| kind → 均質で不活性な対応表（ロジックなし、翻訳境界） | `Record` lookup も可 |
| 複数条件の組み合わせ・範囲・優先順位あり | if ガード節 |

- 無理に switch へ寄せると `switch (true)` や boolean への畳み込み前処理が必要になり可読性が落ちる。そうなったら if のサイン。
- 逆に、型設計で状況を discriminated union の `status` に畳み込めれば（illegal states unrepresentable）、if 連鎖を switch に戻せる。
- 各 case の中身が育ったら case ごとに独立コンポーネントへ切り出す。memo の適用単位も自然に手に入る。

## まとめ

- 「値が何か」で分けるなら switch、「状況がどうか」で分けるなら if。ただしどちらも**コンポーネント内の early return** として書き、JSX を返す関数の直接呼び出しはしない。

## 参考

- React 公式: Rules of React — React calls Components and Hooks（https://react.dev/reference/rules/react-calls-components-and-hooks）
- Robin Wieruch: React Conditional Rendering（https://www.robinwieruch.de/conditional-rendering-react/）
- Render Functions & React Components — React Compiler で壊れる例（https://fausto95.substack.com/p/render-functions-and-react-components）
- Component() 直接呼び出しと useState の実害（https://dev.to/carlosrafael22/one-practical-difference-between-component-syntax-and-component-in-react-with-usestate-3pjd）
- switch と if の使い分け（https://sebhastian.com/react-switch/）
