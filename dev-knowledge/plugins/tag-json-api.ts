import fs from "node:fs/promises";
import path from "node:path";
import type { AllContent, LoadContext, Plugin, Props } from "@docusaurus/types";

/**
 * AI がタグ横断でナレッジを探索できるように、ビルド時に JSON を出力するプラグイン。
 *
 * - `/api/tags.json`            … 全タグの一覧（タグ名・記事数・詳細 JSON の URL）
 * - `/api/tags/<tag>.json`      … そのタグが付いた記事のタイトルと URL
 *
 * docs プラグインが解決済みの frontmatter・permalink をそのまま使うので、
 * Markdown を自前でパースしない（タグの slug も Docusaurus のタグページと一致する）。
 */

const PLUGIN_NAME = "tag-json-api";
const DOCS_PLUGIN_NAME = "docusaurus-plugin-content-docs";

const API_DIR = "api";
const TAGS_INDEX_FILENAME = "tags.json";
const TAGS_DETAIL_DIRNAME = "tags";

/** docs プラグインの loaded content のうち、このプラグインが使う部分だけ。 */
type LoadedDocTag = {
  label: string;
  permalink: string;
};

type LoadedDoc = {
  title: string;
  permalink: string;
  draft?: boolean;
  unlisted?: boolean;
  tags?: LoadedDocTag[];
};

type LoadedDocsVersion = {
  docs?: LoadedDoc[];
};

type LoadedDocsContent = {
  loadedVersions?: LoadedDocsVersion[];
};

type TagBucket = {
  /** frontmatter に書かれたタグ名 */
  name: string;
  /** Docusaurus のタグページと同じ slug。JSON のファイル名になる */
  slug: string;
  docs: LoadedDoc[];
};

type TagsIndexJson = {
  count: number;
  tags: {
    name: string;
    count: number;
    url: string;
  }[];
};

type TagDetailJson = {
  tag: string;
  count: number;
  docs: {
    title: string;
    url: string;
    tags: string[];
  }[];
};

/**
 * ロケールに依存しないコードポイント順。
 * localeCompare は環境の ICU バージョンで揺れるので、ビルドを再現可能にするために使わない。
 */
function compareByCodePoint(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** 公開対象の記事だけを、permalink で重複排除して集める。 */
function collectDocs(allContent: AllContent): LoadedDoc[] {
  const docsContentById = allContent[DOCS_PLUGIN_NAME] ?? {};
  const docs: LoadedDoc[] = [];
  const seenPermalinks = new Set<string>();

  for (const content of Object.values(docsContentById)) {
    const versions = (content as LoadedDocsContent | undefined)?.loadedVersions ?? [];
    for (const version of versions) {
      for (const doc of version.docs ?? []) {
        if (doc.draft || doc.unlisted || seenPermalinks.has(doc.permalink)) {
          continue;
        }
        seenPermalinks.add(doc.permalink);
        docs.push(doc);
      }
    }
  }

  return docs;
}

/**
 * タグページの permalink 末尾を slug として使う。
 * Docusaurus はタグ名を小文字化して slug 化するため、`React` と `react` のような
 * 表記ゆれは同じ slug に寄る。ここでも permalink 単位でまとめる。
 */
function toTagSlug(tag: LoadedDocTag): string {
  const segments = tag.permalink.split("/").filter(Boolean);
  return segments.at(-1) ?? tag.label;
}

function groupByTag(docs: LoadedDoc[]): TagBucket[] {
  const buckets = new Map<string, TagBucket>();

  for (const doc of docs) {
    for (const tag of doc.tags ?? []) {
      const slug = toTagSlug(tag);
      const bucket = buckets.get(slug);
      if (!bucket) {
        buckets.set(slug, { name: tag.label, slug, docs: [doc] });
        continue;
      }
      // 同じ slug に別表記のタグ名が寄ることがある。読み込み順に依存しないよう小さい方を採用する
      if (compareByCodePoint(tag.label, bucket.name) < 0) {
        bucket.name = tag.label;
      }
      // frontmatter に同じタグが重複していても記事は 1 回だけ載せる
      if (bucket.docs.at(-1) !== doc) {
        bucket.docs.push(doc);
      }
    }
  }

  for (const bucket of buckets.values()) {
    bucket.docs.sort((a, b) => compareByCodePoint(a.title, b.title));
  }

  return [...buckets.values()].sort(
    (a, b) =>
      compareByCodePoint(a.name.toLowerCase(), b.name.toLowerCase()) ||
      compareByCodePoint(a.slug, b.slug),
  );
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export default function tagJsonApiPlugin(context: LoadContext): Plugin<void> {
  const { siteConfig } = context;

  /** サイト内パスを、そのまま fetch できる絶対 URL にする（日本語タグは percent-encode される）。 */
  const toAbsoluteUrl = (pathname: string): string =>
    new URL(pathname, siteConfig.url).href;

  /** baseUrl 配下の API パスを組み立てる。 */
  const toApiPath = (...segments: string[]): string =>
    [siteConfig.baseUrl, API_DIR, ...segments].join("/").replace(/\/{2,}/g, "/");

  let tagBuckets: TagBucket[] = [];

  return {
    name: PLUGIN_NAME,

    allContentLoaded({ allContent }) {
      tagBuckets = groupByTag(collectDocs(allContent));
    },

    async postBuild({ outDir }: Props) {
      const index: TagsIndexJson = {
        count: tagBuckets.length,
        tags: tagBuckets.map((bucket) => ({
          name: bucket.name,
          count: bucket.docs.length,
          url: toAbsoluteUrl(toApiPath(TAGS_DETAIL_DIRNAME, `${bucket.slug}.json`)),
        })),
      };

      await writeJsonFile(path.join(outDir, API_DIR, TAGS_INDEX_FILENAME), index);

      await Promise.all(
        tagBuckets.map((bucket) => {
          const detail: TagDetailJson = {
            tag: bucket.name,
            count: bucket.docs.length,
            docs: bucket.docs.map((doc) => ({
              title: doc.title,
              url: toAbsoluteUrl(doc.permalink),
              tags: (doc.tags ?? []).map((tag) => tag.label),
            })),
          };

          return writeJsonFile(
            path.join(outDir, API_DIR, TAGS_DETAIL_DIRNAME, `${bucket.slug}.json`),
            detail,
          );
        }),
      );

      console.log(
        `[${PLUGIN_NAME}] ${tagBuckets.length} tags -> ${toApiPath(TAGS_INDEX_FILENAME)}`,
      );
    },
  };
}
