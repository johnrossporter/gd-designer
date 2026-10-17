import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDocumentStore } from "../src/stores/document";
import { useUiStore } from "../src/stores/ui";
import { handleMcpMessage } from "../src/mcp/handler";
import { pageLinkMarkdown } from "../src/lib/pageLinks";

let nextId = 1;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = (await handleMcpMessage({ jsonrpc: "2.0", id: nextId++, method, params })) as any;
  return res;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await rpc("tools/call", { name, arguments: args });
  if (res.error) throw new Error(res.error.message);
  const text = res.result.content[0].text as string;
  return { isError: res.result.isError as boolean, text, json: () => JSON.parse(text) };
}

function setup() {
  const doc = useDocumentStore();
  doc.create("C:/t/world.gdd.json", "World");
  const root = doc.rootIds[0];
  const places = doc.createPage({ parentId: root, title: "Places" });
  const city = doc.createPage({ parentId: places, title: "Capital City", content: "The seat of power." });
  return { doc, root, places, city };
}

describe("MCP handler", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("negotiates the protocol and lists tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t" } });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();
    const unknown = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(unknown.result.protocolVersion).toBe("2025-11-25");

    const tools = await rpc("tools/list");
    const names = tools.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["list_pages", "search_pages", "get_page", "create_page", "update_page", "move_page", "delete_page"]);
    expect(tools.result.tools[0].run).toBeUndefined();
  });

  it("ignores notifications and rejects unknown methods", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const res = await rpc("no/such");
    expect(res.error.code).toBe(-32601);
    const bad = (await handleMcpMessage({ foo: 1 })) as any;
    expect(bad.error.code).toBe(-32600);
  });

  it("reports a tool error when no document is open", async () => {
    const r = await call("list_pages");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No document is open/);
  });

  it("lists, searches and reads pages", async () => {
    const { city, places } = setup();
    const list = await call("list_pages");
    expect(list.text).toContain(`    - Capital City [${city}]`);
    expect((await call("list_pages", { root_id: places, max_depth: 0 })).text).not.toContain("Capital City");

    const search = (await call("search_pages", { query: "seat" })).json();
    expect(search.results[0]).toMatchObject({ id: city, matched: "content", path: "World / Places / Capital City" });

    const page = (await call("get_page", { id: city })).json();
    expect(page).toMatchObject({ title: "Capital City", content: "The seat of power.", parent: { id: places } });
    expect((await call("get_page", { id: "nope" })).isError).toBe(true);
  });

  it("creates pages with corrected link text", async () => {
    const { doc, places, city } = setup();
    const r = (
      await call("create_page", {
        title: "Harbor",
        parent_id: places,
        content: `Near [wrong text](gdd://page/${city}).`,
      })
    ).json();
    expect(doc.pages[r.id].parentId).toBe(places);
    expect(doc.pages[r.id].content).toBe(`Near ${pageLinkMarkdown(city, "Capital City")}.`);
    expect(useUiStore().mcpActivity?.text).toContain("Harbor");
  });

  it("updates titles (syncing links) and content", async () => {
    const { doc, city, places } = setup();
    doc.setContent(places, `See ${pageLinkMarkdown(city, "Capital City")}`);
    await call("update_page", { id: city, title: "Skyhold" });
    expect(doc.pages[places].content).toBe(`See ${pageLinkMarkdown(city, "Skyhold")}`);

    await call("update_page", { id: city, append: "## History" });
    expect(doc.pages[city].content).toBe("The seat of power.\n\n## History");
    await call("update_page", { id: city, content: "New body" });
    expect(doc.pages[city].content).toBe("New body");
    expect((await call("update_page", { id: city })).isError).toBe(true);
  });

  it("moves pages using final indices and refuses cycles", async () => {
    const { doc, root, places, city } = setup();
    const chars = doc.createPage({ parentId: root, title: "Characters" });
    await call("move_page", { id: places, parent_id: root, index: 1 });
    expect(doc.pages[root].children).toEqual([chars, places]);
    await call("move_page", { id: city, parent_id: null });
    expect(doc.rootIds).toEqual([root, city]);
    expect((await call("move_page", { id: root, parent_id: places })).isError).toBe(true);
  });

  it("deletes a page subtree and moves off the deleted active page", async () => {
    const { doc, root, places, city } = setup();
    useUiStore().activePageId = city;
    const r = (await call("delete_page", { id: places })).json();
    expect(r.deleted).toBe(2);
    expect(doc.pages[city]).toBeUndefined();
    expect(useUiStore().activePageId).toBe(root);
  });

  it("exposes pages as resources", async () => {
    const { city } = setup();
    const list = await rpc("resources/list");
    expect(list.result.resources.map((r: { uri: string }) => r.uri)).toContain(`gdd://page/${city}`);
    const read = await rpc("resources/read", { uri: `gdd://page/${city}` });
    expect(read.result.contents[0].text).toBe("# Capital City\n\nThe seat of power.");
    expect((await rpc("resources/read", { uri: "gdd://page/x" })).error.code).toBe(-32002);
  });
});
