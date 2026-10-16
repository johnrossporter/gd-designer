import { $nodeSchema, $prose, $remark, $view } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import { visit } from "unist-util-visit";
import { watchEffect } from "vue";
import { displayTitle, PAGE_DRAG_MIME, pageUrl, parsePageUrl } from "../lib/pageLinks";

/**
 * Milkdown support for links between pages.
 *
 * Markdown `[Title](gdd://page/<id>)` is parsed into an inline atom node
 * `page_link { pageId, label }`. The node always *displays* the live title of
 * the target page (read reactively from the store), and serializes back to
 * markdown with that current title, so renames flow through automatically.
 */

export interface PageLinkOptions {
  /** Current title of a page, or undefined if it no longer exists. */
  getTitle: (pageId: string) => string | undefined;
  /** Navigate to a page. */
  onOpen: (pageId: string) => void;
  /** User typed `[[` — ask the app to show the page picker. */
  onRequestLink: () => void;
}

interface MdNode {
  type: string;
  url?: string;
  value?: string;
  children?: MdNode[];
  [key: string]: unknown;
}

function mdText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(mdText).join("");
}

export function pageLinkPlugins(opts: PageLinkOptions) {
  /** remark: turn `link` nodes that point at pages into `pageLink` nodes. */
  const remarkPageLink = $remark("remarkPageLink", () => () => (tree: unknown) => {
    visit(tree as MdNode, "link", (node: MdNode, index, parent: MdNode | undefined) => {
      const pageId = parsePageUrl(node.url);
      if (!pageId || !parent?.children || index === undefined) return;
      parent.children[index] = { type: "pageLink", pageId, label: mdText(node) };
    });
  });

  const pageLinkSchema = $nodeSchema("page_link", () => ({
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    marks: "_",
    attrs: {
      pageId: { default: "" },
      label: { default: "" },
    },
    parseDOM: [
      {
        tag: "a[data-page-id]",
        priority: 100,
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return { pageId: el.getAttribute("data-page-id") ?? "", label: el.textContent ?? "" };
        },
      },
    ],
    toDOM: (node) => {
      const title = opts.getTitle(node.attrs.pageId) ?? node.attrs.label;
      return [
        "a",
        { "data-page-id": node.attrs.pageId, class: "page-link", href: pageUrl(node.attrs.pageId) },
        displayTitle(title),
      ];
    },
    parseMarkdown: {
      match: (node) => node.type === "pageLink",
      runner: (state, node, type) => {
        state.addNode(type, { pageId: node.pageId as string, label: (node.label as string) ?? "" });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "page_link",
      runner: (state, node) => {
        const title = displayTitle(opts.getTitle(node.attrs.pageId) ?? node.attrs.label);
        state.openNode("link", undefined, { url: pageUrl(node.attrs.pageId) });
        state.addNode("text", undefined, title);
        state.closeNode();
      },
    },
  }));

  /** Node view: live title, broken-link styling, click to navigate. */
  const pageLinkView = $view(pageLinkSchema.node, () => (initial: ProseNode): NodeView => {
    let node = initial;
    const dom = document.createElement("a");
    dom.className = "page-link";
    dom.href = pageUrl(node.attrs.pageId);
    dom.contentEditable = "false";
    dom.draggable = true;

    const stop = watchEffect(() => {
      const id = node.attrs.pageId as string;
      const title = opts.getTitle(id);
      const missing = title === undefined;
      dom.dataset.pageId = id;
      dom.textContent = displayTitle(missing ? node.attrs.label : title);
      dom.classList.toggle("broken", missing);
      dom.title = missing ? "This page no longer exists" : `Open "${displayTitle(title)}"`;
    });

    dom.addEventListener("click", (e) => {
      e.preventDefault();
      if (opts.getTitle(node.attrs.pageId) !== undefined) opts.onOpen(node.attrs.pageId);
    });

    return {
      dom,
      update: (next) => {
        if (next.type !== node.type || next.attrs.pageId !== node.attrs.pageId) return false;
        node = next;
        return true;
      },
      ignoreMutation: () => true,
      destroy: () => stop(),
    };
  });

  /** `[[` opens the page picker; dropping a hierarchy item inserts a link. */
  const pageLinkInput = $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey("gddPageLinkInput"),
        props: {
          handleTextInput(view: EditorView, from: number, to: number, text: string) {
            if (text !== "[" || from < 1) return false;
            const before = view.state.doc.textBetween(from - 1, from);
            if (before !== "[") return false;
            view.dispatch(view.state.tr.delete(from - 1, to));
            opts.onRequestLink();
            return true;
          },
          handleDrop(view: EditorView, event: DragEvent) {
            const pageId = event.dataTransfer?.getData(PAGE_DRAG_MIME);
            if (!pageId) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (pos === undefined) return true;
            const type = pageLinkSchema.type(ctx);
            const label = opts.getTitle(pageId) ?? "";
            view.dispatch(view.state.tr.insert(pos, type.create({ pageId, label })));
            view.focus();
            return true;
          },
        },
      }),
  );

  return { remarkPageLink, pageLinkSchema, pageLinkView, pageLinkInput };
}
