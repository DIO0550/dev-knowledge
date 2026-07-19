---
title: DTO の型名に `Dto` サフィックスを付けるべきか
tags: [naming-convention, dto, architecture, typescript, java, dotnet, nestjs, ddd, cqrs, hexagonal-architecture]
---

## TL;DR

- 「`Dto` を付ける」習慣は **エコシステム依存** で、一律に「一般的」とは言えない。
- **付けるのが標準**：NestJS、Spring/Java、OSGi Core 仕様、Prisma NestJS DTO ジェネレータのような **フレームワーク／規約が命名を前提にしている領域**。
- **付けないのが推奨**：Ben Abt (.NET)、Ted M. Young (Java/Hexagonal)、Kevlin Henney、Ardalis らの **設計論寄りの識者**。彼らは `Dto` を「パターン名を型名に貼るのは冗長」と見る。
- 反サフィックス派の代替案は収束していて、**役割ベース命名**（`CreateUserRequest` / `UserView` / `TransferMoneyCommand` / `MoneyWasSent`）に置き換える。
- 判断軸は 3 つ：(1) エコシステムの慣例に従うか (2) 転送の役割が名前で明確化できるか (3) プロジェクト規模での視覚的ノイズ。

## このドキュメントの射程

TypeScript/Java/.NET を中心に「DTO の型名に `Dto`（または `DTO`）サフィックスを付ける慣行がどの程度一般的か」を、英語・日本語両コミュニティを横断して調査した結果をまとめる。フレームワーク固有の事情と、設計論的な原理原則が分かれる典型例なので、**どちらが正しいか** ではなく **どのレイヤーの議論か** を切り分けることを目的とする。

## 「付ける」派が支配的な領域

### NestJS エコシステム

事実上のデファクト。公式ドキュメント・チュートリアル・記事のほぼ全てが `CreateUserDto`, `UpdateUserDto`, `ResponseUserDto` の形式を採用している。ランタイムリフレクションのため DTO はクラスで表現される必要があり、フレームワーク自体が `Dto` 命名を前提にしている面もある。

コード生成の世界でも固定化していて、Prisma NestJS DTO ジェネレータのデフォルト設定は以下：

```ts
// prisma-generator-nestjs-dto のデフォルト設定
generator nestjsDto {
  createDtoPrefix = "Create"
  updateDtoPrefix = "Update"
  dtoSuffix       = "Dto"
  // → CreateUserDto, UpdateUserDto, UserDto が自動生成される
}
```

### Java / Spring 系

日本の実務教材でも「DTO の命名規則：ファイル名は Dto または Bean で終える。例：`UserDto`, `UserBean`」と明記される慣行。JPA Buddy（IntelliJ プラグイン）は `(?.*)Dto` の正規表現で `MyEntityDto` と `MyEntity` を自動関連付けする機能を持つほど、命名規則としてツールに組み込まれている。

### OSGi Core 仕様

最も形式化されていて、`org.osgi.service.foo.Widget` に対する DTO は完全修飾名で `org.osgi.service.foo.dto.WidgetDTO` と規定されている。パッケージ名末尾に `.dto`、型名末尾に `DTO`。

## 「付けない」派の主張

### Ben Abt (.NET, Medialesson)

> DTO はアンブレラ・タームであり設計パターンだが、ソフトウェア設計の名前として "DTO" が現れることはない。

```csharp
// Don't do this!
public class MySettingsDTO { ... }

// Do this!
public class ApplicationSettings { ... }
```

### Ted M. Young（Java, Hexagonal Architecture）

もう `Dto` サフィックスは付けない、他に良い名前が思いつかない時だけ使う、という方針転換。用途に応じて型名を分ける：

```java
// ブラウザ表示用（Query 側の結果）
public record MemberView(String id, String firstName, ...) { }

// HTTP リクエスト用（Command 側の入力）
public record CreateMemberRequest(...) { }

// DB 永続化オブジェクト（別軸のサフィックス Dbo を導入）
public record MemberDbo(...) { }
```

### Ardalis (Steve Smith)

中間的。「単に `Dto` を付けるのが分かりやすい。これで問題ないし最も基本的な表現には十分だが、より記述的な名前を使うべきケースも多い」。

### Kevlin Henney / Bertil Muth

パターン名をクラス名に付ける慣行そのものを疑う立場。`FooFactory`, `BarController`, `UserRepository` を、より語る名前 (`Users`, `ManageUsers`, `CreateProfile`) に置き換える実験。

## 反サフィックス派の代替解：役割ベース命名

面白いのは、反サフィックス派の代替案がほぼ収束していること。**転送の役割そのものを型名に埋め込む**：

| DTO の役割 | 型名の例 |
|---|---|
| HTTP リクエスト | `CreateUserRequest`, `UpdateUserRequest` |
| HTTP レスポンス | `UserResponse`, `UserView` |
| CQRS コマンド | `TransferMoney`, `RegisterUser` |
| CQRS クエリ | `FindUserById`, `ListActiveUsers` |
| ドメインイベント | `MoneyWasSent`, `UserRegistered`（過去形） |
| DB 永続化 | `UserDbo`, `MemberDbo`（Ted Young 方式） |

Andrew Cairns は CQRS の視点から、`TransferMoney` や `MoneyWasSent` を「役割で名前が語られている DTO」と整理していて、この視点だと `Dto` は意味的に冗長になる。

避けるべきサフィックスの共通見解：`Data`, `Info`, `Vo`（Value Object と混同、曖昧）。

## 判断軸

**(1) エコシステム順応**
NestJS / Spring / OSGi の中で書いているなら、周囲との一貫性 > 設計論。`Dto` を付けるのが正解。フレームワークがそれを前提にしていることもある。

**(2) 転送の役割が名前で明確化できるか**
役割が明確なら（HTTP リクエスト、コマンド、ビュー、イベント）役割名の方が優れる。「単にレイヤーを跨ぐデータ」以上の情報がない場合は `Dto` を付ける方が正直。

**(3) プロジェクト規模と視覚的ノイズ**
規模が大きくなるほど「全クラス名が Dto で終わる」ことが可読性を下げる。役割ベース命名の方がスケールする傾向。

## DDD / 関数型ドメインモデリング視点の補足

Hexagonal Architecture の文脈では **境界に置くもの** として DTO を明示する意義はあるが、その識別は「型名のサフィックス」より **モジュール境界と変換関数**（`toDomain` / `fromDomain`, `parse` / `serialize`）で表現する方が構造的。

Scott Wlaschin 的な関数型ドメインモデリングの世界だと、境界での DTO は基本的にプリミティブに近い形の record 型、ドメイン側は smart constructor 経由の branded type、という **型そのものの差** で区別する。この場合、名前で区別する必要性はさらに下がる：

```ts
// 境界（DTO 相当）
type UserApiPayload = {
  readonly id: string
  readonly email: string
}

// ドメイン
type User = {
  readonly id: UserId          // branded
  readonly email: EmailAddress // branded, smart constructor 経由
}

// 境界での変換関数がレイヤー分離を担う
const parseUser: (payload: UserApiPayload) => Result
const serializeUser: (user: User) => UserApiPayload
```

## まとめ

- `Dto` サフィックスは **一般的**というより **文化圏依存**。フレームワーク文化圏では標準、設計論文化圏では非推奨。
- 反サフィックス派が推すのは **役割ベース命名**（Request/Response/Command/Query/View/Event）。これは DTO を否定するのではなく「DTO の何であるか」を型名に埋め込む方針。
- 型システムでレイヤー分離できるなら、名前の区別への依存はさらに下がる。

## 参考

- Ben Abt, ".NET Naming Best Practises: DTOs" — https://medium.com/medialesson/net-naming-best-practises-dtos-f6b7961d823c
- Ted M. Young, "Naming Conventions for DTOs" — https://ted.dev/articles/2021/10/30/naming-conventions-for-dtos/
- Ardalis (Steve Smith), "5 Rules for DTOs" — https://ardalis.com/5-rules-dtos/
- Bertil Muth, "Time to abandon pattern name suffixes?" — https://dev.to/bertilmuth/time-to-abandon-pattern-name-suffixes-56f9
- OSGi Core 7 Specification, "57 Data Transfer Objects Specification" — https://docs.osgi.org/specification/osgi.core/7.0.0/framework.dto.html
- Java DTO Naming Conventions — https://www.javathinking.com/blog/java-data-transfer-object-naming-convention/
- Andrew Cairns, "Recognising Value Objects and DTOs" — https://acairns.substack.com/p/recognising-value-objects-and-dtos
- Understanding the Use of DTO Suffix in Java Classes — https://www.javagists.com/understanding-the-use-of-dto-suffix-in-java-classes
- NestJS DTOs guide — https://dev.to/cendekia/mastering-dtos-in-nestjs-24e4
- prisma-generator-nestjs-dto — https://github.com/chenxinhu/prisma-generator-nestjs-dto
- synergy-software, ".NET API best practices" — https://github.com/synergy-software/net-api-best-practices
