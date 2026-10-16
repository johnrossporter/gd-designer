import type { Page } from "../types/document";

export interface FilterResult {
  /** Pages whose title matches the query. */
  matches: Set<string>;
  /** Matches plus all their ancestors, i.e. everything the tree should show. */
  visible: Set<string>;
}

/** Case-insensitive title filter that keeps the path to each match visible. */
export function filterPages(pages: Record<string, Page>, query: string): FilterResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const matches = new Set<string>();
  const visible = new Set<string>();
  for (const page of Object.values(pages)) {
    if (!page.title.toLowerCase().includes(q)) continue;
    matches.add(page.id);
    let cur: string | null = page.id;
    while (cur && !visible.has(cur)) {
      visible.add(cur);
      cur = pages[cur]?.parentId ?? null;
    }
  }
  return { matches, visible };
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** Splits `text` into segments, flagging the ones that match `query`. */
export function highlightSegments(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const out: Segment[] = [];
  const lower = text.toLowerCase();
  let pos = 0;
  while (pos <= lower.length) {
    const i = lower.indexOf(q, pos);
    if (i < 0) break;
    if (i > pos) out.push({ text: text.slice(pos, i), hit: false });
    out.push({ text: text.slice(i, i + q.length), hit: true });
    pos = i + q.length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}
