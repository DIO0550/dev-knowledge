import fs from "node:fs/promises";
import path from "node:path";
import type { AllContent, LoadContext, Plugin, Props } from "@docusaurus/types";

/**
 * AI がベクタ検索なしでナレッジを引けるように、ビルド時に JSON を出力するプラグイン。
 *
 * - `/api/index.json`        … エントリポイント。以下のエンドポイントの URL を返す
 * - `/api/docs.json`         … 全記事の目次（タイトル・URL・タグ・本文 JSON の URL）
 * - `/api/docs/<id>.json`    … 記事本文（Markdown）
 * - `/api/tags.json`         … 全タグ（タグ名・記事数・タグ別 JSON の URL）
 * - `/api/tags/<tag>.json`   … そのタグが付いた記事の一覧
 *
 * docs プラグインが解決済みの frontmatter・permalink をそのまま使うので、
 * Markdown を自前でパースしない（タグの slug も Docusaurus のタグページと一致する）。
 */

const PLUGIN_NAME = "json-api";
const DOCS_PLUGIN_NAME = "docusaurus-plugin-content-docs";

const API_DIR = "api";
const INDEX_FILENAME = "index.json";
const DOCS_INDEX_FILENAME = "docs.json";
const DOCS_DETAIL_DIRNAME = "docs";
const TAGS_INDEX_FILENAME = "tags.json";
const TAGS_DETAIL_DIRNAME = "tags";

const SITE_ALIAS = "@site/";
const FRONT_MATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** docs プラグインの loaded content のうち、このプラグインが使う部分だけ。 */
type LoadedDocTag = {
  label: string;
  permalink: string;
};

type LoadedDoc = {
  id: string;
  title: string;
  permalink: string;
  source: string;
  sourceDirName: string;
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

/** 記事の要約情報。目次にもタグ別一覧にも本文 JSON にも同じ形で載せる。 */
type DocSummaryJson = {
  title: string;
  url: string;
  category: string | null;
  tags: string[];
  contentUrl: string;
};

type ApiIndexJson = {
  site: string;
  counts: { docs: number; tags: number };
  endpoints: { name: string; url: string; description: string }[];
};

type DocsIndexJson = {
  count: number;
  docs: DocSummaryJson[];
};

type DocDetailJson = DocSummaryJson & {
  content: string;
};

type TagsIndexJson = {
  count: number;
  tags: { name: string; count: number; url: string }[];
};

type TagDetailJson = {
  tag: string;
  count: number;
  docs: DocSummaryJson[];
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

  // id 順に並べると docs/ のフォルダ構成どおり（技術ごと）にまとまる
  return docs.sort((a, b) => compareByCodePoint(a.id, b.id));
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

/** `@site/docs/foo.md` を実ファイルパスに戻す。 */
function toSourceFilePath(siteDir: string, source: string): string {
  return source.startsWith(SITE_ALIAS)
    ? path.join(siteDir, source.slice(SITE_ALIAS.length))
    : source;
}

/** frontmatter は目次側に構造化して載せているので、本文だけを返す。 */
async function readDocContent(siteDir: string, doc: LoadedDoc): Promise<string> {
  const raw = await fs.readFile(toSourceFilePath(siteDir, doc.source), "utf8");
  return `${raw.replace(FRONT_MATTER_PATTERN, "").trim()}\n`;
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export default function jsonApiPlugin(context: LoadContext): Plugin<void> {
  const { siteDir, siteConfig } = context;

  /** サイト内パスを、そのまま fetch できる絶対 URL にする（日本語は percent-encode される）。 */
  const toAbsoluteUrl = (pathname: string): string =>
    new URL(pathname, siteConfig.url).href;

  /** baseUrl 配下の API パスを組み立てる。 */
  const toApiUrl = (...segments: string[]): string =>
    toAbsoluteUrl(
      [siteConfig.baseUrl, API_DIR, ...segments].join("/").replace(/\/{2,}/g, "/"),
    );

  const toDocSummary = (doc: LoadedDoc): DocSummaryJson => ({
    title: doc.title,
    url: toAbsoluteUrl(doc.permalink),
    category: doc.sourceDirName === "." ? null : doc.sourceDirName,
    tags: (doc.tags ?? []).map((tag) => tag.label),
    contentUrl: toApiUrl(DOCS_DETAIL_DIRNAME, `${doc.id}.json`),
  });

  let docs: LoadedDoc[] = [];
  let tagBuckets: TagBucket[] = [];

  return {
    name: PLUGIN_NAME,

    allContentLoaded({ allContent }) {
      docs = collectDocs(allContent);
      tagBuckets = groupByTag(docs);
    },

    async postBuild({ outDir }: Props) {
      const apiDir = path.join(outDir, API_DIR);

      const apiIndex: ApiIndexJson = {
        site: toAbsoluteUrl(siteConfig.baseUrl),
        counts: { docs: docs.length, tags: tagBuckets.length },
        endpoints: [
          {
            name: "docs",
            url: toApiUrl(DOCS_INDEX_FILENAME),
            description:
              "全記事の目次。各記事の title / url / category / tags と、本文 Markdown を返す contentUrl が入る。",
          },
          {
            name: "tags",
            url: toApiUrl(TAGS_INDEX_FILENAME),
            description:
              "全タグ。各タグの name / count と、そのタグが付いた記事一覧を返す url が入る。",
          },
        ],
      };

      const docsIndex: DocsIndexJson = {
        count: docs.length,
        docs: docs.map(toDocSummary),
      };

      const tagsIndex: TagsIndexJson = {
        count: tagBuckets.length,
        tags: tagBuckets.map((bucket) => ({
          name: bucket.name,
          count: bucket.docs.length,
          url: toApiUrl(TAGS_DETAIL_DIRNAME, `${bucket.slug}.json`),
        })),
      };

      await Promise.all([
        writeJsonFile(path.join(apiDir, INDEX_FILENAME), apiIndex),
        writeJsonFile(path.join(apiDir, DOCS_INDEX_FILENAME), docsIndex),
        writeJsonFile(path.join(apiDir, TAGS_INDEX_FILENAME), tagsIndex),

        ...docs.map(async (doc) => {
          const detail: DocDetailJson = {
            ...toDocSummary(doc),
            content: await readDocContent(siteDir, doc),
          };
          return writeJsonFile(
            path.join(apiDir, DOCS_DETAIL_DIRNAME, `${doc.id}.json`),
            detail,
          );
        }),

        ...tagBuckets.map((bucket) => {
          const detail: TagDetailJson = {
            tag: bucket.name,
            count: bucket.docs.length,
            docs: bucket.docs.map(toDocSummary),
          };
          return writeJsonFile(
            path.join(apiDir, TAGS_DETAIL_DIRNAME, `${bucket.slug}.json`),
            detail,
          );
        }),
      ]);

      console.log(
        `[${PLUGIN_NAME}] ${docs.length} docs / ${tagBuckets.length} tags -> ${toApiUrl(INDEX_FILENAME)}`,
      );
    },
  };
}
