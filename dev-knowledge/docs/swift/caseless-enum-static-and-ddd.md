---
title: Swift の caseless enum + static でまとめるのは DDD 違反か（使ってよいが多用は禁物）
tags: [swift, enum, caseless-enum, static-method, ddd, domain-driven-design, anemic-domain-model, design, ios, testability]
---

## TL;DR

- caseless enum + static は **Swift コアチームや SwiftLint も推奨する慣用的な名前空間パターン**。それ自体は DDD 違反ではない。
- DDD で問題視されるのは「状態を持つが振る舞いを持たない」**anemic domain model**。論点は「中身が何か」であって、enum/static という構文ではない。
- ❌ エンティティが持つべきビジネスロジック・不変条件を static に切り出す → anemic 化のサイン。
- ⭕ ステートレスな純粋関数・定数・名前空間でだけ使う → 問題なし。
- 結論：**使ってよいが多用は良くない**。デフォルトは「データを持つ型のメソッド」、static 名前空間は所有者の型が存在しない時の例外と捉える。

## このドキュメントの射程

「Swift で enum に static 関数をまとめるのは、ドメイン駆動設計（DDD）から外れるから良くないのか？」という問いに対する設計判断の整理。さらに「使うこと自体は問題ないが、多用は良くない」という立場の妥当性も扱う。

## 背景・原因

混乱は「構文（enum + static）」と「設計上のアンチパターン（anemic model）」を同一視することから生まれる。実際には別のレイヤーの話。

- **Swift 側の事実**：状態を持たない定数・ユーティリティ・名前空間をまとめる用途では、caseless enum + static はインスタンス化を防げるため推奨される。Apple 自身も `Combine.Publishers` などで採用。SwiftLint の `convenience_type` ルールも「static メンバーのホスティングだけに使う型は caseless enum で実装すべき」としている。
- **DDD 側の事実**：アンチパターンとされる anemic domain model とは「状態を持つが振る舞いを持たない**ドメインエンティティ**」を指す。Tell, Don't Ask に反し、オブジェクトが自身の状態を操作できず外部から常に操作される状態が問題の本質。
- つまり「enum + static にしたこと」ではなく、「**エンティティに属すべき振る舞いを外に出していないか**」だけが DDD 上の論点。
- 補足：関数型アプローチで DDD を行う場合、不変データ + それを操作する関数という形になるため anemic は許容される。値型中心の現代 Swift とも親和性がある。

### 多用が良くない理由

「使えるが多用は禁物」が現実的な落とし所。多用が問題になるのは次の理由による。

1. **手続き型・anemic への逆戻り**：何でも `Utils` / `Helper` に切り出すと、本来その型が持つべき振る舞いまで流出し、データと振る舞いが分離していく。
2. **テスタビリティと DI の阻害**：static 関数は protocol で抽象化・差し替えができず、呼び出し側に隠れた依存（hidden dependency）が生まれる。mock を注入できずユニットテストが書きにくい。
3. **設計の「逃げ」のサイン**：static にしたくなった時、多くはその引数の型のメソッドにした方が責務が収まる（`Calculator.area(of: rect)` より `rect.area`）。

## 解決（設計指針）

- **デフォルト**：振る舞いは、データを持つ型（struct / enum / entity）のメソッドとして置く。
- **例外として static 名前空間を使う**：本当にステートレスで、所有者となる型が存在しないもの（定数・純粋なフォーマッタ・数学関数など）。
- 判断のヒューリスティック：「これは**誰の**振る舞いか？」と問い、答えが出るならその型に寄せる。出ないなら static 名前空間で可。

```swift
// ❌ 良くない例：User が持つべき不変条件を static helper に流出（anemic 化）
struct User {
    var name: String
}
enum UserHelper {
    static func validate(_ user: User) -> Bool {
        user.name.count > 1
    }
}

// ⭕ 良い例：振る舞いは所有者である型に置く
struct User {
    private(set) var name: String
    enum ValidationError: Error { case nameTooShort }

    mutating func rename(to newName: String) throws {
        guard newName.count > 1 else { throw ValidationError.nameTooShort }
        name = newName
    }
}

// ⭕ 問題ない例：所有者の型が無いステートレスな名前空間・定数
enum AppConfig {
    static let apiBaseURL = URL(string: "https://api.example.com")!
    static let timeout: TimeInterval = 30
}
```

## まとめ・参考

- 「enum + static でまとめること自体」は DDD 違反ではなく、Swift では推奨される名前空間パターン。問題は「ドメインエンティティの振る舞いを外に出していないか」だけ。使ってよいが、多用は anemic 化・テスト困難の兆候なので避ける。
- 参考: SwiftLint `convenience_type` ルール / Swift by Sundell「powerful ways to use Swift enums」/ DevIQ・Marko Engelman の anemic vs rich domain model 解説。
