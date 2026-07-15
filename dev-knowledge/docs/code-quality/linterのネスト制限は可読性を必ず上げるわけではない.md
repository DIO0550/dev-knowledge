---
title: Linterのネスト制限は可読性を「必ず」上げるわけではない
tags: [linter, readability, nesting, cognitive-complexity, refactoring, early-return, code-review, eslint, sonarqube, empirical-software-engineering]
---

## TL;DR

- 「深いネスト → 読みにくい」は実証研究で概ね支持されている（読解時間・主観評価）。
- ただし「正しく理解できたか（正答率）」ベースでは効果が揺れ、関数分解の効果は「決定的でない」とする直近の否定的結果もある。
- Linterのネスト制限が保証するのは「深いネストの検知」だけで、修正の質は保証しない。機械的な関数抽出や条件反転は複雑さを移動・隠蔽するだけの場合がある。
- 結論: 制限は「レビューすべき箇所を光らせるシグナル」として運用し、違反時の書き換え方針をチーム規約で補うのがエビデンスと整合的。

## このドキュメントの射程

- 問い: Linter（ESLint `max-depth`、SonarQube Cognitive Complexity 等）でネスト深度に上限を設けると、コードの可読性は必ず上がるのか。
- 「状態の比較」（浅いネスト vs 深いネストの読みやすさ）と「介入の効果」（Linterで制限を課したときに開発者が書くコードの質）を区別して整理する。

## ネスト削減を支持するエビデンス

- Johnson et al. (ICSME 2019): 32個のJavaメソッド・275名の統制実験。ネスト最小化は読解・理解時間を短縮し、理解への自信を高め、バグ発見能力の向上も示唆。アイトラッキングによるラボ追試でも「自信が高くなる」点は一致。
- Muñoz Barón et al. (ESEM 2020): Cognitive Complexity（ネスト深度に重み付けするメトリクス）のメタ分析。427スニペット・約24,000件の理解度評価で、理解時間・主観的理解しやすさと正の相関（複合変数で r ≈ 0.40）。
- PR分析研究 (arXiv:2309.02594): 実務の可読性改善PRで「ネスト深度3→1に削減」が典型パターンとして観測される。

## 「必ず」とは言えない理由

1. **正答率では効果が揺れる**: Cognitive Complexityと理解タスクの正答率の相関は -0.52〜+0.57 とばらつき、加重平均は小さな負の相関（-0.13）。「速く・楽に読める」と「正しく理解できる」は別の変数。Scalabrino et al. は121メトリクスを調べ、どれも理解しやすさを正確に表現できないと結論。
2. **関数抽出は可読性を上げるとは限らない**: ICPC 2024の統制実験で、機能分解（単一関数 vs 複数関数）のコード理解への影響は inconclusive。ジャンプ先が増え文脈が分断されると逆効果になり得る。「最適な関数サイズ」の実証研究はほぼ無く、Goldilocks仮説自体に反論あり（Fenton & Neil）。
3. **早期リターンにも構造的反論がある**: ネスト（インデント）を浅くしてもif自体は減らず条件の追跡量は不変。暗黙のelseを反転しながら読む必要があり「精神的スタック」の負担が増えるとの指摘（アンチ早期リターン派）。早期リターン派 vs 単一出口派で可読性・保守性・安全性の評価は割れている。
4. **可読性は文脈依存**: 静的メトリクスは命名の明確さ・構造の組織化・説明的意図といった開発者が実際に重視する基準を捉えられない。可読性は開発者の経験・チーム規約・タスク文脈で変わる。

## 解決（実務での落とし所）

- Linterのネスト制限は**修正方向を指定しない**。開発者は (a) ガード節への整理、(b) 条件の統合・宣言的書き換え、(c) 機械的な関数抽出、(d) 条件を `&&` で潰す、のどれでも通過できる。(a)(b) は本質的複雑さを下げやすいが、(c)(d) は複雑さを移動させるだけ（Goodhartの法則の典型例）。

```ts
// Linterは通るが複雑さが移動しただけの例（機械的抽出）
function process(order: Order) {
  if (!isValid(order)) return;
  handleValidOrder(order); // 実体はここに深いネストが引っ越しただけ
}

// 本質的複雑さを下げる例（型で分岐自体を消す）
type OrderState =
  | { kind: "draft" }
  | { kind: "confirmed"; paymentId: PaymentId }
  | { kind: "shipped"; paymentId: PaymentId; trackingId: TrackingId };
// 判別可能ユニオン + パースによる絞り込みで、
// 「ネストの見た目」ではなく「条件の組み合わせ数」を減らす
```

- 運用指針:
  - ネスト制限は「議論すべき箇所を光らせるスモークテスト」として使う（自動修正の指示ではない）。
  - 違反時の書き換え優先順位（ガード節 → 条件統合 → 意味のある単位でのみ抽出）をチーム規約側で明文化する。
  - TypeScriptなら判別可能ユニオン・パース境界での型絞り込みで分岐そのものを削減する方向が、上記批判を回避できる筋の良い手段。

## まとめ

- ネスト制限は「傾向として読みやすさに寄与する」が「必ず上げる」保証はない。検知シグナルとして使い、修正の質は規約と型設計で担保する。

## 参考

- Johnson et al., "An Empirical Study Assessing Source Code Readability in Comprehension" (ICSME 2019) — https://ieeexplore.ieee.org/document/8918951/
- Muñoz Barón, Wyrich, Wagner, "An Empirical Validation of Cognitive Complexity as a Measure of Source Code Understandability" (ESEM 2020) — https://arxiv.org/abs/2007.12520
- "On the comprehensibility of functional decomposition: An empirical study" (ICPC 2024) — https://dl.acm.org/doi/10.1145/3643916.3644432
- Lavazza et al., "An empirical evaluation of the 'Cognitive Complexity' measure as a predictor of code understandability" (JSS 2022) — https://www.sciencedirect.com/science/article/abs/pii/S0164121222002370
- "How do Developers Improve Code Readability? An Empirical Study of Pull Requests" — https://arxiv.org/pdf/2309.02594
- 技術評論社「可読性向上の必勝パターンは存在するのか」 — https://gihyo.jp/book/pickup/2022/0063
- Ninton「リーダブルコードをさらに改良する（アンチ・アーリーリターン）」 — https://www.ninton.co.jp/archives/8065
- TransRecog「早期returnは善か悪か ー 海外の反応は？」 — https://www.transrecog.com/diary/2025/09/02/post-3284/
