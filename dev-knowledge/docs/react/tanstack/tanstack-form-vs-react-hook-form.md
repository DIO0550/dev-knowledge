---
title: TanStack Form と React Hook Form は型推論の深さと実績のどちらを取るかで選ぶ
tags: [react, tanstack-form, react-hook-form, validation, typescript]
---

## TL;DR

- TanStack Form は `useForm` + `form.Field`（render props）で各フィールドを制御寄りに配線するフォームライブラリ。`validators` に `onChange` / `onBlur` / `onSubmit` とその async 版を書け、Zod / Valibot / ArkType などの Standard Schema をアダプタなしで直接渡せる
- React Hook Form（RHF）は `register` で ref 経由の非制御入力を基本とし、制御コンポーネントは `Controller` で包む。スキーマは `resolver` 経由
- 型推論の深さ（ネストした名前・値まで推論）、フレームワーク非依存、組み込みの async デバウンスは TanStack Form が強い。成熟度・情報量・周辺エコシステムは RHF が強い
- 既存の RHF 資産があるなら乗り換える理由は薄い。新規で型安全を重視する、TanStack Start / Router と揃えたい、React 以外にも展開する、なら TanStack Form

## 背景・射程

- 対象：`@tanstack/react-form` v1（確認時点 1.33.5、v1.0.0 は 2025-03 リリース。v2 は alpha）、`react-hook-form` v7（確認時点 7.92.0、v8 は beta）
- 確認日：2026-11-25。公式ドキュメントと npm のパッケージ情報で確認した
- React で中〜大規模フォームを組むときにどちらを選ぶか、の判断材料をまとめる。Formik など他のライブラリは扱わない

### TanStack Form の基本形

```tsx
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';

export function SignupForm() {
  const form = useForm({
    defaultValues: { email: '', age: 0 }, // ここから値の型が推論される
    onSubmit: async ({ value }) => {
      await fetch('/api/signup', { method: 'POST', body: JSON.stringify(value) });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field
        name="email" // 存在しないキーは型エラー
        validators={{
          onChange: z.string().email('メールアドレスの形式が不正'), // Standard Schema を直接渡せる
          onChangeAsyncDebounceMs: 500,
          onChangeAsync: async ({ value }) =>
            (await isTaken(value)) ? '既に登録済み' : undefined,
        }}
        children={(field) => (
          <>
            <input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {!field.state.meta.isValid && (
              <em role="alert">{field.state.meta.errors.join(', ')}</em>
            )}
          </>
        )}
      />
      <form.Field
        name="age"
        validators={{ onBlur: ({ value }) => (value < 13 ? '13 歳以上のみ' : undefined) }}
        children={(field) => (
          <input
            type="number"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.valueAsNumber)}
          />
        )}
      />
      <form.Subscribe
        selector={(s) => [s.canSubmit, s.isSubmitting]}
        children={([canSubmit, isSubmitting]) => (
          <button type="submit" disabled={!canSubmit}>
            {isSubmitting ? '送信中...' : '登録'}
          </button>
        )}
      />
    </form>
  );
}
```

- `validators` はフィールド単位にも `useForm` のフォーム単位にも書ける。フォーム単位の `onChange` にスキーマ全体（`z.object(...)`）を渡す書き方もできる
- イベントは `onChange` / `onBlur` / `onSubmit`（と `onMount` など）、それぞれに `Async` 版と `AsyncDebounceMs` がある。エラーは `field.state.meta.errors`、どのイベント由来かは `errorMap` で区別できる
- `form.Subscribe` / `useStore` で必要な状態だけを購読し、再レンダー範囲を絞る
- 繰り返し使う入力部品は `createFormHook` で `useAppForm` / `form.AppField` を作り、型付きの自作フィールドコンポーネントを登録するのが公式推奨のスケール方法

## 判断軸・比較

| 観点 | TanStack Form | React Hook Form |
|---|---|---|
| 入力との結び付け | `field.state.value` と `field.handleChange` を自分で配線する制御寄り。値は TanStack Store に持ち、購読はフィールド単位 | `register` が返す `ref` / `onChange` を spread する非制御が基本。DOM が値を持ち、送信時やバリデーション時に読む |
| 制御コンポーネント（MUI、shadcn/ui の Select 等） | 同じ書き方で扱える（もともと制御寄り） | `Controller` / `useController` で包む |
| 再レンダー | 購読したフィールド・状態だけ再レンダー | 非制御なので入力中の再レンダーが少ない。`watch` の使い方次第で増える |
| 型安全性 | `defaultValues` から値の型、`name` の候補、ネストした配列の要素型まで推論。バリデータの引数も型付き | `useForm<FormValues>()` のジェネリクスで型付け。`name` はパス文字列として補完される。ネスト配列の field array では型キャストが要る場面がある |
| バリデーション | フィールド/フォーム単位 × `onChange`/`onBlur`/`onSubmit`/async を宣言的に書ける。async デバウンスが組み込み | `register` のルール（`required` 等）か `resolver`。発火タイミングは `mode` / `reValidateMode` でフォーム全体に指定 |
| スキーマ | Standard Schema（Zod / Valibot / ArkType 等）をバリデータに直接渡せる | `@hookform/resolvers` の各 resolver（Standard Schema 用の `standardSchemaResolver` もある） |
| フレームワーク | React / Vue / Angular / Solid / Lit / Svelte 向けアダプタ（core は非依存） | React 専用 |
| SSR・メタフレームワーク連携 | `@tanstack/react-form-start` / `-nextjs` / `-remix` でサーバー側検証の統合パッケージがある | 専用の SSR 統合パッケージはない（TanStack 側の比較表でも非対応扱い） |
| 成熟度・エコシステム | v1 は 2025-03。情報量は増えているが RHF より少ない | v7 が長く安定しており、記事・Q&A・UI キットとの統合（shadcn/ui の Form は RHF ベースで普及した）が豊富 |
| 記述量 | render props で入力ごとの配線が多め。`createFormHook` で抑える前提 | `{...register('email')}` だけで済むシンプルなフォームは最短 |

公式の比較表（TanStack Form 側のドキュメント）は TanStack 自身が作成したもので、「作成中で完全には正確でない」と注記がある。RHF の評価は RHF 側のドキュメントとあわせて読む。

### 設計思想の違い

- RHF は「ネイティブ input と非制御を活かして再レンダーを減らす」発想。HTML の `<input>` 中心のフォームでは記述が最短で速い
- TanStack Form は「フォーム状態をストアに置き、型で全部つなぐ」発想。値を常に state として持つので、カスタム入力部品・計算フィールド・フィールド間の依存（`onChangeListenTo` 等）を同じ作法で書ける

どちらも JSX を持たず状態と関数を返す headless な設計で、既存記事「hooks と UI の分離原則 - "headless" の 2 つの実装と英語圏ライブラリの慣行」でいう B 派寄りに当たる（TanStack Form は `form.Field` というコンポーネント形式も持つ）。

## 指針

- 既存プロジェクトで RHF が動いている → そのまま使う。乗り換えのコストに見合う差は少ない
- shadcn/ui など RHF 前提の UI キットに乗る、ネイティブ input 中心のシンプルなフォーム → RHF
- 新規で TypeScript の推論を最大限使いたい、フィールドごとに発火タイミングの違うバリデーションや async 検証（重複チェック等）が多い → TanStack Form
- TanStack Start / Router / Query で揃えている、React 以外のフレームワークにも同じフォームロジックを持っていく → TanStack Form
- どちらを選んでもスキーマは Standard Schema 準拠ライブラリ（Zod など）で書いておけば、後から乗り換えるときにバリデーション定義を流用できる

## 参考

- [TanStack Form Overview](https://tanstack.com/form/latest/docs/overview)
- [TanStack Form Quick Start (React)](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [TanStack Form: Form and Field Validation (React)](https://tanstack.com/form/latest/docs/framework/react/guides/validation)
- [TanStack Form: Comparison](https://tanstack.com/form/latest/docs/comparison)
- [Announcing TanStack Form v1](https://tanstack.com/blog/announcing-tanstack-form-v1)
- [React Hook Form: Get Started](https://react-hook-form.com/get-started)
- [@hookform/resolvers（npm）](https://www.npmjs.com/package/@hookform/resolvers)
