/**
 * Page links are stored in page markdown as ordinary links whose URL carries
 * the target page id: `[Current Title](gdd://page/<uuid>)`. The id is the
 * source of truth; the link text is kept in sync with the target's title.
 */

export const PAGE_LINK_PREFIX = "gdd://page/";

/** Drag-and-drop data type carrying a page id (hierarchy → editor). */
export const PAGE_DRAG_MIME = "application/x-gdd-page";

const LINK_RE = /\[((?:\\.|[^\]\\])*)\]\(gdd:\/\/page\/([0-9A-Za-z-]+)\)/g;

export function pageUrl(id: string): string {
  return PAGE_LINK_PREFIX + id;
}

export function parsePageUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(PAGE_LINK_PREFIX)) return null;
  const id = url.slice(PAGE_LINK_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/** Title shown for a page with an empty title. */
export function displayTitle(title: string | null | undefined): string {
  const t = (title ?? "").trim();
  return t.length > 0 ? t : "Untitled";
}

export function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, (c) => "\\" + c);
}

export function pageLinkMarkdown(id: string, title: string): string {
  return `[${escapeLinkText(displayTitle(title))}](${pageUrl(id)})`;
}

/** Ids of every page linked from the markdown. */
export function findLinkedPageIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const m of markdown.matchAll(LINK_RE)) ids.add(m[2]);
  return ids;
}

/**
 * Rewrites the text of every page link whose target `titleOf` knows about.
 * Links to unknown (deleted) pages keep their last text.
 */
export function syncLinkTitles(
  markdown: string,
  titleOf: (id: string) => string | undefined,
): string {
  if (!markdown.includes(PAGE_LINK_PREFIX)) return markdown;
  return markdown.replace(LINK_RE, (whole, _text: string, id: string) => {
    const title = titleOf(id);
    return title === undefined ? whole : pageLinkMarkdown(id, title);
  });
}

/** Rewrites only the links that point at `id`. */
export function updateLinkTitle(markdown: string, id: string, title: string): string {
  return syncLinkTitles(markdown, (target) => (target === id ? title : undefined));
}
