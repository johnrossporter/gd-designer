import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { findMatches } from "../lib/search";
import { displayTitle } from "../lib/pageLinks";

/**
 * Highlights search matches in the editor and tracks the "current" one.
 * Text is read per block the same way `markdownToPlainText` produces it
 * (page links count as their title), so occurrence numbers from the search
 * pane point at the right match here.
 */

export interface MatchRange {
  from: number;
  to: number;
}

interface SearchPluginState {
  matcher: RegExp | null;
  current: number;
  ranges: MatchRange[];
  deco: DecorationSet;
}

export interface SearchMeta {
  matcher?: RegExp | null;
  current?: number;
}

export const searchKey = new PluginKey<SearchPluginState>("gddSearchHighlight");

const empty: SearchPluginState = { matcher: null, current: -1, ranges: [], deco: DecorationSet.empty };

export function docMatches(
  doc: ProseNode,
  matcher: RegExp,
  getTitle: (pageId: string) => string | undefined,
): MatchRange[] {
  const ranges: MatchRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: MatchRange[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const t = child.text ?? "";
        for (let i = 0; i < t.length; i++) map.push({ from: start + i, to: start + i + 1 });
        text += t;
        return;
      }
      // Inline atoms: page links read as their title, everything else as a placeholder.
      const t =
        child.type.name === "page_link"
          ? displayTitle(getTitle(child.attrs.pageId) ?? child.attrs.label)
          : child.type.name === "hardbreak"
            ? "\n"
            : "￼";
      for (let i = 0; i < t.length; i++) map.push({ from: start, to: start + child.nodeSize });
      text += t;
    });
    for (const m of findMatches(text, matcher)) {
      ranges.push({ from: map[m.start].from, to: map[m.end - 1].to });
    }
    return false;
  });
  return ranges;
}

function build(state: EditorState, matcher: RegExp | null, current: number, getTitle: (id: string) => string | undefined) {
  if (!matcher) return empty;
  const ranges = docMatches(state.doc, matcher, getTitle);
  const deco = DecorationSet.create(
    state.doc,
    ranges.map((r, i) =>
      Decoration.inline(r.from, r.to, { class: i === current ? "search-match current" : "search-match" }),
    ),
  );
  return { matcher, current, ranges, deco };
}

export function searchHighlightPlugin(getTitle: (pageId: string) => string | undefined) {
  return $prose(
    () =>
      new Plugin<SearchPluginState>({
        key: searchKey,
        state: {
          init: () => empty,
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
            if (!meta && !tr.docChanged) return prev;
            const matcher = meta && "matcher" in meta ? (meta.matcher ?? null) : prev.matcher;
            const current = meta && "current" in meta ? (meta.current ?? -1) : prev.current;
            return build(state, matcher, current, getTitle);
          },
        },
        props: {
          decorations: (state) => searchKey.getState(state)?.deco,
        },
      }),
  );
}
