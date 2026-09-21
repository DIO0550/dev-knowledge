---
title: TypeScriptで共通部分を持つ型を組む — `&`合成 / `interface extends` / ジェネリクスの使い分け
tags: [typescript, intersection-type, interface, extends, generics, discriminated-union, type-design, tsc-performance]
---

## TL;DR

- `Base & { ... }` による合成は、Rustの「共通structの埋め込み」に相当する正しい手。ジェネリクスとは答える質問が違う。
- **単純な形状の継承なら `interface Foo extends Base`**。TypeScript公式Wikiが `&` より推奨（衝突をエラーとして検出する／型チェックが速い／表示が良い）。`&` は衝突時に黙って `never` になる。
- **判別が要るなら `type Event = Base & (A | B | C)`**。`&` はユニオンに分配されるので共通部分を一度だけ書ける。これは `type` にしかできない。
- ジェネリクス `Entity<T> = Base & { body: T }` は、固有部分を**呼び出し側が渡す**ときだけ。自分で列挙できるなら不要。

## このドキュメントの射程

- 共通プロパティ（`id`, `createdAt` …）を持つ型が数種類あるときの表現方法。
- 対象外：条件型・mapped typeの詳細、`type` vs `interface` の宣言マージや `Record` 互換性の話。

## 原因

`&`（交差型）と `interface extends` は同じ合成を表せるが、コンパイラの扱いが違う。公式Wiki（Performance）によれば、interfaceは単一のフラットなオブジェクト型を作りプロパティの衝突を検出するのに対し、交差型はプロパティを再帰的にマージするだけで、場合によっては `never` を生む。interfaceは表示も一貫して良く、型の関係がキャッシュされるが、交差型はキャッシュされない。このため、交差型を作るよりinterface/extendsによる拡張が推奨されている。

一方でユニオンを含む型は `interface` では表現できず、`&` がユニオンに分配される性質（`Base & (A | B)` ≡ `(Base & A) | (Base & B)`）は `type` にしかない。

ジェネリクスは別の問題を解く道具で、「固有部分の型を宣言時に決められない（呼び出し側が渡す）」ときに使う。自分で3種類列挙できるのに `Entity<T>` にすると、`Entity<A> | Entity<B> | Entity<C>` のように結局列挙することになり、`T` を経由した意味がなくなる。

## 解決

```ts
type Base = { id: string; createdAt: Date };

// ✅ 形状の継承だけ → interface extends（衝突を即エラーにできる）
interface Foo extends Base { a: A; b: B; c: C }

// ❌ & は衝突時に黙って never になる
type X = { id: string } & { id: number };   // id: never。値を作った時点で初めて気づく
interface Y extends Base { id: number }     // ここで即エラー

// ✅ 判別が要る → Base & 判別可能ユニオン（& はユニオンに分配される）
type Event = Base & (
  | { kind: 'text';   body: string }
  | { kind: 'count';  n: number }
  | { kind: 'coords'; x: number; y: number }
);

function handle(e: Event) {
  e.id;                    // Base 側は narrowing 不要
  switch (e.kind) {        // default は書かない（網羅性チェックを活かす）
    case 'text':   return e.body;
    case 'count':  return String(e.n);
    case 'coords': return `${e.x},${e.y}`;
  }
}

// ✅ 呼び出し側が固有部分を渡す → ジェネリクス（穴が1つ、中は見ない）
type Entity<T> = Base & { body: T };
function unwrap<T>(e: Entity<T>): T { return e.body; }

// ❌ 自分で列挙できるのに T を経由
type Events = Entity<TextBody> | Entity<CountBody> | Entity<CoordsBody>;  // 上の Event でよい
```

`Base` 自体は `interface` で定義しておき、ユニオンが要る場面だけ `type` で `&` する、が安全。`interface` を `&` の材料にすることは問題ない。

| 状況 | 書き方 |
|---|---|
| 共通＋固有、種類は列挙できる、ユニオン不要 | `interface Foo extends Base { … }` |
| 共通＋固有、種類を判別したい | `type Event = Base & ({kind:'a'…} \| {kind:'b'…})` |
| 固有部分を呼び出し側が渡す | `type Entity<T> = Base & { body: T }` |

## まとめ

- `&` 合成は正しい。ただし形状継承だけなら `interface extends` が公式推奨。
- 判別が要るときは `Base & (ユニオン)` で共通部分を一度だけ書く。
- ジェネリクスは「呼び出し側が型を決める」ときだけ。

## 参考

- microsoft/TypeScript Wiki, Performance — Preferring Interfaces Over Intersections — https://github.com/microsoft/TypeScript/wiki/Performance
- microsoft/TypeScript PR #37762（衝突する交差型を `never` に縮約し、理由を診断に表示） — https://github.com/microsoft/TypeScript/pull/37762
- mkosir/typescript-style-guide, Discriminated Union — https://mkosir.github.io/typescript-style-guide
- WorkWave RouteManager UI coding patterns — Prefer discriminated unions over optional keys — https://dev.to/noriste/routemanager-ui-coding-patterns-typescript-42hb
