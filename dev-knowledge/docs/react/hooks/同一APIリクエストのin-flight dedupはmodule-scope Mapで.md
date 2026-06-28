---
title: "React: 同一APIリクエストのin-flight dedupはuseRefではなくmodule-scope Mapで"
tags: [react, typescript, useref, anti-pattern, request-deduplication, in-flight, swr, tanstack-query, module-scope, fetch, custom-hook]
---

## TL;DR

- 「複数componentから同じAPIを同時に叩いたら1本にまとめたい」というdedup要件で、componentの `useRef` にin-flight promiseを持つのはアーキ的に間違い。
- dedupの所有者はアプリ全体なので、module-scopeの `Map` で持つのが正攻法。SWR / TanStack Query の内部実装も同じ設計。
- 自前で書くより、実プロダクトではTanStack QueryやSWRを使う。

## 遭遇した問題

複数のcomponentが同じAPIを叩く構成で、ネットワークリクエストを1本にまとめたい。AIや既存コードがcomponentの `useRef` でin-flight promiseを保持する実装を提案してくる:

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

これだと別componentが同じuserIdで `useUserProfile` を呼んでも、それぞれのcomponentにrefがあるため別リクエストが走る。dedupが効かない。

## 原因

dedupの所有者を取り違えている。「**アプリ全体で同一keyに対するin-flight promiseは1本**」が実現したい状態だから、所有者はモジュール / アプリレベルであるべき。componentのrefはcomponentインスタンスごとに別物なので、componentを跨いだ共有が原理的にできない。

「Reactでrender-triggeringしないmutableな値 = useRef」というパターンマッチが強すぎて、Reactのhookに閉じ込めること自体が間違いだと気付きにくい。素のJavaScriptのmodule top-levelに置けばいいだけ。

## 解決

module-scopeの `Map` でin-flight promiseを管理する。SWRの公式実装でもfetcher応答cacheとin-flight promise cacheの両方をmodule-scopeに持っており、TanStack Queryも `QueryClient` というアプリレベルのシングルトンが `QueryCache` を持つ設計。これがメジャーライブラリ共通の正攻法。

```ts
// userProfileClient.ts ← 純粋なJavaScriptモジュール、Reactと無関係
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
// useUserProfile.ts ← dedupのことを知らない素直なhook
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

- `fetchUserProfile` は純粋なJS関数。Reactテストランナーに頼らず単体テストできる
- dedup責務がhookから分離されているのでhookが薄い
- 複数componentが同じuserIdで呼んでもネットワークリクエストは1本
- 完了後 `inflight.delete` で次のリクエストは正常に走る

cache(fresh data再利用)やstale管理まで足すとTanStack Queryの再発明になるので、実プロダクトではライブラリを使う。

## まとめ

「同じリクエストの共有」はアプリレベルの状態。所有者をモジュールに置けば、useRefに行く理由はそもそも消える。

## 参考

- [SWR — Vercel](https://swr.vercel.app/)
- [swrv (in-flight promise cacheの明文化)](https://www.npmjs.com/package/swrv)
- [TanStack Query — Overview](https://tanstack.com/query/latest/docs/framework/react/overview)
- [How SWR works behind the scenes — Julian Garamendy](https://juliangaramendy.dev/blog/how-swr-works)
