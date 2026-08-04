---
title: API 成功後の画面遷移にガードは必要か（useEffect / イベントハンドラ別の判断）
tags: [react, react-router, nextjs, tanstack-query, useEffect, navigation, race-condition, abortcontroller, useRef, custom-hooks]
---

## TL;DR

- **ガードは必要**。`navigate()` / `router.push()` は unmount 後でも普通に実行され、「送信中に戻る → 応答が返って再び前に飛ばされる」は実在するバグ。
- ただし**「ref でガード」が正解になるのは限られたケースだけ**。
- `useEffect` 内（GET）→ **ref は誤り**。cleanup + `AbortController` / `ignore` closure 変数。
- ボタン押下（POST）→ **キャンセルではなく「遷移だけ抑制」が正解**。TanStack Query なら `mutate` 第2引数の `onSuccess` に置くだけで済む。素の fetch のときだけ `isMounted` ref が妥当。
- React Router Data mode（`<Form>` + action + `redirect()`）ならルーター側が持っているのでアプリ側のガードは不要。

## このドキュメントの射程

カスタムフックの `useEffect` 内、またはボタン押下ハンドラで API を呼び、**成功後に画面遷移する**設計を対象にする。

> API 呼び出し中にユーザーがブラウザバックしたり別画面へ移動したら、応答が返ったタイミングで再度遷移してしまうのではないか？

この仮説の検証と、ケース別の対処方針を扱う。データ取得結果の表示（setState）だけで遷移を伴わないケースは既知の話なので範囲外。

## 遭遇した問題

### 環境

- React 18 / 19
- React Router v6〜v7（Declarative mode / Data mode 両方）
- Next.js App Router
- TanStack Query v4 / v5

### 再現条件

1. 確認画面で「注文を確定する」を押す（POST 開始）
2. 応答が返る前にブラウザバックでカート画面へ戻る（コンポーネントは unmount）
3. POST の応答が返る
4. `navigate('/orders/xxx')` が実行され、**ユーザーの意思に反して注文詳細へ飛ばされる**

`navigate(..., { replace: true })` を付けても遷移自体は起きるので回避にならない。

## 原因

### React Router の `navigate()` は unmount 後もガードされていない

`packages/react-router/lib/hooks.tsx`（`useNavigateUnstable` / `useNavigateStable` の両方に同一構造がある）:

```tsx
let activeRef = React.useRef(false);
React.useLayoutEffect(() => {
  activeRef.current = true;
});

let navigate: NavigateFunction = React.useCallback(
  (to, options = {}) => {
    warning(activeRef.current, navigateEffectWarning);

    // Short circuit here since if this happens on first render the navigate
    // is useless because we haven't wired up our history listener yet
    if (!activeRef.current) return;
    ...
```

`activeRef` は **layout effect で `true` にするだけで、cleanup で `false` に戻していない**。コメントの通り「初回レンダー中の呼び出し」を潰すためのもので、unmount 後のガードではない。したがって unmount 後に `navigate()` を呼ぶと `navigator.push` / `router.navigate` がそのまま走る。

### Next.js App Router も同様

`packages/next/src/client/components/navigation.ts`:

```tsx
export function useRouter(): AppRouterInstance {
  const router = useContext(AppRouterContext)
  if (router === null) {
    throw new Error('invariant expected app router to be mounted')
  }
  ...
  return useMemo(
    () => ({
      back: router.back,
      push: router.push,
      replace: router.replace,
      ...
    }),
    [router, bfcacheIdNumber]
  )
}
```

context 上の router インスタンスのメソッドをそのまま返すだけで、呼び出し元のマウント状態は一切見ていない。

### 「React 18 で unmount 後 setState の警告が消えた」は適用できない

`isMounted` は長らくアンチパターン扱いで、React 18 では PR facebook/react#22114（Dan Abramov）で unmount 後 setState の警告自体が削除された。ただしその理由は **「setState は no-op なので実害がない」**。

`navigate()` は React 外部の history に対する副作用であり **no-op ではない**。「React 18 だから気にしなくていい」はここには当てはまらない。

## 解決

### ケースA: `useEffect` 内で GET → 成功で遷移

cleanup があるので、React 公式の方法で足りる。GET なら `AbortController` がリクエスト自体も止まるため上位互換。

```tsx
// hooks/useCheckoutSessionVerification.ts
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

type VerificationState =
  | { status: "verifying" }
  | { status: "failed"; reason: string };

export function useCheckoutSessionVerification(sessionId: string) {
  const navigate = useNavigate();
  const [state, setState] = useState<VerificationState>({ status: "verifying" });

  useEffect(() => {
    const controller = new AbortController();

    async function verify() {
      try {
        const response = await fetch(`/api/checkout-sessions/${sessionId}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setState({ status: "failed", reason: `HTTP ${response.status}` });
          return;
        }
        const { orderId } = (await response.json()) as { orderId: string };
        navigate(`/orders/${orderId}`, { replace: true });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return; // cleanup で中断済み。遷移も setState もしない
        }
        setState({ status: "failed", reason: String(error) });
      }
    }

    verify();
    return () => controller.abort();
  }, [sessionId, navigate]);

  return state;
}
```

#### なぜ ref だと壊れるのか

`isMountedRef` は **unmount のときは偶然動くが、依存変更での再実行時に壊れる**。

```tsx
// ❌ 壊れるパターン
const isMountedRef = useRef(false);

useEffect(() => {
  isMountedRef.current = true;

  fetchCheckoutSession(sessionId).then((session) => {
    if (isMountedRef.current) {
      navigate(`/orders/${session.orderId}`);
    }
  });

  return () => {
    isMountedRef.current = false;
  };
}, [sessionId, navigate]);
```

`sessionId` が変わったときの実行順:

1. cleanup が走る → `isMountedRef.current = false`
2. **新しい effect body が走る → `isMountedRef.current = true` に戻る**
3. 古い `fetchCheckoutSession` が解決する
4. ガードを通過してしまい、**古い `orderId` へ遷移する**

ref は effect の実行インスタンス間で共有されるので「どの実行の結果か」を区別できない。`ignore` closure 変数や `AbortController` は effect 実行ごとに新しいインスタンスが作られるため、この区別が構造的に成立する。

> **補足（`navigate` を依存配列に入れる件）**
> Declarative mode（`<BrowserRouter>`）の `useNavigateUnstable` は内部で `useLocation()` に依存しており、location 変更のたびに identity が変わる。依存配列に入れると effect が再実行され abort → 再 fetch が起きる。Data/Framework mode（`RouterProvider`）の `useNavigateStable` は安定参照なので問題ない。Declarative mode では `useEffectEvent` に逃がすなどの対処が要る。

### ケースB: ボタン押下 → POST 成功 → 遷移

cleanup が無いので**何らかのガードは必要**。ただしケースAと決定的に違う点がある。

**POST を `AbortController` でキャンセルしてはいけない場合が多い。** abort してもサーバ側の処理は取り消されないので「注文は作られたのに UI 上はキャンセル扱い」になる。ここで欲しいのは *リクエストの中断* ではなく ***遷移だけの抑制*** である。

#### B-1. TanStack Query を使っているなら既に用意されている（推奨）

公式ドキュメントに、`mutate` の第2引数に渡した追加コールバックは mutation 完了前にコンポーネントが unmount すると実行されないと明記されている。mutate 呼び出しのたびに mutation observer が解除・再購読されるためで、逆に `useMutation` 側のハンドラは常に実行される。

TkDodo はこれを設計指針として整理している。invalidation のような「必ず実行すべきロジック」は `useMutation` 側、リダイレクトやトーストのような UI 都合の処理は `mutate` 側。ユーザーが完了前に離脱していれば後者は**意図的に**発火しない。

```tsx
// hooks/useSubmitOrder.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createOrder, type Order, type OrderDraft } from "../api/orders";

export function useSubmitOrder() {
  const queryClient = useQueryClient();

  return useMutation<Order, Error, OrderDraft>({
    mutationFn: (draft) => createOrder(draft),
    // キャッシュ整合性は「必ず」走らせたいので useMutation 側
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
    },
  });
}
```

```tsx
// pages/OrderConfirmPage.tsx
import { useNavigate } from "react-router";
import { useSubmitOrder } from "../hooks/useSubmitOrder";
import type { OrderDraft } from "../api/orders";

export function OrderConfirmPage({ draft }: { draft: OrderDraft }) {
  const navigate = useNavigate();
  const submitOrder = useSubmitOrder();

  const handleConfirm = () => {
    submitOrder.mutate(draft, {
      // UI 都合の副作用は mutate 側。unmount 済みなら呼ばれない
      onSuccess: (order) => navigate(`/orders/${order.id}`, { replace: true }),
    });
  };

  return (
    <button type="button" onClick={handleConfirm} disabled={submitOrder.isPending}>
      {submitOrder.isPending ? "送信中..." : "注文を確定する"}
    </button>
  );
}
```

注意点:

- TanStack/query discussion #4804 の指摘によれば、この保証が効くのは unmount 時点で mutation が既に in-flight だった場合で、unmount 直前に開始したケースでは発火しうる。
- `mutateAsync` で promise を直接チェーンすると React のライフサイクルに紐づかないため、この保護は効かない。

#### B-2. 素の fetch の場合（ref が妥当な唯一のケース）

「リクエストは完走させ、遷移だけ抑制する」ため、ここでは `isMounted` ref が適切。

```tsx
// pages/OrderConfirmPage.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createOrder, type OrderDraft } from "../api/orders";

export function OrderConfirmPage({ draft }: { draft: OrderDraft }) {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const order = await createOrder(draft);
      if (!isMountedRef.current) return; // 画面を離れていたら遷移しない
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (error) {
      if (!isMountedRef.current) return;
      setIsSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : "注文の確定に失敗しました");
    }
  };

  return (
    <>
      {errorMessage !== null && <p role="alert">{errorMessage}</p>}
      <button type="button" onClick={handleConfirm} disabled={isSubmitting}>
        {isSubmitting ? "送信中..." : "注文を確定する"}
      </button>
    </>
  );
}
```

ここで ref が許容されるのは、**イベントハンドラには「effect 再実行インスタンスの区別」という問題が存在しないから**。ケースAで ref が壊れた理由がここでは発生しない。

なお、連打による二重遷移（同じ URL を 2 回 push すると history エントリが 2 つ積まれ、戻る 1 回では戻れない）は別問題で、`useState` + `disabled` で塞ぐ。ref フラグは不要。

### ケースC: React Router Data mode に任せる

`packages/react-router/lib/router/router.ts` を確認すると、ナビゲーションごとに `pendingNavigationController = new AbortController()` を生成し、割り込み時に `interruptActiveLoads()` → `pendingNavigationController.abort()` で in-flight の loader / action を中断している。

```tsx
// routes/order-confirm.tsx
import { Form, redirect, useNavigation, type ActionFunctionArgs } from "react-router";
import { createOrder } from "../api/orders";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const order = await createOrder(
    { cartId: String(formData.get("cartId")) },
    { signal: request.signal }, // 割り込み時にルーターが abort する
  );
  return redirect(`/orders/${order.id}`);
}

export default function OrderConfirmPage({ cartId }: { cartId: string }) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Form method="post">
      <input type="hidden" name="cartId" value={cartId} />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "送信中..." : "注文を確定する"}
      </button>
    </Form>
  );
}
```

送信中にユーザーが戻ると、ルーターがそのナビゲーションを割り込み扱いにして action を abort し、`redirect()` の結果は破棄される。**アプリ側のガードコードはゼロ**。

## まとめ

| 状況 | ガードは必要か | 何を使うか |
|---|---|---|
| `useEffect` 内 GET → 遷移 | 必要（ref は不可） | `AbortController` / `ignore` closure 変数 + cleanup |
| ボタン押下 → POST → 遷移（TanStack Query） | 不要（仕組み済み） | `mutate(vars, { onSuccess })` に遷移を置く |
| ボタン押下 → POST → 遷移（素の fetch） | 必要 | `isMounted` ref は妥当（+ `disabled` で連打対策） |
| React Router Data mode | 不要 | `<Form>` + action で `redirect()` |

**「ref ガードは必須ではないが、ガード自体は必要」。** `useEffect` 側では ref は誤りで cleanup による closure / abort が正解、イベントハンドラ側では ref も妥当だが、ライブラリ（TanStack Query の mutate コールバック、React Router の action）が同じ保証を既に提供しているので、まずそちらを使うのが筋。

判断の軸は「マウント状態を見るかどうか」ではなく、**「キャンセルしたいのか（GET）、結果は活かしたいが遷移だけ抑制したいのか（POST）」**。

## 参考

- [useEffect – React](https://react.dev/reference/react/useEffect) — `ignore` 変数を cleanup で `true` にしてレースコンディションを防ぐ公式パターン
- [You Might Not Need an Effect – React](https://react.dev/learn/you-might-not-need-an-effect) — Effect でのデータ取得には cleanup が必要
- [Mutations | TanStack Query React Docs](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) — `mutate` に渡したコールバックは unmount 後は実行されない
- [Mastering Mutations in React Query – TkDodo](https://tkdodo.eu/blog/mastering-mutations-in-react-query#some-callbacks-might-not-fire) — invalidation は `useMutation` 側、リダイレクト/トーストは `mutate` 側という分離
- [TanStack/query discussion #4804](https://github.com/TanStack/query/discussions/4804) — unmount 直前に開始した mutation ではコールバックが発火しうる
- [TanStack/query discussion #5133](https://github.com/TanStack/query/discussions/5133) — `mutateAsync` ではライフサイクル連動の保護が効かない
- [facebook/react#22114](https://github.com/facebook/react/pull/22114) — unmount 後 setState 警告の削除（Dan Abramov）
- react-router `packages/react-router/lib/hooks.tsx` — `useNavigateUnstable` / `useNavigateStable` の `activeRef`
- react-router `packages/react-router/lib/router/router.ts` — `pendingNavigationController` と `interruptActiveLoads()`
- next.js `packages/next/src/client/components/navigation.ts` — `useRouter` の実装
