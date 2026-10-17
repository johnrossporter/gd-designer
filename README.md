# GDDesigner

A desktop app for writing, note-taking and world building, in the spirit of OneNote.
Documents are made of **pages** (a title plus rich-text content stored as Markdown)
arranged in a hierarchy of any depth. Pages can link to each other, and every change
is saved automatically to a human-readable `.gdd.json` file.

Built with [Tauri 2](https://tauri.app), [Vue 3](https://vuejs.org) + TypeScript,
[Pinia](https://pinia.vuejs.org) and the [Milkdown](https://milkdown.dev) (Crepe) Markdown editor.

## Features

- **Menu bar**: File, Edit, Page, View and Help menus with keyboard shortcuts (Alt+letter opens a menu).
- **Hierarchy pane**: the page tree, with a filter box at the top. Click a page to open it,
  drag pages to reorder or nest them, right-click for more actions, double-click (or F2) to rename.
  The pane can be resized or hidden (Ctrl+\\).
- **Page view**: breadcrumb, title, a WYSIWYG Markdown editor (headings, lists, checklists,
  tables, code blocks, images, quotes; select text for the formatting toolbar, type `/` for the
  block menu), plus sub-page and "linked from" lists.
- **Page links**: type `[[` or press Ctrl+L to pick a page, or drag a page from the hierarchy into
  the text. Links point at the page's id, show its current title, and update when it is renamed.
  Links to deleted pages show struck through.
- **Autosave**: changes are written about 0.75 s after you stop typing, and before switching
  documents or closing the window. The status bar shows the save state.
- Light, dark and system themes; zoom; reopens the last document and page on launch.
- **AI agent access (MCP)**: Tools > AI Agent Access lets agents such as Claude Code read and edit
  the open document over the Model Context Protocol (see below).

## AI agent access (MCP)

When enabled (Tools > AI Agent Access), GDDesigner serves an MCP endpoint at
`http://127.0.0.1:3917/mcp` (Streamable HTTP, JSON responses) while the app is running. It only
listens on this computer and requires the bearer token shown in that dialog. To connect Claude Code,
copy the command from the dialog, which looks like:

```bash
claude mcp add --transport http gddesigner http://127.0.0.1:3917/mcp --header "Authorization: Bearer <token>"
```

Tools: `list_pages`, `search_pages`, `get_page`, `create_page`, `update_page` (title, replace or
append content), `move_page` and `delete_page`. Pages are also exposed as `gdd://page/{id}`
resources. Agent edits go through the same document model as the UI, so they appear immediately,
keep page links in sync and are autosaved. The Rust side (`src-tauri/src/mcp.rs`) is only the HTTP
transport; the protocol and tools live in `src/mcp/handler.ts`.

## Development

Prerequisites (Windows): Node.js 20+, Rust (via [rustup](https://rustup.rs)), the MSVC C++ build
tools and WebView2 (included with Windows 11). See <https://tauri.app/start/prerequisites/>.

```bash
npm install
npm run tauri dev       # run the desktop app with hot reload
npm test                # unit tests (Vitest)
npm run tauri build     # build the release app and Windows installers
```

`npm run dev` serves the UI alone at <http://localhost:1420> for quick previews in a browser. In
that mode documents are kept in the browser's localStorage instead of on disk.

## File format

A document is one UTF-8 JSON file (`*.gdd.json`), indented for readability. Pages are nested in
the same shape as the hierarchy:

```json
{
  "format": "gddesigner",
  "version": 1,
  "id": "5b1e…",
  "title": "My World",
  "createdAt": "2026-10-16T21:00:00.000Z",
  "updatedAt": "2026-10-16T21:05:00.000Z",
  "lastOpenedPageId": "a7c2…",
  "pages": [
    {
      "id": "a7c2…",
      "title": "Places",
      "content": "The capital is [Skyhold](gdd://page/93fd…).",
      "createdAt": "…",
      "updatedAt": "…",
      "children": []
    }
  ]
}
```

- `id` values are UUIDs and never change.
- `content` is Markdown. A link to another page is an ordinary Markdown link whose URL is
  `gdd://page/<id>`; its text is the target page's title and is rewritten when that title changes
  (it is also re-synced when the file is opened, so hand edits are safe).
- Files are written atomically (to `<file>.tmp`, then renamed over the original).

## Project layout

| Path | Purpose |
| --- | --- |
| `src-tauri/src/lib.rs` | Rust commands for reading/writing documents; plugin setup |
| `src-tauri/icons/app-icon.svg` | App icon source; regenerate the sizes with `npx tauri icon src-tauri/icons/app-icon.svg` |
| `src/stores/document.ts` | Document model: pages, hierarchy edits, title/link sync |
| `src/stores/ui.ts` | UI state: active page, filter, dialogs, preferences |
| `src/services/actions.ts` | Every user command (used by menus, shortcuts and buttons) |
| `src/services/autosave.ts` | Debounced saving |
| `src/services/fileService.ts` | File IO, dialogs, JSON (de)serialisation and validation |
| `src/editor/` | Milkdown editor component and the page-link plugin |
| `src/components/` | Menu bar, hierarchy pane, page view, picker, dialogs |
| `tests/` | Vitest unit tests |
