---
title: ライブラリをラップしたら下層を fake にできなくなった — 薄い差し替え口と翻訳する port に分ける
tags: [typescript, testing, test-double, nullables, embedded-stub, thin-wrapper, adapter-pattern, tauri, vitest]
---

## TL;DR

- ラッパーを「使う側」のテストでは、ライブラリの中身ではなく**ラッパー自体**を fake にする（Don't mock what you don't own）。
- ラッパーは 2 層に分ける。**薄い層**（`CommandTransport`）はライブラリと同じ形のまま差し替え口だけ作り、**port**（`AppWindow`）がアプリの言葉に翻訳する。「ライブラリを意識しない」境界は port にある。
- 差し替え口は最下層の 1 行（`invoke` の呼び出し）だけにし、`create()` / `createNull()` に閉じ込める（Nullables / 埋め込みスタブ）。止めるのはその 1 行だけで、上の処理は全部本物が動く。
- `createNull` の設定は port の言葉で受け取り、コマンド名への分解は port の中で閉じる。キーは `satisfies` で型に縛る。
- 止めた 1 行は `mockIPC` で、Rust 側は Rust のテストで、全体は必要なら E2E 1 本で埋める。
- 薄い層に `TauriIpc` のようなライブラリ由来の名前を付けると、ライブラリ本体と区別しにくい。役割で名付ける。

## 遭遇した問題

- 環境: Tauri v2 のフロントエンド（TypeScript + Vitest）、`@tauri-apps/api` 2.1 系。
- `invoke` を自前のラッパー（当初 `TauriIpc`）で包み、`AppWindow` などの port がそれ経由で Rust 側コマンドを呼ぶ構成にした。
- 使う側はライブラリを意識しなくなったが、ライブラリが内部で使う IPC を fake にできず、テストしにくくなった。
- さらに、ラッパーが `invoke(cmd, args)` とほぼ同じ形で「結局ラップできていないのでは」という疑問も出た。

## 原因

- fake にしようとしていた場所が「ラッパーの内側＝他人の型」だった。
- 「差し替え口を作る」役と「アプリの言葉に翻訳する」役が 1 つの層に混ざっていて、どこで何を隠すのかが曖昧だった。
- ライブラリ公式の高レベル API（例: `@tauri-apps/api/window`）は内部で IPC を呼ぶので、自前ラッパーを素通りする。自作コマンドを `invoke` で呼ぶ部分なら自前ラッパーで止められる。

## 解決

### 役割を 2 層に分ける

| 層 | 役割 | 形 |
|---|---|---|
| `CommandTransport` | Rust のコマンドを運ぶだけ。ライブラリを import する唯一の場所 | `invoke` と同じ形（Thin Wrapper）。抽象化しない |
| `AppWindow` などの port | アプリの言葉に翻訳する。本当のラップ | `close(): Promise<Result<void, AppWindowError>>` |

### 薄い層: 差し替え口だけ作る

```ts
export type CommandTransport = Readonly<{
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}>;

export const CommandTransport = {
  create(): CommandTransport {
    return { invoke: (cmd, args) => invoke(cmd, args) };
  },
  /** 設定のないコマンドは null（Rust の `()`）で成功する。失敗は文字列で reject させる。 */
  createNull(responses: NullCommandResponses = {}): CommandTransport {
    return { invoke: async (cmd) => (await responses[cmd]?.()) ?? null };
  },
  // caller: コマンド名を型で縛り、reject を Result に詰め替える
} as const;
```

### port: 翻訳し、Null の設定も自分の言葉で受け取る

```ts
export const AppWindow = {
  create(transport: CommandTransport): AppWindow { /* call("close_current_window", {}) を Result に翻訳 */ },

  createNull(options: { closeError?: string } = {}): AppWindow {
    const { closeError } = options;
    const responses =
      closeError === undefined
        ? {}
        : { close_current_window: () => Promise.reject(closeError) };

    return AppWindow.create(
      CommandTransport.createNull(
        responses satisfies Partial<Record<AppWindowCommand, () => Promise<unknown>>>,
      ),
    );
  },
} as const;
```

テストにはコマンド名も `CommandTransport` も出てこない。

```ts
const result = await AppWindow.createNull({ closeError: "window not found" }).close();
expect(result).toEqual(Result.err({ message: "window not found" }));
```

### 本物を使わなくても処理は通る

`createNull` で差し替わるのは `invoke` を呼ぶ 1 行だけ。`caller` の try/catch、エラーの詰め替え、`Result.map` は本物のまま動く。動かないのは Tauri ランタイム → Rust コマンド → 実際にウィンドウが閉じる部分。本番はコンポジションルートで `CommandTransport.create()` を使うので経路は変わらない。

### 止めた部分を別のテストで埋める

| テスト | 使うもの | 確かめること |
|---|---|---|
| `CommandTransport` | 本物の `create()` + `mockIPC` | `invoke` への受け渡し |
| port | `AppWindow.createNull()` | 翻訳とエラーの詰め替え |
| Rust 側 | Rust のテスト | コマンド自体の動き |
| 全体（任意） | tauri-driver などの E2E 1 本 | つないだ状態で動くか |

```ts
// @vitest-environment jsdom
afterEach(() => clearMocks());

test("create() はコマンドと引数をそのまま invoke に渡す", async () => {
  const received: unknown[] = [];
  mockIPC(async (cmd, args) => {
    received.push({ cmd, args });
    return "ok" as never; // 2.1 系の mockIPC は戻り値をジェネリクスで要求するため
  });

  const result = await CommandTransport.create().invoke("ping", { a: 1 });

  expect(result).toBe("ok");
  expect(received).toEqual([{ cmd: "ping", args: { a: 1 } }]);
});
```

- `mockIPC` は `window` を使うので jsdom / happy-dom 環境が必要。グローバル状態なので `clearMocks()` は必須。
- `mockIPC` だけで済ませて `CommandTransport` をやめる選択肢もある（コードは減るが、port のテストもグローバルなモックに依存する）。`caller` の Result 変換を共通化したいなら薄い層を残す。

## まとめ

- 薄い層は差し替え口、port は翻訳。止めるのは最下層の 1 行だけにして、その 1 行は `mockIPC` で別に確かめる。

## 参考

- James Shore, Testing Without Mocks: A Pattern Language（Nullables / Embedded Stub / Thin Wrapper / Fake It Once You Make It）— https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks
- testdouble, Don't mock what you don't own — https://github.com/testdouble/contributing-tests/wiki/Don't-mock-what-you-don't-own
- Google Testing Blog, Don't Mock Types You Don't Own — https://testing.googleblog.com/2020/07/testing-on-toilet-dont-mock-types-you.html
- Tauri v2, Mock Tauri APIs — https://v2.tauri.app/develop/tests/mocking/
