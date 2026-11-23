#!/usr/bin/env node
/**
 * ナレッジ記事（dev-knowledge/docs 配下）のフォーマット・表示崩れを検証する依存ゼロのスクリプト。
 *
 * 実行: pnpm run check:docs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SITE_DIR, "..");
const DOCS_DIR = path.join(SITE_DIR, "docs");
const STRAY_DOCS_DIR = path.join(REPO_ROOT, "docs");

const TAG_PATTERN = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const PUNCT_OR_SYMBOL_RE = /[\p{P}\p{S}]/u;

/** @param {string} dir @returns {string[]} */
function walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results.sort();
}

/** @param {string} ch */
function isPunct(ch) {
  return PUNCT_OR_SYMBOL_RE.test(ch);
}

/**
 * CommonMark の flanking ルールに引っかかり Docusaurus で ** が生表示される箇所を検出する。
 * @param {string} line
 * @returns {string[]}
 */
function checkBoldIssues(line) {
  const codeRanges = [];
  for (const m of line.matchAll(/`+[^`]*`+/g)) {
    codeRanges.push([m.index, m.index + m[0].length]);
  }
  const inCodeSpan = (pos) =>
    codeRanges.some(([start, end]) => pos >= start && pos < end);

  const positions = [];
  for (const m of line.matchAll(/(?<!\*)\*\*(?!\*)/g)) {
    if (!inCodeSpan(m.index)) {
      positions.push(m.index);
    }
  }

  const issues = [];
  if (positions.length % 2 !== 0) {
    issues.push("対応が閉じていない `**` があります（複数行またぎ太字を含む）");
  }

  for (let i = 0; i + 1 < positions.length; i += 2) {
    const s = positions[i];
    const e = positions[i + 1];
    const beforeS = s > 0 ? line[s - 1] : " ";
    const afterS = s + 2 < line.length ? line[s + 2] : " ";
    const leftOk =
      !/\s/.test(afterS) &&
      (!isPunct(afterS) || /\s/.test(beforeS) || isPunct(beforeS));

    const beforeE = e > 0 ? line[e - 1] : " ";
    const afterE = e + 2 < line.length ? line[e + 2] : " ";
    const rightOk =
      !/\s/.test(beforeE) &&
      (!isPunct(beforeE) || /\s/.test(afterE) || isPunct(afterE));

    if (!leftOk || !rightOk) {
      const snippet = line.slice(Math.max(0, s - 8), Math.min(line.length, e + 10));
      issues.push(`CommonMark 太字崩れ（括弧や記号との境界）: ${snippet}`);
    }
  }
  return issues;
}

const errors = [];
const addError = (file, line, message) => {
  const loc = line ? `${file}:${line}` : file;
  errors.push(`${loc} — ${message}`);
};

// 1. リポジトリ直下 docs/ への誤配置チェック
const strayFiles = walkMarkdown(STRAY_DOCS_DIR);
for (const file of strayFiles) {
  addError(
    path.relative(REPO_ROOT, file),
    null,
    "配置ズレ: dev-knowledge/docs/ 配下ではなくリポジトリ直下の docs/ に置かれています",
  );
}

// 2. 全記事のチェック
const docs = walkMarkdown(DOCS_DIR);

for (const filePath of docs) {
  const rel = path.relative(REPO_ROOT, filePath);
  const basename = path.basename(filePath);
  const raw = fs.readFileSync(filePath, "utf8");

  if (basename.includes(" ")) {
    addError(rel, null, "ファイル名に半角スペースが含まれています");
  }

  // Frontmatter
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    addError(rel, 1, "frontmatter（--- ... ---）がありません");
    continue;
  }

  const fmText = fmMatch[1];
  const fmLines = fmMatch[0].split(/\r?\n/).length - 1;
  const body = raw.slice(fmMatch[0].length);

  // title
  const titleMatch = fmText.match(/^title:\s*(.+)$/m);
  if (!titleMatch) {
    addError(rel, 1, "frontmatter に title がありません");
  } else {
    const titleVal = titleMatch[1].trim();
    if (titleVal.includes("`")) {
      addError(rel, 2, `title にバッククォートを含めないでください: ${titleVal}`);
    }
  }

  // tags (1行配列 + 小文字英語ケバブケース)
  const tagsLineMatch = fmText.match(/^tags:\s*\[([^\r\n]*)\]\s*$/m);
  if (!tagsLineMatch) {
    addError(rel, 3, "tags は 1 行配列（tags: [tag-1, tag-2]）で指定してください");
  } else {
    const tags = tagsLineMatch[1]
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    if (tags.length === 0) {
      addError(rel, 3, "tags が空です");
    }
    const seen = new Set();
    for (const tag of tags) {
      if (!TAG_PATTERN.test(tag)) {
        addError(
          rel,
          3,
          `タグ "${tag}" は小文字英語ケバブケース（例: abort-controller）にしてください`,
        );
      }
      if (seen.has(tag)) {
        addError(rel, 3, `タグ "${tag}" が重複しています`);
      }
      seen.add(tag);
    }
  }

  // 本文チェック
  const lines = body.split(/\r?\n/);
  let inCode = false;
  let fenceChar = null;
  let fenceLen = 0;
  let hasTldr = false;
  let inRefSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = fmLines + i + 1;

    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      const info = fenceMatch[3].trim();
      if (!inCode) {
        inCode = true;
        fenceChar = marker[0];
        fenceLen = marker.length;
        if (!info) {
          addError(lineNo ? rel : rel, lineNo, "コードブロックに言語指定がありません（図やツリーは text を指定）");
        }
      } else if (marker[0] === fenceChar && marker.length >= fenceLen && !info) {
        inCode = false;
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    if (inCode) continue;

    // 見出し
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      const heading = h2Match[1].trim();
      if (heading === "TL;DR") hasTldr = true;
      inRefSection = heading.startsWith("参考");
    }

    // 太字崩れ
    if (line.includes("**")) {
      for (const msg of checkBoldIssues(line)) {
        addError(rel, lineNo, msg);
      }
    }

    // 空バッククォート（JSX タグ等の欠落痕跡）
    if (/(?<!`)``(?!`)/.test(line)) {
      addError(rel, lineNo, "空バッククォート（``）があります（JSX タグや型引数が欠落している可能性）");
    }

    // 相対リンク存在確認
    const noInlineCode = line.replace(/`[^`]*`/g, "");
    for (const lm of noInlineCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const href = lm[1].trim();
      if (
        !href.startsWith("http://") &&
        !href.startsWith("https://") &&
        !href.startsWith("#") &&
        !href.startsWith("mailto:") &&
        !href.startsWith("/")
      ) {
        const target = path.resolve(path.dirname(filePath), href.split("#")[0]);
        if (!fs.existsSync(target)) {
          addError(rel, lineNo, `相対リンク先が存在しません: ${href}`);
        }
      }
    }

    // 参考セクションの裸 URL チェック
    if (inRefSection) {
      const withoutMdLinks = line
        .replace(/\[(?:[^\[\]`]|`[^`]*`)*\]\(https?:\/\/[^)]+\)/g, "")
        .replace(/`[^`]*`/g, "");
      if (/https?:\/\/\S+/.test(withoutMdLinks)) {
        addError(rel, lineNo, "参考セクションに裸 URL があります（[タイトル](URL) 形式にしてください）");
      }
    }
  }

  if (inCode) {
    addError(rel, null, "閉じられていないコードブロックがあります");
  }
  if (!hasTldr) {
    addError(rel, null, "必須見出し `## TL;DR` がありません");
  }
}

if (errors.length > 0) {
  console.error(`\n[check:docs] ${errors.length} 件のエラーが見つかりました:\n`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`[check:docs] OK: ${docs.length} 件の記事をチェックし、問題は見つかりませんでした。`);
