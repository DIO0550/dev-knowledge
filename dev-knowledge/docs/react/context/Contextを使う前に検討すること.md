---
title: Context を使う前に検討すること（コンポジション優先）
tags: [react, context, useContext, composition, state, design, performance]
---

## TL;DR

- Context は「prop drilling（バケツリレー）が辛い」から短絡的に使うものではない。**多くの prop drilling はコンポーネントのコンポジションで消せる**。
- まず疑うべきは「そもそもこの state を上に持ちすぎていないか」「children として渡せば中間コンポーネントに prop を通さずに済まないか」。
- Context が本当に効くのは、**アプリ全体で広く共有される少数の値**（テーマ、認証ユーザー、ロケール、i18n など）。それ以外は state リフトアップ + コンポジションで足りることが多い。
- Kent C. Dodds「How to use React Context effectively」の冒頭の主張がこれ。「Context は最後の手段ではないが、最初の手段でもない」。

---

## 1. よくある誤解

「prop を 3〜4 階層バケツリレーしていて辛い → Context にしよう」という反射は、しばしば早すぎる。

```tsx
// 中間の Page / Layout は user を使わないのに通すだけ
function App() {
  const [user] = useState(/* ... */);
  return <Page user={user} />;
}
function Page({ user }) {
  return <Layout user={user} />;
}
function Layout({ user }) {
  return <Header user={user} />;
}
function Header({ user }) {
  return <span>{user.name}</span>;
}
```

「`user` を 3 段通すのが嫌」というのは事実だが、Context が唯一の解ではない。

---

## 2. 第一選択: コンポジション（children として渡す）

中間コンポーネントが prop を**使わずに通しているだけ**なら、JSX を組み立てる位置を変えれば prop drilling 自体が消える。

```tsx
function App() {
  const [user] = useState(/* ... */);
  // Header をここで組み立てて children として流し込む
  return (
    <Page>
      <Layout>
        <Header user={user} />
      </Layout>
    </Page>
  );
}

function Page({ children }) {
  return <main>{children}</main>;
}
function Layout({ children }) {
  return <div className="layout">{children}</div>;
}
```

`Page` / `Layout` は `user` を一切知らなくてよくなる。これは "component composition" と呼ばれ、**多くの prop drilling はこれで解決する**（React 公式ドキュメントも Context の前にこれを勧めている）。

### コンポジションの限界（ここで Context が要る）

コンポジションは「**値を組み立てる位置（App など上の方）から、それを使う JSX を流し込める**」場合に効く。逆に、これが届かないケースが Context の本来の出番。

- 値を使う場所が**深く・多数**に散らばっていて、全部を children として上から流し込むと JSX が破綻する（"render prop / children の渡しすぎで逆に読みにくい"）。
- 値を使うのが**他人が描画する深い位置**（再利用コンポーネントの内部、ルーティング先のページ、ライブラリが内部でレンダーする子）で、JSX の組み立て位置をこちらで制御できない。
- 中間が「素通し」ではなく、各階層が**それぞれ別の prop も足していく**ため、children に逃がしても結局あちこちで prop を持ち回ることになる。

こういう「どうしても深いネストの先で値を使いたい／コンポジションでは届かせられない」状況こそ Context が正解。コンポジションで消せる prop drilling と、消せず Context が要る prop drilling を見分けるのがポイント。

---

## 3. 第二選択: state リフトアップの見直し

そもそも state を持つ場所が高すぎないか。`user` を使うのが `Header` 周辺だけなら、`App` ではなくもっと近い共通祖先に置けば drilling の距離が縮む。「グローバルに見える state が実はローカルで足りる」ことは多い。

判断の順番:

1. その state、本当にこの高さに要る？ → 使う場所の近くに下ろせないか
2. 中間コンポーネントは prop を使ってる？ 通すだけ？ → 通すだけなら children コンポジション
3. それでも「広く・深く・多数の場所」で要る → Context の出番

---

## 4. Context が正当化される条件

以下を**満たすほど** Context が向く。

- アプリの広範囲から参照される（テーマ、認証、ロケール、フィーチャーフラグなど）
- 階層が深く、コンポジションでは届かせにくい
- 値の種類が少なく安定している（頻繁に変わる巨大 state を素朴に Context へ載せると再レンダー問題が出る → 別記事参照）

逆に「特定の画面の中だけで使う」「中間が prop を素通ししているだけ」なら、Context はオーバーキル。抽象が一段増えてテスト・追跡が難しくなる割に得が小さい。

---

## まとめ

1. prop drilling が辛い ＝ 即 Context、ではない。
2. まず children コンポジションで「通すだけの prop」を消せないか見る。
3. 次に state を持つ高さが適切か見直す。
4. それでも広く・深く共有が必要な少数の値だけ Context にする。
5. Context は「最後の手段ではないが最初の手段でもない」。

> 参考: Kent C. Dodds "How to use React Context effectively" / React 公式 "Passing Data Deeply with Context"（Before You Use Context の節）
