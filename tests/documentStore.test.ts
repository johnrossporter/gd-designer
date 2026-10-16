import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDocumentStore } from "../src/stores/document";
import { parseDocument, serializeDocument } from "../src/services/fileService";
import { filterPages } from "../src/lib/filter";
import { pageLinkMarkdown } from "../src/lib/pageLinks";

function setup() {
  const store = useDocumentStore();
  store.create("C:/test/world.gdd.json", "World");
  const root = store.rootIds[0];
  return { store, root };
}

describe("document store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("creates a document with one page", () => {
    const { store, root } = setup();
    expect(store.isOpen).toBe(true);
    expect(store.pageCount).toBe(1);
    expect(store.pages[root].title).toBe("World");
  });

  it("creates children and siblings in order", () => {
    const { store, root } = setup();
    const a = store.createPage({ parentId: root, title: "A" });
    const c = store.createPage({ parentId: root, title: "C" });
    const b = store.createPage({ afterId: a, title: "B" });
    expect(store.pages[root].children).toEqual([a, b, c]);
    expect(store.pages[b].parentId).toBe(root);
    expect(store.ancestors(b).map((p) => p.id)).toEqual([root]);
  });

  it("deletes a whole subtree", () => {
    const { store, root } = setup();
    const a = store.createPage({ parentId: root, title: "A" });
    const a1 = store.createPage({ parentId: a, title: "A1" });
    store.createPage({ parentId: a1, title: "A1x" });
    const removed = store.deletePage(a);
    expect(removed).toHaveLength(3);
    expect(store.pageCount).toBe(1);
    expect(store.pages[root].children).toEqual([]);
  });

  it("refuses to move a page into its own subtree", () => {
    const { store, root } = setup();
    const a = store.createPage({ parentId: root, title: "A" });
    const a1 = store.createPage({ parentId: a, title: "A1" });
    expect(store.movePage(a, a1)).toBe(false);
    expect(store.movePage(a, a)).toBe(false);
    expect(store.movePage(root, a1)).toBe(false);
    expect(store.pages[a1].parentId).toBe(a);
  });

  it("reorders, indents and outdents", () => {
    const { store, root } = setup();
    const a = store.createPage({ parentId: root, title: "A" });
    const b = store.createPage({ parentId: root, title: "B" });
    const c = store.createPage({ parentId: root, title: "C" });
    expect(store.moveUp(c)).toBe(true);
    expect(store.pages[root].children).toEqual([a, c, b]);
    expect(store.moveDown(a)).toBe(true);
    expect(store.pages[root].children).toEqual([c, a, b]);
    expect(store.indent(a)).toBe(true);
    expect(store.pages[a].parentId).toBe(c);
    expect(store.pages[root].children).toEqual([c, b]);
    expect(store.outdent(a)).toBe(true);
    expect(store.pages[root].children).toEqual([c, a, b]);
    expect(store.indent(c)).toBe(false);
  });

  it("moves within the same list using pre-move indices", () => {
    const { store, root } = setup();
    const a = store.createPage({ parentId: root, title: "A" });
    const b = store.createPage({ parentId: root, title: "B" });
    const c = store.createPage({ parentId: root, title: "C" });
    store.movePage(a, root, 3);
    expect(store.pages[root].children).toEqual([b, c, a]);
    store.movePage(a, root, 0);
    expect(store.pages[root].children).toEqual([a, b, c]);
  });

  it("updates link text everywhere when a title changes", () => {
    const { store, root } = setup();
    const target = store.createPage({ parentId: root, title: "Old Name" });
    const other = store.createPage({
      parentId: root,
      title: "Other",
      content: `Go to ${pageLinkMarkdown(target, "Old Name")} now.`,
    });
    store.setTitle(target, "New Name");
    expect(store.pages[other].content).toBe(`Go to ${pageLinkMarkdown(target, "New Name")} now.`);
    expect(store.backlinks(target).map((p) => p.id)).toEqual([other]);
  });

  it("round-trips through the JSON file format", () => {
    const { store, root } = setup();
    const a = store.createPage({ parentId: root, title: "A", content: "# Hi\n\n**bold**" });
    store.createPage({ parentId: a, title: "A1" });
    store.setLastOpened(a);
    const json = serializeDocument(store.toFile());
    expect(json).toContain('"format": "gddesigner"');

    setActivePinia(createPinia());
    const copy = useDocumentStore();
    copy.load(parseDocument(json), "C:/test/world.gdd.json");
    expect(copy.toFile()).toEqual(store.toFile());
    expect(copy.lastOpenedPageId).toBe(a);
  });

  it("repairs stale link text when loading", () => {
    const { store, root } = setup();
    const target = store.createPage({ parentId: root, title: "Real" });
    const file = store.toFile();
    file.pages[0].content = `[Stale](gdd://page/${target})`;
    store.load(file, null);
    expect(store.pages[root].content).toBe(pageLinkMarkdown(target, "Real"));
  });

  it("rejects files that are not GDDesigner documents", () => {
    expect(() => parseDocument("{}")).toThrow();
    expect(() => parseDocument("not json")).toThrow();
    expect(() => parseDocument(JSON.stringify({ format: "gddesigner", version: 99, pages: [] }))).toThrow();
  });
});

describe("filterPages", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows matches with their ancestors", () => {
    const { store, root } = setup();
    const places = store.createPage({ parentId: root, title: "Places" });
    const city = store.createPage({ parentId: places, title: "Capital City" });
    store.createPage({ parentId: root, title: "Characters" });
    const result = filterPages(store.pages, "capital")!;
    expect([...result.matches]).toEqual([city]);
    expect(result.visible).toEqual(new Set([city, places, root]));
    expect(filterPages(store.pages, "  ")).toBeNull();
  });
});
