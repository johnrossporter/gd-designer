import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import type { DocumentFile, Page, PageFile } from "../types/document";
import { FILE_FORMAT, FILE_VERSION } from "../types/document";
import { newId, nowIso } from "../lib/ids";
import { findLinkedPageIds, PAGE_LINK_PREFIX, syncLinkTitles, updateLinkTitle } from "../lib/pageLinks";

export interface NewPageOptions {
  /** Parent page; `null` for a top-level page. Ignored when `afterId` is set. */
  parentId?: string | null;
  /** Insert as the next sibling of this page. */
  afterId?: string | null;
  title?: string;
  content?: string;
}

export const useDocumentStore = defineStore("document", () => {
  const isOpen = ref(false);
  const filePath = ref<string | null>(null);
  const docId = ref("");
  const title = ref("");
  const createdAt = ref("");
  const updatedAt = ref("");
  const lastOpenedPageId = ref<string | null>(null);
  const pages = reactive<Record<string, Page>>({});
  const rootIds = ref<string[]>([]);
  /** Bumped on every change that should be written to disk. */
  const revision = ref(0);

  const pageCount = computed(() => Object.keys(pages).length);

  function touch() {
    updatedAt.value = nowIso();
    revision.value++;
  }

  function clearPages() {
    for (const id of Object.keys(pages)) delete pages[id];
    rootIds.value = [];
  }

  // ---------------------------------------------------------------- lifecycle

  function load(file: DocumentFile, path: string | null) {
    clearPages();
    const walk = (list: PageFile[], parentId: string | null): string[] =>
      list.map((p) => {
        const id = p.id || newId();
        pages[id] = {
          id,
          title: p.title ?? "",
          content: p.content ?? "",
          parentId,
          children: [],
          createdAt: p.createdAt ?? nowIso(),
          updatedAt: p.updatedAt ?? nowIso(),
        };
        pages[id].children = walk(p.children ?? [], id);
        return id;
      });
    rootIds.value = walk(file.pages ?? [], null);

    // Repair link text that drifted (e.g. the JSON was edited by hand).
    const titleOf = (id: string) => pages[id]?.title;
    for (const page of Object.values(pages)) {
      page.content = syncLinkTitles(page.content, titleOf);
    }

    filePath.value = path;
    docId.value = file.id || newId();
    title.value = file.title ?? "";
    createdAt.value = file.createdAt ?? nowIso();
    updatedAt.value = file.updatedAt ?? createdAt.value;
    lastOpenedPageId.value =
      file.lastOpenedPageId && pages[file.lastOpenedPageId]
        ? file.lastOpenedPageId
        : (rootIds.value[0] ?? null);
    isOpen.value = true;
  }

  function create(path: string | null, docTitle: string) {
    const now = nowIso();
    const firstPageId = newId();
    load(
      {
        format: FILE_FORMAT,
        version: FILE_VERSION,
        id: newId(),
        title: docTitle,
        createdAt: now,
        updatedAt: now,
        lastOpenedPageId: firstPageId,
        pages: [{ id: firstPageId, title: docTitle, content: "", createdAt: now, updatedAt: now, children: [] }],
      },
      path,
    );
    revision.value++;
  }

  function close() {
    clearPages();
    isOpen.value = false;
    filePath.value = null;
    docId.value = "";
    title.value = "";
    lastOpenedPageId.value = null;
  }

  function setFilePath(path: string, docTitle?: string) {
    filePath.value = path;
    if (docTitle !== undefined) title.value = docTitle;
    touch();
  }

  function toFile(): DocumentFile {
    const build = (ids: string[]): PageFile[] =>
      ids
        .filter((id) => pages[id])
        .map((id) => {
          const p = pages[id];
          return {
            id: p.id,
            title: p.title,
            content: p.content,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            children: build(p.children),
          };
        });
    return {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      id: docId.value,
      title: title.value,
      createdAt: createdAt.value,
      updatedAt: updatedAt.value,
      lastOpenedPageId: lastOpenedPageId.value,
      pages: build(rootIds.value),
    };
  }

  // ---------------------------------------------------------------- queries

  function childListOf(parentId: string | null): string[] {
    return parentId ? pages[parentId].children : rootIds.value;
  }

  function siblingsOf(id: string): string[] {
    return childListOf(pages[id]?.parentId ?? null);
  }

  /** Ancestors from the root down to (not including) the page. */
  function ancestors(id: string): Page[] {
    const out: Page[] = [];
    let cur = pages[id]?.parentId ?? null;
    while (cur && pages[cur]) {
      out.unshift(pages[cur]);
      cur = pages[cur].parentId;
    }
    return out;
  }

  function isDescendant(id: string, maybeAncestorId: string): boolean {
    let cur = pages[id]?.parentId ?? null;
    while (cur) {
      if (cur === maybeAncestorId) return true;
      cur = pages[cur]?.parentId ?? null;
    }
    return false;
  }

  function subtreeIds(id: string): string[] {
    const out: string[] = [];
    const walk = (pid: string) => {
      out.push(pid);
      pages[pid]?.children.forEach(walk);
    };
    walk(id);
    return out;
  }

  /** Pages whose content links to `id`. */
  function backlinks(id: string): Page[] {
    const needle = PAGE_LINK_PREFIX + id;
    return Object.values(pages).filter(
      (p) => p.id !== id && p.content.includes(needle) && findLinkedPageIds(p.content).has(id),
    );
  }

  /** Depth-first order, as shown in the hierarchy. */
  function orderedIds(): string[] {
    const out: string[] = [];
    const walk = (ids: string[]) =>
      ids.forEach((id) => {
        out.push(id);
        walk(pages[id].children);
      });
    walk(rootIds.value);
    return out;
  }

  // ---------------------------------------------------------------- edits

  function createPage(opts: NewPageOptions = {}): string {
    let parentId = opts.parentId ?? null;
    let index: number | undefined;
    if (opts.afterId && pages[opts.afterId]) {
      parentId = pages[opts.afterId].parentId;
      index = childListOf(parentId).indexOf(opts.afterId) + 1;
    }
    if (parentId && !pages[parentId]) parentId = null;

    const now = nowIso();
    const id = newId();
    pages[id] = {
      id,
      title: opts.title ?? "",
      content: opts.content ?? "",
      parentId,
      children: [],
      createdAt: now,
      updatedAt: now,
    };
    const list = childListOf(parentId);
    list.splice(index ?? list.length, 0, id);
    touch();
    return id;
  }

  /** Renames a page and rewrites the text of every link that points at it. */
  function setTitle(id: string, newTitle: string) {
    const page = pages[id];
    if (!page || page.title === newTitle) return;
    page.title = newTitle;
    page.updatedAt = nowIso();
    const needle = PAGE_LINK_PREFIX + id;
    for (const p of Object.values(pages)) {
      if (p.content.includes(needle)) p.content = updateLinkTitle(p.content, id, newTitle);
    }
    touch();
  }

  function setContent(id: string, markdown: string) {
    const page = pages[id];
    if (!page || page.content === markdown) return;
    page.content = markdown;
    page.updatedAt = nowIso();
    touch();
  }

  function setLastOpened(id: string | null) {
    if (lastOpenedPageId.value === id) return;
    lastOpenedPageId.value = id;
    revision.value++;
  }

  /** Deletes the page and all its descendants. Returns the removed ids. */
  function deletePage(id: string): string[] {
    if (!pages[id]) return [];
    const removed = subtreeIds(id);
    const siblings = siblingsOf(id);
    siblings.splice(siblings.indexOf(id), 1);
    for (const rid of removed) delete pages[rid];
    if (lastOpenedPageId.value && !pages[lastOpenedPageId.value]) lastOpenedPageId.value = null;
    touch();
    return removed;
  }

  /** Can `id` be moved under `newParentId`? (Not into itself or its own subtree.) */
  function canMove(id: string, newParentId: string | null): boolean {
    if (!pages[id]) return false;
    if (newParentId === null) return true;
    if (!pages[newParentId]) return false;
    return newParentId !== id && !isDescendant(newParentId, id);
  }

  /**
   * Moves a page to `index` within `newParentId`'s children (end when omitted).
   * `index` is a position in the list as it is before the move.
   */
  function movePage(id: string, newParentId: string | null, index?: number): boolean {
    if (!canMove(id, newParentId)) return false;
    const from = siblingsOf(id);
    const oldIndex = from.indexOf(id);
    const to = childListOf(newParentId);
    let target = index ?? to.length;
    if (from === to && oldIndex < target) target--;
    from.splice(oldIndex, 1);
    target = Math.max(0, Math.min(target, to.length));
    to.splice(target, 0, id);
    pages[id].parentId = newParentId;
    touch();
    return true;
  }

  function moveUp(id: string): boolean {
    const i = siblingsOf(id).indexOf(id);
    if (i <= 0) return false;
    return movePage(id, pages[id].parentId, i - 1);
  }

  function moveDown(id: string): boolean {
    const sibs = siblingsOf(id);
    const i = sibs.indexOf(id);
    if (i < 0 || i >= sibs.length - 1) return false;
    return movePage(id, pages[id].parentId, i + 2);
  }

  /** Makes the page the last child of its previous sibling. */
  function indent(id: string): boolean {
    const sibs = siblingsOf(id);
    const i = sibs.indexOf(id);
    if (i <= 0) return false;
    return movePage(id, sibs[i - 1]);
  }

  /** Makes the page the next sibling of its parent. */
  function outdent(id: string): boolean {
    const parentId = pages[id]?.parentId;
    if (!parentId) return false;
    const grandParentId = pages[parentId].parentId;
    const index = childListOf(grandParentId).indexOf(parentId) + 1;
    return movePage(id, grandParentId, index);
  }

  return {
    isOpen,
    filePath,
    docId,
    title,
    createdAt,
    updatedAt,
    lastOpenedPageId,
    pages,
    rootIds,
    revision,
    pageCount,
    load,
    create,
    close,
    setFilePath,
    toFile,
    siblingsOf,
    ancestors,
    isDescendant,
    subtreeIds,
    backlinks,
    orderedIds,
    createPage,
    setTitle,
    setContent,
    setLastOpened,
    deletePage,
    canMove,
    movePage,
    moveUp,
    moveDown,
    indent,
    outdent,
  };
});
