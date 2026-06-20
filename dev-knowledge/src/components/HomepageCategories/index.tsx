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
