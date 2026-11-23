---
title: 同一 API リクエストの重複排除（in-flight dedup）は useRef ではなくモジュールスコープの Map で管理する
tags: [react, typescript, use-ref, anti-pattern, request-deduplication, in-flight, swr, tanstack-query, module-scope, fetch, custom-hooks]
---

## TL;DR

- 「複数コンポーネントから同じ API を同時に叩いたら 1 本にまとめたい」という重複排除（dedup）要件で、コンポーネントの `useRef` に進行中 Promise（in-flight Promise）を持つのは設計上誤り。
- 重複排除の所有者はアプリ全体なので、モジュールスコープの `Map` で持つのが正攻法。SWR / TanStack Query の内部実装も同じ設計。
- 自前で書くより、実プロダクトでは TanStack Query や SWR を使う。

## 遭遇した問題

複数のコンポーネントが同じ API を叩く構成で、ネットワークリクエストを 1 本にまとめたい。AI や既存コードがコンポーネントの `useRef` で進行中 Promise を保持する実装を提案してくる:

```ts
function useUserProfile(userId: string) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const inflightRef = useRef<Promise<UserProfile> | null>(null);

  useEffect(() => {
    if (inflightRef.current) {
      inflightRef.current.then(setProfile);
      return;
    }
    inflightRef.current = fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .finally(() => { inflightRef.current = null; });
    inflightRef.current.then(setProfile);
  }, [userId]);

  return profile;
}
```

これだと別コンポーネントが同じ `userId` で `useUserProfile` を呼んでも、それぞれのコンポーネントに `ref` があるため別リクエストが走る。重複排除が効かない。

## 原因

重複排除の所有者を取り違えている。「**アプリ全体で同一キーに対する進行中 Promise は 1 本**」が実現したい状態だから、所有者はモジュール / アプリレベルであるべき。コンポーネントの `ref` はコンポーネントインスタンスごとに別物なので、コンポーネントを跨いだ共有が原理的にできない。

「React で再レンダーを起こさない可変値 = `useRef`」という連想が強すぎて、React の hook に閉じ込めること自体が間違いだと気付きにくい。素の JavaScript のモジュールトップレベルに置けばいいだけ。

## 解決

モジュールスコープの `Map` で進行中 Promise を管理する。SWR の公式実装でも応答キャッシュと進行中 Promise キャッシュの両方をモジュールスコープに持っており、TanStack Query も `QueryClient` というアプリレベルのシングルトンが `QueryCache` を持つ設計。これが主要ライブラリ共通の正攻法。

```ts
// userProfileClient.ts ← 純粋な JavaScript モジュール、React と無関係
const inflight = new Map<string, Promise<UserProfile>>();

export function fetchUserProfile(userId: string): Promise<UserProfile> {
  const existing = inflight.get(userId);
  if (existing) return existing;

  const promise = fetch(`/api/users/${userId}`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch user ${userId}`);
      return res.json() as Promise<UserProfile>;
    })
    .finally(() => {
      inflight.delete(userId);
    });

  inflight.set(userId, promise);
  return promise;
}
```

```ts
// useUserProfile.ts ← 重複排除のことを知らない素直な hook
export function useUserProfile(userId: string) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let ignore = false;
    fetchUserProfile(userId).then((data) => {
      if (!ignore) setProfile(data);
    });
    return () => { ignore = true; };
  }, [userId]);

  return profile;
}
```

利点:

- `fetchUserProfile` は純粋な JS 関数。React テストランナーに頼らず単体テストできる
- 重複排除の責務が hook から分離されているので hook が薄い
- 複数コンポーネントが同じ `userId` で呼んでもネットワークリクエストは 1 本
- 完了後 `inflight.delete` で次のリクエストは正常に走る

応答キャッシュ（新鮮なデータの再利用）や stale 管理まで足すと TanStack Query の再発明になるので、実プロダクトではライブラリを使う。

## まとめ

「同じリクエストの共有」はアプリレベルの状態。所有者をモジュールに置けば、`useRef` を使う理由はそもそも消える。

## 参考

- [SWR — Vercel](https://swr.vercel.app/)
- [swrv (in-flight promise cacheの明文化)](https://www.npmjs.com/package/swrv)
- [TanStack Query — Overview](https://tanstack.com/query/latest/docs/framework/react/overview)
- [How SWR works behind the scenes — Julian Garamendy](https://juliangaramendy.dev/blog/how-swr-works)