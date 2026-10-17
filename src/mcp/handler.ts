import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { removePage } from "../services/actions";
import { displayTitle, pageUrl, parsePageUrl, syncLinkTitles } from "../lib/pageLinks";
import type { Page } from "../types/document";

/**
 * MCP (Model Context Protocol) server logic. Messages arrive from the Rust
 * HTTP transport (`src-tauri/src/mcp.rs`) and are answered against the live
 * document store, so agent edits behave exactly like edits made in the UI:
 * page links stay in sync, the hierarchy updates and autosave writes the file.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `GDDesigner is a hierarchical notebook for writing and world building, open on the user's desktop.
A document is a tree of pages; each page has a unique id, a title and Markdown content.
Start with list_pages to see the hierarchy, then get_page to read a page.
To link to another page, write a Markdown link whose URL is gdd://page/<id>, e.g. [Capital City](gdd://page/1b2c...).
The link text is replaced with the target page's current title automatically.
Changes are saved to disk automatically and appear in the app immediately.`;

// ------------------------------------------------------------------ JSON-RPC

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

/** A failure the agent should see as a tool error (isError) rather than a protocol error. */
class ToolError extends Error {}

/** Handles one JSON-RPC message (or batch). Returns null when no response is due. */
export async function handleMcpMessage(message: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(message)) {
    const out = (await Promise.all(message.map((m) => handleOne(m)))).filter((r): r is JsonRpcResponse => !!r);
    return out.length ? out : null;
  }
  return handleOne(message);
}

async function handleOne(raw: unknown): Promise<JsonRpcResponse | null> {
  const msg = raw as Partial<JsonRpcRequest>;
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } };
  }
  const isNotification = msg.id === undefined;
  const id = msg.id ?? null;
  try {
    const result = await dispatch(msg.method, msg.params ?? {});
    return isNotification ? null : { jsonrpc: "2.0", id, result };
  } catch (e) {
    if (isNotification) return null;
    const code = e instanceof RpcError ? e.code : -32603;
    return { jsonrpc: "2.0", id, error: { code, message: e instanceof Error ? e.message : String(e) } };
  }
}

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const requested = String(params.protocolVersion ?? "");
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: "gddesigner", title: "GDDesigner", version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(({ run: _run, ...def }) => def) };
    case "tools/call":
      return callTool(String(params.name ?? ""), (params.arguments as Record<string, unknown>) ?? {});
    case "resources/list":
      return listResources();
    case "resources/templates/list":
      return {
        resourceTemplates: [
          {
            uriTemplate: "gdd://page/{id}",
            name: "page",
            title: "GDDesigner page",
            description: "A page's title and Markdown content",
            mimeType: "text/markdown",
          },
        ],
      };
    case "resources/read":
      return readResource(String(params.uri ?? ""));
    case "prompts/list":
      return { prompts: [] };
    default:
      if (method.startsWith("notifications/")) return {};
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

// ------------------------------------------------------------------ helpers

function stores() {
  return { doc: useDocumentStore(), ui: useUiStore() };
}

function requireDoc() {
  const { doc } = stores();
  if (!doc.isOpen) throw new ToolError("No document is open in GDDesigner. Ask the user to open or create one.");
  return doc;
}

function requirePage(id: unknown): Page {
  const doc = requireDoc();
  const key = typeof id === "string" ? (parsePageUrl(id) ?? id.trim()) : "";
  const page = doc.pages[key];
  if (!page) throw new ToolError(`No page with id "${String(id)}". Use list_pages or search_pages to find ids.`);
  return page;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ToolError(`"${key}" must be a string.`);
  return v;
}

function pathOf(id: string): string {
  const { doc } = stores();
  return [...doc.ancestors(id), doc.pages[id]]
    .map((p) => displayTitle(p.title))
    .join(" / ");
}

function summary(p: Page) {
  return { id: p.id, title: displayTitle(p.title) };
}

/** Corrects the text of page links the agent wrote so it matches current titles. */
function normalizeContent(markdown: string): string {
  const { doc } = stores();
  return syncLinkTitles(markdown.replace(/\r\n/g, "\n"), (id) => doc.pages[id]?.title);
}

function noteActivity(text: string) {
  const { ui } = stores();
  ui.mcpActivity = { text, at: Date.now() };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ------------------------------------------------------------------ tools

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (args: Record<string, unknown>) => string | Promise<string>;
}

const idProp = { type: "string", description: "Page id (a UUID)." };

const TOOLS: ToolDef[] = [
  {
    name: "list_pages",
    title: "List pages",
    description:
      "Shows the open document's page hierarchy as an indented outline with each page's id. " +
      "Optionally start from one page and/or limit the depth.",
    inputSchema: {
      type: "object",
      properties: {
        root_id: { ...idProp, description: "Only list this page and its descendants." },
        max_depth: { type: "integer", minimum: 0, description: "How many levels below the root to include." },
      },
    },
    annotations: { readOnlyHint: true },
    run: (args) => {
      const doc = requireDoc();
      const maxDepth = typeof args.max_depth === "number" ? args.max_depth : Infinity;
      const lines: string[] = [];
      const walk = (ids: string[], depth: number) => {
        for (const id of ids) {
          const p = doc.pages[id];
          if (!p) continue;
          lines.push(`${"  ".repeat(depth)}- ${displayTitle(p.title)} [${p.id}]`);
          if (depth < maxDepth) walk(p.children, depth + 1);
        }
      };
      if (args.root_id !== undefined) walk([requirePage(args.root_id).id], 0);
      else walk(doc.rootIds, 0);
      const header = `Document: ${doc.title || "Untitled"} (${doc.pageCount} pages)\nFile: ${doc.filePath ?? "(unsaved)"}\n`;
      return `${header}\n${lines.join("\n") || "(no pages)"}`;
    },
  },
  {
    name: "search_pages",
    title: "Search pages",
    description: "Finds pages whose title (and optionally content) contains the query, case-insensitively.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for." },
        include_content: { type: "boolean", description: "Also search page content. Default true." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum results. Default 25." },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
    run: (args) => {
      const doc = requireDoc();
      const q = (optionalString(args, "query") ?? "").trim().toLowerCase();
      if (!q) throw new ToolError("query must not be empty.");
      const inContent = args.include_content !== false;
      const limit = typeof args.limit === "number" ? args.limit : 25;
      const results = [];
      for (const id of doc.orderedIds()) {
        const p = doc.pages[id];
        const titleHit = p.title.toLowerCase().includes(q);
        const at = inContent ? p.content.toLowerCase().indexOf(q) : -1;
        if (!titleHit && at < 0) continue;
        const snippet =
          at >= 0
            ? (at > 60 ? "…" : "") +
              p.content.slice(Math.max(0, at - 60), at + q.length + 60).replace(/\s+/g, " ") +
              (at + q.length + 60 < p.content.length ? "…" : "")
            : undefined;
        results.push({ ...summary(p), path: pathOf(id), matched: titleHit ? "title" : "content", snippet });
        if (results.length >= limit) break;
      }
      return json({ count: results.length, results });
    },
  },
  {
    name: "get_page",
    title: "Get page",
    description:
      "Returns a page's title, Markdown content, location in the hierarchy, sub-pages and the pages that link to it.",
    inputSchema: { type: "object", properties: { id: idProp }, required: ["id"] },
    annotations: { readOnlyHint: true },
    run: (args) => {
      const doc = requireDoc();
      const p = requirePage(args.id);
      return json({
        id: p.id,
        title: p.title,
        path: pathOf(p.id),
        parent: p.parentId ? summary(doc.pages[p.parentId]) : null,
        children: p.children.map((c) => summary(doc.pages[c])),
        linked_from: doc.backlinks(p.id).map(summary),
        link_markdown: `[${displayTitle(p.title)}](${pageUrl(p.id)})`,
        updated_at: p.updatedAt,
        content: p.content,
      });
    },
  },
  {
    name: "create_page",
    title: "Create page",
    description:
      "Creates a page. Give parent_id to make it a sub-page (added last), or after_id to place it right after a sibling; " +
      "with neither it becomes a top-level page. Content is Markdown; link pages with [Title](gdd://page/<id>).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Page title." },
        content: { type: "string", description: "Markdown content." },
        parent_id: { ...idProp, description: "Parent page id." },
        after_id: { ...idProp, description: "Insert as the next sibling of this page." },
      },
      required: ["title"],
    },
    run: (args) => {
      const doc = requireDoc();
      const { ui } = stores();
      const title = optionalString(args, "title") ?? "";
      const parentId = args.parent_id !== undefined ? requirePage(args.parent_id).id : null;
      const afterId = args.after_id !== undefined ? requirePage(args.after_id).id : null;
      const id = doc.createPage({ title, parentId, afterId, content: normalizeContent(optionalString(args, "content") ?? "") });
      const newParent = doc.pages[id].parentId;
      if (newParent) ui.setExpanded(newParent, true);
      noteActivity(`Created “${displayTitle(title)}”`);
      return json({ id, title, path: pathOf(id), link_markdown: `[${displayTitle(title)}](${pageUrl(id)})` });
    },
  },
  {
    name: "update_page",
    title: "Update page",
    description:
      "Changes a page's title and/or content. `content` replaces the whole Markdown body; `append` adds Markdown " +
      "to the end. Renaming a page updates every link to it.",
    inputSchema: {
      type: "object",
      properties: {
        id: idProp,
        title: { type: "string", description: "New title." },
        content: { type: "string", description: "New Markdown content (replaces the existing content)." },
        append: { type: "string", description: "Markdown to add after the existing content." },
      },
      required: ["id"],
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    run: (args) => {
      const doc = requireDoc();
      const p = requirePage(args.id);
      const title = optionalString(args, "title");
      const content = optionalString(args, "content");
      const append = optionalString(args, "append");
      if (title === undefined && content === undefined && append === undefined) {
        throw new ToolError("Nothing to change: give title, content or append.");
      }
      if (content !== undefined && append !== undefined) throw new ToolError("Use either content or append, not both.");
      if (title !== undefined) doc.setTitle(p.id, title.replace(/[\r\n]+/g, " "));
      if (content !== undefined) doc.setContent(p.id, normalizeContent(content));
      if (append !== undefined) {
        const base = p.content.replace(/\s+$/, "");
        doc.setContent(p.id, normalizeContent(base ? `${base}\n\n${append}` : append));
      }
      noteActivity(`Edited “${displayTitle(doc.pages[p.id].title)}”`);
      return json({ id: p.id, title: doc.pages[p.id].title, updated: true });
    },
  },
  {
    name: "move_page",
    title: "Move page",
    description:
      "Moves a page (with its sub-pages) under a new parent, or to the top level when parent_id is null. " +
      "index is the position among the new siblings (0 = first); omit it to add at the end.",
    inputSchema: {
      type: "object",
      properties: {
        id: idProp,
        parent_id: { type: ["string", "null"], description: "New parent page id, or null for top level." },
        index: { type: "integer", minimum: 0, description: "Position among the new siblings." },
      },
      required: ["id", "parent_id"],
    },
    run: (args) => {
      const doc = requireDoc();
      const { ui } = stores();
      const p = requirePage(args.id);
      const parentId = args.parent_id === null ? null : requirePage(args.parent_id).id;
      let index = typeof args.index === "number" ? args.index : undefined;
      // Indices are as the agent sees the final list; movePage expects pre-move positions.
      if (index !== undefined && p.parentId === parentId && doc.siblingsOf(p.id).indexOf(p.id) < index) index++;
      if (!doc.movePage(p.id, parentId, index)) {
        throw new ToolError("A page cannot be moved inside itself or one of its own sub-pages.");
      }
      if (parentId) ui.setExpanded(parentId, true);
      noteActivity(`Moved “${displayTitle(p.title)}”`);
      return json({ id: p.id, path: pathOf(p.id) });
    },
  },
  {
    name: "delete_page",
    title: "Delete page",
    description: "Permanently deletes a page and all of its sub-pages. Links to them stay in other pages as broken links.",
    inputSchema: { type: "object", properties: { id: idProp }, required: ["id"] },
    annotations: { destructiveHint: true },
    run: (args) => {
      const p = requirePage(args.id);
      const title = displayTitle(p.title);
      const removed = removePage(p.id);
      noteActivity(`Deleted “${title}”`);
      return json({ deleted: removed.length, ids: removed });
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new RpcError(-32602, `Unknown tool: ${name}`);
  try {
    const text = await tool.run(args);
    return { content: [{ type: "text", text }], isError: false };
  } catch (e) {
    if (e instanceof ToolError) return { content: [{ type: "text", text: e.message }], isError: true };
    throw e;
  }
}

// ------------------------------------------------------------------ resources

function listResources() {
  const { doc } = stores();
  if (!doc.isOpen) return { resources: [] };
  return {
    resources: doc.orderedIds().map((id) => ({
      uri: pageUrl(id),
      name: displayTitle(doc.pages[id].title),
      description: pathOf(id),
      mimeType: "text/markdown",
    })),
  };
}

function readResource(uri: string) {
  const id = parsePageUrl(uri);
  const { doc } = stores();
  const page = id && doc.isOpen ? doc.pages[id] : undefined;
  if (!page) throw new RpcError(-32002, `Resource not found: ${uri}`);
  return {
    contents: [{ uri, mimeType: "text/markdown", text: `# ${displayTitle(page.title)}\n\n${page.content}` }],
  };
}
