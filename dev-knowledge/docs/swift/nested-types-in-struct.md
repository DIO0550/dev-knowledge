---
title: Swift のネスト型（struct の中の enum / struct）の挙動と注意点
tags: [swift, nested-types, struct, enum, namespace, generics, access-control, Codable, value-semantics, memory-layout]
---

## TL;DR

- struct の中に宣言した enum / struct は「ネスト型」。外側の型は**名前空間として働くだけ**で、インスタンス同士の結びつきはない（Java の static nested class に近い）。
- 型を宣言しただけでは外側の struct のサイズは変わらない。その型の**ストアドプロパティを持ったときだけ**インラインで埋め込まれる。
- ネスト型から外側の**インスタンスメンバーは参照できない**。static メンバーは参照できる。
- ジェネリック型の中のネスト型は外側の型パラメータを使える（`Box<Int>.State` と `Box<String>.State` は別型）。ただし static stored property は定義できない。
- struct 内 struct で外側の struct を直接持つと値型の再帰でコンパイルエラー（Optional でも不可）。Array・class・`indirect enum` で回避する。
- Apple のフレームワーク（`String.Index`、`Dictionary.Keys`、Combine の `Subscribers` など）でも多用される、Swift の標準的な整理手法。

## このドキュメントの射程

- Swift で struct の中に enum / struct を宣言した場合の、言語仕様上の挙動・制約・ハマりどころを整理する。
- case なし enum を名前空間として使うパターンそのもの（およびその使いすぎの問題）は別記事（[case なし enum と static メソッド](./design/caseless-enum-static-and-ddd.md)）で扱っているため、ここでは「ネスト型一般の挙動」に絞る。
- 対象: Swift 5.10 以降 / Swift 6（protocol のネストは 5.10 から）。

## 原因（なぜそう振る舞うか）

- Swift には `namespace` キーワードがなく、言語レベルの名前空間はモジュール単位のみ。型のネストは「型の名前にスコープを与える」仕組みであり、実行時の関係（外側インスタンスへの参照など）は一切持たない。
- そのため:
  - 外側の `self` を暗黙に持たない → 外側のインスタンスメンバーは参照不可
  - 型宣言はストレージを持たない → `MemoryLayout` に影響しない
  - ネスト型の値をプロパティとして持てば、通常の値型と同じく外側の struct にインライン展開・値コピーされる
- 値型（struct）はサイズがコンパイル時に確定している必要があるため、自分自身を（Optional 経由でも）含むと無限サイズになりエラーになる。enum は `indirect` でボックス化できるが、struct にはその手段がない。

## 解決（挙動と使い方）

### 1. 名前空間になるだけでサイズは変わらない

```swift
struct Request {
    enum Method { case get, post }
    var url: String
}

let m: Request.Method = .get        // 外からはフルネーム
MemoryLayout<Request>.size          // 16（String 分のみ。Method の宣言は影響しない）
```

外側の型の内部では `Method` と短く書け、`.get` のような省略記法も効く。

### 2. 外側のインスタンスにはアクセスできない

```swift
struct Outer {
    var count = 0
    static let limit = 10

    enum Inner {
        static func check() -> Int {
            // count  // ❌ Instance member 'count' of type 'Outer' cannot be used on instance of nested type 'Outer.Inner'
            return limit  // ✅ static は参照可（Outer.limit と書くと意図が明確）
        }
    }
}
```

外側の値が必要なら引数で渡すか、外側の型のメソッドとして書く。

### 3. ジェネリック型の中のネスト型

```swift
struct Box<T> {
    enum State {
        case empty
        case filled(T)   // 外側の T を使える
    }
    var state: State
    // static let cache = 0  // ❌ Static stored properties not supported in generic types（ネスト型の中でも同様）
}

let s: Box<Int>.State = .filled(42)  // Box<String>.State とは別の型
```

### 4. struct の中の struct と値型の再帰

```swift
struct Node {
    struct Child {
        // var parent: Node?   // ❌ Value type 'Node' cannot have a stored property that recursively contains it
        var parents: [Node]    // ✅ Array は要素をヒープに持つのでサイズが確定する
    }
    var child: Child?
}

// enum なら indirect でボックス化できる
struct Tree {
    enum Child {
        case leaf
        indirect case node(Tree)
    }
    var child: Child
}
```

ネスト struct 型のプロパティは外側にフラットに埋め込まれる（ポインタ経由にならない）。

```swift
struct Outer {
    struct Point { var x: Double; var y: Double }
    var p: Point
    var flag: Bool
}
MemoryLayout<Outer>.size  // 17（Double×2 + Bool）
```

### 5. アクセス制御

```swift
public struct Config {
    private enum Key: String { case timeout, retry }  // Config の宣言内と同一ファイルの extension からのみ見える
    public enum Mode { case debug, release }
}
```

- ネスト型のデフォルトは `internal`。実際に見える範囲は外側の型のアクセスレベルで頭打ちになる。
- ネスト struct にもメンバーワイズ init が生成されるが、型やプロパティが `private` ならそれに従う。`public struct` のメンバーワイズ init は `internal` のままなので、外部公開するなら `public init` を自分で書く。

### 6. extension で後からネスト・拡張できる

```swift
struct User { var name: String }

extension User {
    enum Role { case admin, member }      // 後付けでネスト型を追加
}
extension User.Role {                     // ネスト型自体も拡張可能
    var label: String { self == .admin ? "管理者" : "メンバー" }
}
```

### 7. 代表的な使いどころ

```swift
// Codable: コンパイラは CodingKeys という名前のネスト enum を探して使う
struct Article: Codable {
    var title: String
    var createdAt: Date
    private enum CodingKeys: String, CodingKey {
        case title
        case createdAt = "created_at"
    }
}

// JSON のネスト構造をそのままモデル化（Profile という汎用名でも衝突しない）
struct UserResponse: Codable {
    struct Profile: Codable { var bio: String }
    var id: Int
    var profile: Profile
}
```

標準ライブラリ・Apple フレームワークでの例: `String.Index`、`String.UTF8View`、`Dictionary.Keys`、`Date.FormatStyle`（struct 内 struct）、`URLRequest.CachePolicy`（型内 enum）、Combine の `Subscribers` / `Publishers`（case なし enum の名前空間）。

### 8. ハマりどころ

- **標準型のシャドウイング**: ネストで `Result` や `Error` を定義すると、外側の型の内部ではそちらが優先される。標準の方は `Swift.Result` / `Swift.Error` と書く。

  ```swift
  struct API {
      enum Result { case ok, ng }
      func fetch() -> Swift.Result<Data, Swift.Error> { fatalError() }
  }
  ```

- **protocol のネスト**: Swift 5.10（SE-0404）から非ジェネリックな型の中に protocol を宣言できる。それ以前は不可。protocol の中にネスト型を宣言することは現在も不可。
- **Sendable（Swift 6）**: 非 public のネスト enum / struct は、メンバー（associated value / stored property）がすべて Sendable なら暗黙的に Sendable。public の場合は明示的に `: Sendable` が必要。

### 使い分けの目安

- 外側の型の文脈でしか意味を持たない型（API レスポンスの一部、設定値のグループ、内部キャッシュ、CodingKeys）→ ネストする。
- 複数の型から共有する型（`User` と `Company` の両方が持つ `Address` など）→ トップレベルに置く。ネストすると `User.Address` を `Company` から参照する不自然な依存になる。
- ネストは 2〜3 階層程度までに抑える（呼び出しが長くなり、補完での発見性も下がる）。

## まとめ

- Swift のネスト型は「名前にスコープを付けるだけ」の仕組みで、外側インスタンスとの実行時の関係もメモリコストもない。値型の再帰・ジェネリック型内の static stored property・標準型のシャドウイングに注意すれば、型を整理する標準的な手段として積極的に使ってよい。

## 参考

- The Swift Programming Language — Nested Types: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/nestedtypes/
- SE-0404 Allow Protocols to be Nested in Non-Generic Contexts: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0404-nested-protocols.md
- SE-0491 Module selectors for name disambiguation: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0491-module-selectors.md
- Combine `Subscribers`（enum による名前空間の例）: https://developer.apple.com/documentation/combine/subscribers
- Swift Forums — Namespacing: https://forums.swift.org/t/namespacing/33675
- 関連記事: [case なし enum による名前空間パターンと貧血ドメインモデルの懸念](./design/caseless-enum-static-and-ddd.md)
