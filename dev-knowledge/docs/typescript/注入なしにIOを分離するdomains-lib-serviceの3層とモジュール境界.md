---
title: TypeScript で注入なしに I/O を分離する：domains / lib / service の3層とモジュール境界
tags: [typescript, architecture, functional-core-imperative-shell, hexagonal-architecture, companion-object, dependency-injection, module-mocking, vitest, testing, layering]
---

## TL;DR

- 層は3つ。**domains**（純粋な型とコンパニオン、I/O を知らない）／**lib**（`window`・`fetch`・`Date` などの I/O をラップした関数を1か所に集める）／**service**（lib と domains を呼んでつなぐ）。
- **lib は自分の関心ごとのデータしか受け取らない。** 注文書のような業務データを渡さず、宛先と本文のような「送るのに必要な最小の型」だけ渡す。返すのも成否や生データだけで、業務の意味は付けない。
- **service の仕事は両方向の翻訳。** 行きは domains で業務データから lib の入力を作り、帰りは lib の結果を domains に渡して業務の意味（イベントを出す／出さない）に変える。小さな業務判断が service にあるのは普通。
- 依存を引数で上から渡す（注入）ことはしない。lib を直接 import し、テストではモジュール境界ごと差し替える（`vi.mock`）。TS ではモジュール境界が注入点の代わりになる。
- 守る線は1本だけ：**業務の判断を lib に入れない。** service か domains に置く。`vi.mock` なしでテストしたい判断は domains に降ろす。

## このドキュメントの射程

- フロントエンド／Node の TypeScript で、コンパニオンオブジェクト（型と同名の `const` に関数をまとめる）中心に書いている場合の I/O の分離方法。
- DI コンテナや関数注入を使わずに、テストと差し替えを成立させる構成。
- Rust など、モジュールモックが使えない環境への持ち出し方も末尾で触れる。

## 遭遇した問題

- 依存を引数で受け取る設計（DI）にすると、I/O を呼ぶ深さの分だけ上から依存を渡し続けることになり、面倒。
- 逆に I/O ラッパーに業務データをそのまま渡すと、ラッパーが「誰に送るか」「送れたら何を記録するか」まで決め始め、I/O 実装を替えるたびに業務ルールをコピーすることになる。
- 業務の判断が I/O と同じ関数にあると、その判断をテストするのに本物の I/O かモックが必要になる。

## 原因

- 差し替えの単位を「関数1個」と考えると、関数型を定義して注入する形になる。コンパニオン方式では振る舞いは最初から型ごとのまとまりとして置かれているので、注入の必要自体が薄い。
- I/O ラッパーに業務データを渡すのは、ラッパーの入力型が広すぎる（知りすぎ）ことが原因。知っていれば選べてしまうので、判断が漏れる（決めすぎ）。
- Functional Core, Imperative Shell の考え方では、コアは純粋関数だけで書き、シェルは I/O を編成する薄い層に留める。判断がシェルに入るほどテストが重くなる。

## 解決

### 3層の役割

| 層 | 中身 | 知っているもの | テスト |
|---|---|---|---|
| `domains` | 型 + コンパニオン（純粋関数） | 他のドメイン型のみ | 値を渡すだけ |
| `lib` | I/O をラップした関数。`browser/clock.ts`、`browser/storage.ts`、`mail/smtp.ts` など | ブラウザ API・外部ライブラリのみ。ドメインを知らない | 統合テスト or 触らない |
| `service` | lib と domains を呼んでつなぐ。小さな業務判断も可 | 両方 | `vi.mock` で lib を差し替える |

### lib が受け取るもの・返すものを絞る

```ts
// lib/mail.ts ―― 自分の関心ごとのデータだけ受け取る
export type Envelope = { to: string; subject: string; html: string };
export type SendResult = "Sent" | "NotSent";

export const Mail = {
  send: async (env: Envelope): Promise<SendResult> => {
    try {
      await transporter.sendMail({ from: FROM, ...env });
      return "Sent";
    } catch (e) {
      console.error("mail failed", e);   // ログやリトライは lib の仕事
      return "NotSent";
    }
  },
};
```

`Order` 型はここに出てこない。だから `Order` の構造が変わっても `lib/mail.ts` は無関係で、別のアプリでも使い回せる。

### domains は純粋関数で業務の判断を持つ

```ts
// domains/order.ts ―― I/O を知らない
export type Order = { readonly id: OrderId; readonly customerEmail: string; /* ... */ };
export type AckSent = { readonly orderId: OrderId; readonly to: string };

export const Order = {
  envelope: (o: Order, html: string): Envelope =>
    ({ to: o.customerEmail, subject: "ご注文を承りました", html }),   // 誰に送るか
  ackEvent: (o: Order, r: SendResult): AckSent | undefined =>
    r === "Sent" ? { orderId: o.id, to: o.customerEmail } : undefined, // 送れたら何が起きたことにするか
};
```

### service は翻訳とつなぎ

```ts
// service/acknowledgeOrder.ts ―― lib を直接 import。注入しない
import { Mail } from "../lib/mail";
import { Order } from "../domains/order";
import { renderAckLetter } from "../lib/template";

export const acknowledgeOrder = async (order: Order): Promise<AckSent | undefined> => {
  const env = Order.envelope(order, renderAckLetter(order)); // 行き：domains で lib の入力を作る
  const result = await Mail.send(env);                       // I/O
  return Order.ackEvent(order, result);                      // 帰り：lib の結果を業務の意味に
};
```

### テスト

```ts
// domains：モック不要
expect(Order.ackEvent(order, "NotSent")).toBeUndefined();

// service：モジュール境界ごと差し替える
vi.mock("../lib/mail", () => ({ Mail: { send: async () => "Sent" } }));
expect(await acknowledgeOrder(order)).toEqual({ orderId: order.id, to: order.customerEmail });
```

### 判断をどこに置くかの基準

- 業務の判断（宛先、記録の内容、失敗時の扱い）は **lib に入れない**。これだけは必ず守る。
- service に小さな判断があるのは普通。ただし `vi.mock` なしでテストしたい判断は domains のコンパニオンに降ろす。
- 目安：「別のやり方もありえた」と言える行（担当者に送る、失敗したら注文を保留、など）は業務の判断。if 文の有無は関係ない。

### lib の切り方は2段構え

| 切り方 | 例 | 性質 |
|---|---|---|
| 技術ごと | `lib/browser/storage.ts`（`getItem` / `setItem`） | 汎用。ドメインを知らない。キー名などの決めごとは呼ぶ側に散る |
| 用途ごと | `lib/preferencesStore.ts`（`loadTheme` / `saveTheme`） | ドメインの言葉。中で `localStorage` を使う。呼ぶ側は保存先を知らない |

技術ごとの薄いラッパーを下に置き、その上に用途ごとの関数を載せると、汎用性と使いやすさを両立できる。

### モジュールモックの注意点

- Jasmine のドキュメントは「多くの場合 DI のほうがモジュールモックより良い選択」と明言しており、Vitest も「テスト可能にするのはテストランナーではなくアプリの設計の責任」という立場。モジュールモックは「密結合したコードでもテストできる」手段であって、設計の代わりではない。
- `vi.mock` はファイル単位で hoist され、テスト間で状態が汚染されるリスクがある。lib を1か所に集めておくと、モックする対象も1か所になり、この問題が小さくなる。
- 同じモジュール内の関数呼び出しは `vi.spyOn` で差し替えられない（Vitest はこれを意図した挙動としている）。lib は必ず別モジュールに置く。

### 注入に切り替える条件

次のどちらかに当たるときだけ、lib を引数で受け取る形（オブジェクト型 `Sender` など）に変える。

- 同じ処理を実行時に複数の実装で動かしたい（SMTP と SES を設定で切り替える等）
- モジュールモックが使えない環境に持ち出す（Rust への移植など）

Rust に移す場合の対応：domains → struct + impl の純粋関数、lib → trait を実装した struct、service → trait をジェネリクスで受ける関数、または I/O を外側に出す sans-IO。

## まとめ

- domains は純粋、lib は自分の関心ごとしか受け取らない、service が両方向の翻訳をする。
- 注入は不要。lib を1か所に集めて直接 import し、テストではモジュール境界ごと差し替える。
- 守るのは「業務の判断を lib に入れない」だけ。domains に降ろすかは、テストの都合で決める。

## 参考

- Gary Bernhardt, "Boundaries"（Functional Core, Imperative Shell の原典）— https://www.destroyallsoftware.com/talks/boundaries
- functional-architecture.org, "Functional Core, Imperative Shell" — https://functional-architecture.org/functional_core_imperative_shell/
- Kenneth Lange, "The Functional Core, Imperative Shell Pattern"（TS 例あり）— https://kennethlange.com/functional-core-imperative-shell/
- サバイバルTypeScript「コンパニオンオブジェクトパターン」— https://typescriptbook.jp/tips/companion-object
- Zenn「値・型・名前空間の『三重定義』でReactコンポーネントをより柔軟に設計する」— https://zenn.dev/bmth/articles/ts-companion-object
- Vitest, "Mocking Modules" — https://vitest.dev/guide/mocking/modules
- Jasmine, "Module Mocking"（DI との比較）— https://jasmine.github.io/tutorials/module_mocking
- howtocodeit, "Master Hexagonal Architecture in Rust"（Rust へ持ち出す場合）— https://www.howtocodeit.com/guides/master-hexagonal-architecture-in-rust
