import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import Heading from "@theme/Heading";
import styles from "./styles.module.css";

type CategoryItem = {
  title: string;
  to: string;
  description: ReactNode;
};

// 技術が増えたらここにカテゴリを追加する
const CategoryList: CategoryItem[] = [
  {
    title: "React",
    to: "/docs/category/react",
    description: (
      <>React に関する知見・遭遇した問題と解決策（state, Context など）。</>
    ),
  },
  {
    title: "Rust",
    to: "/docs/category/rust",
    description: (
      <>Rust に関する知見・遭遇した問題と解決策（所有権・非同期・設計など）。</>
    ),
  },
  {
    title: "TypeScript",
    to: "/docs/category/typescript",
    description: (
      <>TypeScript に関する知見・型設計・モジュール境界・I/O 分離など。</>
    ),
  },
  {
    title: "Data Modeling",
    to: "/docs/category/data-modeling",
    description: (
      <>データモデリング・ドメインモデリング・境界型の命名に関する知見。</>
    ),
  },
  {
    title: "Swift",
    to: "/docs/category/swift",
    description: (
      <>Swift に関する知見・遭遇した問題と解決策（enum・ネスト型・設計など）。</>
    ),
  },
  {
    title: "Java",
    to: "/docs/category/java",
    description: (
      <>Java / Spring Boot に関する知見・テスト戦略など。</>
    ),
  },
  {
    title: "Linux",
    to: "/docs/category/linux",
    description: (
      <>Linux に関する知見・コマンドの使い分けなど。</>
    ),
  },
  {
    title: "Algorithm",
    to: "/docs/category/algorithm",
    description: (
      <>アルゴリズム・データ構造・計算量に関する言語非依存の知見。</>
    ),
  },
  {
    title: "Code Quality",
    to: "/docs/category/code-quality",
    description: (
      <>コード品質・可読性・Linter 設計に関する知見。</>
    ),
  },
  {
    title: "GitHub Actions",
    to: "/docs/category/github-actions",
    description: (
      <>GitHub Actions・CI/CD のセキュリティや運用に関する知見。</>
    ),
  },
];

function Category({ title, to, description }: CategoryItem) {
  return (
    <div className={clsx("col col--4")}>
      <Link to={to} className={styles.card}>
        <Heading as="h3" className={styles.cardTitle}>
          {title}
        </Heading>
        <p className={styles.cardDescription}>{description}</p>
      </Link>
    </div>
  );
}

export default function HomepageCategories(): ReactNode {
  return (
    <section className={styles.categories}>
      <div className="container">
        <div className="row">
          {CategoryList.map((props, idx) => (
            <Category key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
