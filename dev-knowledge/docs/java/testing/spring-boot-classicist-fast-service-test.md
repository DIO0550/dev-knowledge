---
title: Spring Boot のサービスクラスを古典派スタイルで速くテストする
tags: [java, spring-boot, テスト, junit, mockito, 古典派, classicist, ソシアブルテスト, ユニットテスト, サービス層, testcontainers]
---

## TL;DR

- 「古典派スタイル（本物の依存を使う状態ベース検証）」と「テスト実行速度」はトレードオフではない。レイヤーを分ければ両立する。
- サービスクラスのテストで `@SpringBootTest` / `@Autowired` を使わない。Spring コンテキストを起動する構成にした時点でユニットテストではなく統合テストになり、桁違いに遅くなる。
- モック自体は古典派に反しない。分かれ目は「モックを相互作用検証（`verify`）に使うか、戻り値のスタブに留めるか」。古典派は後者。
- 検証はサービスの戻り値・状態で行い、`verify` は副作用（通知送信・削除など）だけに限定する。
- 純粋ロジックの自作依存はモックせず `new` で本物を注入する（ソシアブルテスト）。プロセス外依存（DB・外部 API）だけをダブルにする。
- 本物の DB でしか確認できない流れだけ、少数の Testcontainers 統合テストに隔離する。

## 遭遇した問題

- 環境: Java / Spring Boot 3 系（本記事は 2026-07 時点の現行 3.5 系を前提。管理依存は JUnit Jupiter 5.12 / Mockito 5.17）、`spring-boot-starter-test` 経由の JUnit 5 + Mockito。
- サービスクラスのテストを書くと実行がめちゃくちゃ遅い。特に `@SpringBootTest` を使うと 1 テストあたり数秒かかり、テストクラスが増えるほど積み上がる。
- 一方で「モックを多用する書き方は古典派（Classicist / Detroit 学派）のテスト観からすると微妙」という懸念もある。速度のためにモックを使うと、今度はテストが実装に密結合して壊れやすくなる。
- つまり「古典派スタイル（本物の依存・状態ベース検証）を採りたい」と「Spring やモックが絡んで遅い・脆い」が衝突している。サービスクラスはリポジトリや他サービスを束ねる調整役なので、この衝突が一番起きやすい層。

## 原因

- **速度**: `@SpringBootTest` はアプリケーション全体のコンテキスト（コンポーネントスキャン・Bean 初期化・自動設定・DB 接続・セキュリティ）をロードするため「full integration test」であり、ユニークなコンテキスト 1 つあたり数秒かかる。過剰に使うとテストスイートが長時間化すると Spring 公式も明記している。ポイントは「`@Autowired` を書いたから遅い」のではなく、「`@SpringBootTest` などでコンテキストを起動する構成にした時点で統合テストになり遅い」という因果である（`@Autowired` はコンテキスト起動を前提に DI するアノテーションにすぎない）。
- **脆さ**: 古典派（Detroit / Classicist）は状態ベース検証を重視し、ロンドン派（Mockist / London）は依存をモックして相互作用を検証する。ロンドン派の `verify(repo).save(x)` 型の検証は、サービスの内部実装（どのメソッドをどう呼ぶか）に密結合するため、機能が正しくてもリファクタで壊れる（Fowler 曰く "Mockist tests are thus more coupled to the implementation of a method"）。
  - なお Fowler は「状態検証 vs 振る舞い検証」と「古典派 vs モック派」を直交する 2 軸として整理している。実務的には「古典派＝本物 or スタブ＋状態検証」「モック派＝モック＋`verify`」と対応づけて差し支えない。
- サービスクラスは「オーケストレーション層」に寄っていて状態で検証しづらいため、安易にすべてをモック + `verify` で書きがちになり、上記の脆さを招く。

## 解決

方針は「Spring は起動しない」「モックは戻り値スタブに留める」「本物にできる依存は本物にする」の 3 点。

### 1. Spring を起動せず Mockito だけでテストする（速度）

`@SpringBootTest` / `@Autowired` を使わず、`@ExtendWith(MockitoExtension.class)` で組み立てる。`MockitoExtension` は Spring コンテナを一切起動しない純粋な JUnit 5 拡張なので、コンテキスト起動コストがゼロになりミリ秒で終わる。

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock OrderRepository orderRepository;   // プロセス外依存はモック
    @InjectMocks OrderService orderService;

    @Test
    void calculates_total_with_discount() {
        // 戻り値だけスタブする
        when(orderRepository.findById(1L))
            .thenReturn(Optional.of(new Order(1L, 1000)));

        Order result = orderService.applyDiscount(1L, 10);

        // 状態で検証（古典派的）— verify は使わない
        assertEquals(900, result.getTotal());
    }
}
```

> 注意: 呼び出す依存をスタブし忘れると、モックのデフォルト戻り値（`null` 等）で `NullPointerException` になる。必要な戻り値は `when(...)` で明示する。JUnit 5 では JUnit 4 の `@RunWith(MockitoJUnitRunner.class)` ではなく `@ExtendWith(MockitoExtension.class)` を使う。

### 2. verify ではなく戻り値・状態で検証する（古典派を守る）

モックを使うこと自体は古典派に反しない。Fowler も「古典派は可能なら本物、面倒ならダブルを使う」と述べており、分かれ目は使い方にある。

```java
// ❌ ロンドン派的: 内部実装に密結合。リファクタで壊れやすい
verify(orderRepository).save(order);

// ✅ 古典派的: リポジトリの戻り値をスタブし、サービスの結果を state で検証
when(orderRepository.findById(1L)).thenReturn(Optional.of(order));
Order result = orderService.applyDiscount(1L, 10);
assertEquals(900, result.getTotal());
```

`verify` は、戻り値では確認できない副作用（通知の送信、削除の実行など）を検証したいときだけに限定する。

### 3. 純粋ロジックの依存は本物を注入する（ソシアブルテスト）

モックしなくていい自作ロジッククラスはモックせず本物を使う（本物の協調オブジェクトを使うテストが「sociable test」）。プロセス外依存（DB・API）だけをダブルにする。コンストラクタ注入で設計しておくと、Spring コンテナなしでモックを引数に渡すだけで手動組み立てできる。

```java
class OrderServiceTest {
    OrderRepository orderRepository = mock(OrderRepository.class);  // 外部依存だけモック
    DiscountCalculator calculator = new DiscountCalculator();       // 純粋ロジックは本物

    OrderService orderService = new OrderService(orderRepository, calculator);
    // ...テスト対象とその依存が正しく協調しているかまで一度に検証できる
}
```

> Spring 公式は「一般にコンストラクタ注入を推奨」しており、その理由の一つとして「依存をモック/スタブに差し替えやすくテストが容易になる」ことを挙げている（フィールド注入は非推奨とまで公式が断言しているわけではないが、テスト容易性・イミュータビリティの観点でコンストラクタ注入が有利、というのは広く共有された指摘）。

### 4. 本物の DB が要る流れだけ Testcontainers に隔離する

「実際に保存して読み戻す」流れを本物で検証したいなら、それはユニットテストの領域を超えている。数を絞った統合テストとして切り出し、H2 のようなインメモリ代替（SQL 方言・型・制約の挙動が本番と乖離しやすい）ではなく Testcontainers で本番と同じ DB イメージを使う。

- `@DataJpaTest` はデフォルトで `DataSource` を組み込み DB に置き換えてしまうため、実 DB（Testcontainers 含む）に向けたい場合は `@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)` で置換を無効化する。
- Spring Boot 3.1 以降なら、コンテナのフィールドに `@ServiceConnection` を付けるだけで接続設定が自動生成され、`@DynamicPropertySource` の手書きが不要になる（`spring-boot-testcontainers` 依存が必要）。

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class OrderRepositoryIntegrationTest {

    @Container
    @ServiceConnection  // Spring Boot 3.1+ : 接続設定を自動生成
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    // ...本物の DB でしか検証できない箇所だけをここに限定する
}
```

全メソッドではなく「本物の DB でしか検証できない箇所」だけに限定するのがコツ。

### レイヤー戦略（1 種類のテストで全部やろうとしない）

- 大半（ミリ秒・Spring なし・本物の依存）: 純粋ロジックとドメインオブジェクトをコンストラクタ注入した本物同士で状態検証。
- サービス層: Spring を起動せず Mockito or 手動組み立て。外部依存だけスタブ、検証は状態で。
- 中間（スライステスト）: Web 層は `@WebMvcTest`、永続化層は `@DataJpaTest`。全体起動より限定された自動設定だけをロードするので軽い。
- 少数（`@SpringBootTest` / Testcontainers）: 全体結線・E2E の確認だけ。同一構成ならコンテキストはキャッシュされ使い回される（`@MockitoBean` や `@DynamicPropertySource` など構成が変わるとキャッシュが効かず再ロードされる点に注意）。

## まとめ

サービスクラスは Spring を起動せず（Mockito or 手動組み立て）、モックは戻り値スタブに留め、検証は状態で、`verify` は副作用のみ、純粋ロジックの依存は本物注入。これで「古典派の頑健さ」と「ミリ秒の速度」を同時に得られる。

## 参考（調査した出典 / 参照日: 2026-07-07）

### 速度・Spring テスト構成

- Spring Boot Reference — Testing Spring Boot Applications（`@SpringBootTest` は完全コンテキスト、スライスは限定ロード、`@DataJpaTest`）: https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html
- Spring Framework Reference — Context Caching（同一構成でのコンテキスト再利用、キャッシュキー、既定 maxSize 32・LRU）: https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html
- Baeldung — Mockito and JUnit 5: Using ExtendWith（`MockitoExtension` は Spring コンテナを起動しない）: https://www.baeldung.com/mockito-junit-5-extension
- Spring Boot 3.5 Release Notes（管理依存: JUnit Jupiter 5.12 / Mockito 5.17）: https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.5-Release-Notes

### 古典派 vs ロンドン派・ソシアブルテスト

- Martin Fowler「Mocks Aren't Stubs」（状態/振る舞い検証、古典派/モック派、実装への密結合とリファクタ耐性、Detroit/London 呼称の出所）: https://martinfowler.com/articles/mocksArentStubs.html
- Martin Fowler「UnitTest」bliki（sociable/solitary の定義。用語は Jay Fields 考案、mockist=solitary / classicist=sociable）: https://martinfowler.com/bliki/UnitTest.html
- James Shore「Testing Without Mocks: A Pattern Language」（sociable tests + Nullables、プロセス外/インフラ依存だけを置換する実践）: https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks

### Testcontainers・DI

- Testcontainers Guide「The simplest way to replace H2 with a real database for testing」: https://testcontainers.com/guides/replace-h2-with-real-database-for-testing/
- Spring 公式ブログ「Improved Testcontainers Support in Spring Boot 3.1」（`@ServiceConnection` 導入、2023-06-23）: https://spring.io/blog/2023/06/23/improved-testcontainers-support-in-spring-boot-3-1/
- Spring Framework Reference — Constructor-based Dependency Injection（「Spring team generally advocates constructor injection」、テスト容易性）: https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html
