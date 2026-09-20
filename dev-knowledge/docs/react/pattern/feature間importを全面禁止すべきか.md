---
title: フロントエンドの feature 間 import は全面禁止すべきか
tags: [frontend, react, architecture, directory-structure, feature-sliced-design, bulletproof-react, eslint, module-boundary, ddd]
---

## TL;DR

- **全面禁止は標準ではない。** React 公式・Next.js 公式はフォルダ構成に意見を持たない
- bulletproof-react は「良い考えではないかもしれない」程度の表現。lint 設定例は任意の手段として添えられているだけ
- 明確に禁止しているのは FSD だけ。しかも entities 層に `@x` という例外を後付けしている
- 日本語圏・英語圏とも、実運用の着地はほぼ同じ。**規制対象は deep import であって、feature 間の参照そのものではない**
- 判断すべきは禁止の是非ではなく、**参照が一方向か・循環がないか・公開API を通っているか**

## このドキュメントの射程

feature ベースのディレクトリ構成で、`features/a` から `features/b` を import してよいのか。禁止するのが一般的なのか、するとしたら押し出されたコードをどこへ置くのか。

## なぜ「禁止が標準」に見えるのか

**1. bulletproof-react の lint 設定例が目立つ**

原文の地の文は「feature を跨いで import するのは良い考えではないかもしれない、代わりにアプリケーションレベルで合成する」という提案レベル。そのあとに「禁止したいなら ESLint でこう書ける」と `import/no-restricted-paths` の設定例が続く。**コードブロックのほうが視覚的に強いので、断定として読んでしまう。**

しかもその設定例は zones に feature を1つずつ手書きで列挙する形で、feature を追加するたびに設定も足す必要がある。全面禁止を強く推している書き方ではない。

同じドキュメント内で、以前は barrel file を推奨していたが Vite の tree shaking で問題が出るため直接 import を推奨する、と方針転換も記録されている。**権威筋も意見を変えている**。

**2. FSD の存在感**

FSD は同一レイヤーのスライス間 import を原則禁止としていて、リンター（steiger）と公式のエスケープハッチ（`@x` 記法）まで揃っている。ただし公式が「cross-import は最小限に、この記法は Entities 層でのみ」と注記しているのは、**当初の禁止が実運用で無理があった**ことの裏返し。

規模で見ると、FSD 公式ドキュメントが 2,300 スター程度・steiger が 417 に対して、bulletproof-react は 35,800。一桁違う。

**3. 「feature」の指すものがドキュメントごとに違う**

| | feature の意味 | ドメイン層 |
|---|---|---|
| bulletproof-react / FSD | UI の機能単位（auth, comments） | 独立していない。feature 内に散る |
| ドメイン駆動寄りの構成 | ユースケース単位 | `domains/` として独立 |

前者はドメインが feature の中にあるので、feature 間の参照が即座に重い結合になる。後者はドメインが外にあるので、feature は操作の入れ物でしかなく、参照が起きても被害が小さい。**前提が違うので、そのまま禁止ルールを輸入すると合わない。**

## 判断の仕方

### 何を禁止するか

| 対象 | 判断 | 理由 |
|---|---|---|
| deep import（`features/x/components/Foo`） | **常に禁止** | 内部構造への依存。設定コストだけで防げる |
| 循環参照 | **常に禁止** | 依存の順序が決まらなくなる |
| 公開API 経由の参照（`features/x`） | **プロジェクト次第** | 禁止しても得るものが小さいことが多い |

公開API 経由まで禁止すると、**参照が発生した瞬間に共有層への昇格が強制される**。まだ 1 つの feature の事情でしかないものが、境界の固まる前に上へ押し出される。許可しておけば「2 つ以上が必要としたら昇格」まで判断を遅らせられる。

### 禁止した場合の置き場所

| 押し出されるもの | 行き先 |
|---|---|
| 複数 feature の UI の組み合わせ | 上位レイヤー（page / route / app）で合成する |
| 2 つ以上が必要とする型・ドメイン | 一段下の共有層へ落とす |
| 1 操作が 2 feature に跨る手順 | 呼び出し元に置く。動詞で名付ける |

**共有フォルダ（`services/` 等）に集めない。** 名詞のフォルダに集約すると、結合の形が「feature ↔ feature」から「feature → 共有ハブ ← feature」に変わるだけで、波及範囲はむしろ広がる。乱立が悪いのではなく、**ハブになることが悪い**。判定は「呼び出し元が 1 つか複数か」。1 つなら呼び出し元に同居させる。

### ネストで解けるケース

親でしか使わない子をトップレベルに出さずに済む、という利点がある。ただし成立条件がある。

- **子の参照元が親 1 つだけ**であること。参照元が 2 つあると、どちらに入れても兄弟参照か孫への deep import になる
- 深さは 2 階層まで。それ以上は相対 import が破綻する
- **ドメイン軸でまとまっているものはネストしない。** 画面領域ごとに 3 つの UI を提供していても、同じドメイン・同じ選択状態に反応して一緒に変わるなら、それは 1 つのまとまり。使われ方で割ると凝集が壊れる

### lint で固定する

規約だけでは守れないので機械的に落とす。ただし**今すでに守れているかを先に数える**。0 件なら移行コストなしで入れられるし、違反があるなら禁止の是非から考え直しになる。

```bash
# feature 間 import の実態を数える（自 feature 内は除外）
grep -rnE '@/features/' src/features --include="*.ts" --include="*.tsx" \
  | grep -v "__tests__"
```

deep import だけを落とす場合（公開API 経由は許可）:

```js
'no-restricted-imports': [
  'error',
  {
    patterns: [
      {
        group: ['@/features/*/*'],   // features/x/... の 2 階層目以降を禁止
        message: 'feature の内部へ直接 import しない。index.ts 経由で。',
      },
    ],
  },
],
```

全面禁止する場合（bulletproof-react 方式・feature を列挙）:

```js
'import/no-restricted-paths': [
  'error',
  {
    zones: ['auth', 'comments', 'discussions'].map((name) => ({
      target: `./src/features/${name}`,
      from: './src/features',
      except: [`./${name}`],
    })),
  },
],
```

列挙が負担になったら `eslint-plugin-boundaries` の elementTypes に切り替える。パッケージ分割できるなら `package.json` の `exports` で塞ぐのが最も強い（lint より前に解決が失敗する）。

## まとめ

feature 間 import の全面禁止は方法論の一つであって業界標準ではない。守るべき線は **deep import の禁止**と**循環の禁止**で、公開API 経由の参照を許すかはプロジェクトの事情で決めてよい。禁止を検討する前に、まず実際の参照を数えること。

## 参考

- [bulletproof-react / project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [React 旧ドキュメント File Structure](https://legacy.reactjs.org/docs/faq-structure.html)（react.dev では削除済み）
- [Next.js / Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure)
- [Feature-Sliced Design 公式](https://feature-sliced.design/)
- [フロントエンドのディレクトリ構成を整理してコードの凝集度を高める（Zenn）](https://zenn.dev/atamaplus/articles/frontend-package-by-feature)
- [フロントエンドのディレクトリ構成で再帰的な features 構成を推したい（Zenn）](https://zenn.dev/pksha/articles/recursive-features-directory-structure)
