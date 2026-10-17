import type { Page } from "../types/document";
import { displayTitle } from "./pageLinks";

/**
 * Full-text search across pages. Content is searched as the *visible* text of
 * the page (markdown syntax, link URLs and embedded image data are stripped),
 * so occurrence numbers line up with what the editor shows.
 */

export interface SearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

export interface SearchHit {
  /** One line of context around the match. */
  snippet: string;
  /** Match position inside `snippet`. */
  start: number;
  end: number;
  /** 0-based index of this match among all matches in the page's text. */
  occurrence: number;
}

export interface PageSearchResult {
  id: string;
  title: string;
  titleMatch: boolean;
  /** Total content matches (hits may be capped). */
  total: number;
  hits: SearchHit[];
}

const WORD = "[\\p{L}\\p{N}_]";

/** Builds the matcher for a query, or null when the query is empty. */
export function buildMatcher(query: string, opts: SearchOptions = {}): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  let source = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) source = `(?<!${WORD})${source}(?!${WORD})`;
  return new RegExp(source, opts.matchCase ? "gu" : "giu");
}

/** Converts page markdown to the plain text a reader sees, one line per block line. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(```|~~~)/.test(line)) // code fences
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) // table rules
    .filter((line) => !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) // horizontal rules
    .map((line) =>
      line
        .replace(/!\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, "$1") // images -> alt text
        .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, "$1") // links -> link text
        .replace(/<[^>]+>/g, "") // inline html
        .replace(/^\s{0,3}#{1,6}\s+/, "") // headings
        .replace(/^\s*>\s?/, "") // block quotes
        .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "") // list markers and task boxes
        .replace(/^\s*\|\s*(.*?)\s*\|\s*$/, "$1") // table row edges
        .replace(/\s+\|\s+/g, "  ") // table cell separators
        .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2") // bold / strike
        .replace(/(^|[^\\*_])([*_])(?=\S)(.+?)(?<=\S)\2/g, "$1$3") // italics
        .replace(/`([^`]*)`/g, "$1") // inline code
        .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1"), // escapes
    )
    .join("\n");
}

const plainCache = new Map<string, { content: string; plain: string }>();

/** Plain text of a page's content, cached until the content changes. */
export function plainTextOf(page: Page): string {
  const cached = plainCache.get(page.id);
  if (cached && cached.content === page.content) return cached.plain;
  const plain = markdownToPlainText(page.content);
  plainCache.set(page.id, { content: page.content, plain });
  return plain;
}

/** Characters of context before and after a match (the pane is narrow, so keep "before" short). */
const CONTEXT_BEFORE = 20;
const CONTEXT_AFTER = 96;

function makeSnippet(text: string, start: number, end: number, occurrence: number): SearchHit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  const lineEnd = nl < 0 ? text.length : nl;
  // Keep the line's start unless the match is far enough in that it could be scrolled out of view.
  let from = start - lineStart <= CONTEXT_BEFORE * 1.5 ? lineStart : start - CONTEXT_BEFORE;
  // Start the snippet on a word boundary when one is close by.
  const space = text.indexOf(" ", from);
  if (from > lineStart && space >= 0 && space + 1 < start) from = space + 1;
  const to = Math.min(lineEnd, end + CONTEXT_AFTER);
  const prefix = from > lineStart ? "…" : "";
  const suffix = to < lineEnd ? "…" : "";
  const snippet = prefix + text.slice(from, to) + suffix;
  const offset = prefix.length + start - from;
  return { snippet, start: offset, end: offset + (end - start), occurrence };
}

/** Indices of every match in `text`. */
export function findMatches(text: string, matcher: RegExp): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  matcher.lastIndex = 0;
  for (let m = matcher.exec(text); m; m = matcher.exec(text)) {
    if (m[0].length === 0) {
      matcher.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Searches page titles and content. Results follow `orderedIds` (the
 * hierarchy order); pages with a title match come first.
 */
export function searchPages(
  pages: Record<string, Page>,
  orderedIds: string[],
  query: string,
  opts: SearchOptions = {},
  maxHitsPerPage = 50,
): PageSearchResult[] {
  const matcher = buildMatcher(query, opts);
  if (!matcher) return [];
  const titled: PageSearchResult[] = [];
  const others: PageSearchResult[] = [];
  for (const id of orderedIds) {
    const page = pages[id];
    if (!page) continue;
    const title = displayTitle(page.title);
    const titleMatch = findMatches(page.title, matcher).length > 0;
    const text = plainTextOf(page);
    const matches = findMatches(text, matcher);
    if (!titleMatch && matches.length === 0) continue;
    const result: PageSearchResult = {
      id,
      title,
      titleMatch,
      total: matches.length,
      hits: matches.slice(0, maxHitsPerPage).map((m, i) => makeSnippet(text, m.start, m.end, i)),
    };
    (titleMatch ? titled : others).push(result);
  }
  return [...titled, ...others];
}
