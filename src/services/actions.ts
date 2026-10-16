import { nextTick } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { activeEditor } from "../editor/bridge";
import { displayTitle } from "../lib/pageLinks";
import { flushSave, markSaved } from "./autosave";
import {
  fileExists,
  pickDocumentSavePath,
  pickDocumentToOpen,
  pickMarkdownSavePath,
  readClipboardText,
  readDocument,
  revealInExplorer,
  showError,
  writeDocument,
  writeTextFile,
} from "./fileService";
import { baseName, isTauri } from "./platform";
import { saveSetting, withRecent, type ThemeSetting } from "./settings";

/**
 * Every user-facing command lives here so the menu bar, keyboard shortcuts,
 * context menus and buttons all behave the same way.
 */

function stores() {
  return { doc: useDocumentStore(), ui: useUiStore() };
}

// ------------------------------------------------------------------ documents

async function rememberFile(path: string) {
  const { ui } = stores();
  ui.recentFiles = withRecent(ui.recentFiles, path);
  await Promise.all([saveSetting("recentFiles", ui.recentFiles), saveSetting("lastFile", path)]);
}

async function forgetFile(path: string) {
  const { ui } = stores();
  ui.recentFiles = ui.recentFiles.filter((p) => p !== path);
  await saveSetting("recentFiles", ui.recentFiles);
}

async function closeCurrent(): Promise<boolean> {
  const { doc, ui } = stores();
  if (!doc.isOpen) return true;
  const ok = await flushSave();
  if (!ok) {
    const discard = await ui.confirm({
      title: "Unsaved changes",
      message: `The document could not be saved (${ui.saveError}). Close it anyway and lose recent changes?`,
      okLabel: "Close anyway",
      danger: true,
    });
    if (!discard) return false;
  }
  return true;
}

function showFirstPage() {
  const { doc, ui } = stores();
  ui.resetForDocument();
  const id = doc.lastOpenedPageId ?? doc.rootIds[0] ?? null;
  if (id) openPage(id);
}

export async function openDocumentAt(path: string, opts: { silent?: boolean } = {}): Promise<boolean> {
  const { doc } = stores();
  if (!(await closeCurrent())) return false;
  try {
    const file = await readDocument(path);
    doc.load(file, path);
    markSaved();
    showFirstPage();
    await rememberFile(path);
    return true;
  } catch (e) {
    if (!opts.silent) await showError(`Could not open ${path}\n\n${e instanceof Error ? e.message : e}`);
    if (!(await fileExists(path).catch(() => false))) await forgetFile(path);
    return false;
  }
}

export async function newDocument() {
  const { doc } = stores();
  const path = await pickDocumentSavePath("Untitled");
  if (!path) return;
  if (!(await closeCurrent())) return;
  doc.create(path, baseName(path));
  try {
    await writeDocument(path, doc.toFile());
    markSaved();
  } catch (e) {
    await showError(`Could not create ${path}\n\n${e instanceof Error ? e.message : e}`);
    doc.close();
    return;
  }
  showFirstPage();
  await rememberFile(path);
  const { ui } = stores();
  await nextTick();
  ui.focusTitleTick++;
}

export async function openDocument() {
  const path = await pickDocumentToOpen();
  if (path) await openDocumentAt(path);
}

export async function saveDocumentAs() {
  const { doc } = stores();
  if (!doc.isOpen) return;
  activeEditor()?.flush();
  const path = await pickDocumentSavePath(doc.title || "Untitled");
  if (!path) return;
  const oldTitle = doc.filePath ? baseName(doc.filePath) : "";
  // Keep the document title in step with the file name unless it was customised.
  const newTitle = !doc.title || doc.title === oldTitle ? baseName(path) : doc.title;
  doc.setFilePath(path, newTitle);
  await flushSave();
  await rememberFile(path);
}

export async function closeDocument() {
  const { doc, ui } = stores();
  if (!(await closeCurrent())) return;
  doc.close();
  ui.resetForDocument();
  await saveSetting("lastFile", null);
}

export async function exportActivePage() {
  const { doc, ui } = stores();
  const page = ui.activePageId ? doc.pages[ui.activePageId] : null;
  if (!page) return;
  activeEditor()?.flush();
  const path = await pickMarkdownSavePath(displayTitle(page.title).replace(/[\\/:*?"<>|]/g, "_"));
  if (!path) return;
  try {
    await writeTextFile(path, `# ${displayTitle(page.title)}\n\n${page.content}\n`);
  } catch (e) {
    await showError(`Could not export the page.\n\n${e instanceof Error ? e.message : e}`);
  }
}

export async function revealDocument() {
  const { doc } = stores();
  if (doc.filePath) await revealInExplorer(doc.filePath);
}

export async function exitApp() {
  if (!(await closeCurrent())) return;
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  } else {
    window.close();
  }
}

// ------------------------------------------------------------------ pages

export function openPage(id: string) {
  const { doc, ui } = stores();
  if (!doc.pages[id]) return;
  if (ui.activePageId && ui.activePageId !== id) activeEditor()?.flush();
  for (const a of doc.ancestors(id)) ui.setExpanded(a.id, true);
  ui.activePageId = id;
  doc.setLastOpened(id);
}

/** The page that commands like "New Child Page" act on. */
function targetPage(id?: string): string | null {
  const { doc, ui } = stores();
  const target = id ?? ui.activePageId;
  return target && doc.pages[target] ? target : null;
}

async function createAndOpen(opts: { parentId?: string | null; afterId?: string | null }) {
  const { doc, ui } = stores();
  const id = doc.createPage(opts);
  if (opts.parentId) ui.setExpanded(opts.parentId, true);
  ui.filter = "";
  openPage(id);
  await nextTick();
  ui.focusTitleTick++;
  return id;
}

export function newPage(afterId?: string) {
  const { doc } = stores();
  if (!doc.isOpen) return;
  const after = targetPage(afterId);
  return createAndOpen(after ? { afterId: after } : { parentId: null });
}

export function newChildPage(parentId?: string) {
  const { doc } = stores();
  if (!doc.isOpen) return;
  return createAndOpen({ parentId: targetPage(parentId) });
}

export function newTopLevelPage() {
  const { doc } = stores();
  if (!doc.isOpen) return;
  return createAndOpen({ parentId: null });
}

export function renamePage(id?: string) {
  const { ui } = stores();
  const target = targetPage(id);
  if (!target) return;
  if (!ui.hierarchyVisible) {
    openPage(target);
    ui.focusTitleTick++;
    return;
  }
  ui.filter = "";
  openPage(target);
  ui.renamingId = target;
}

export async function deletePage(id?: string) {
  const { doc, ui } = stores();
  const target = targetPage(id);
  if (!target) return;
  const page = doc.pages[target];
  const count = doc.subtreeIds(target).length;
  const ok = await ui.confirm({
    title: "Delete page",
    message:
      count > 1
        ? `Delete "${displayTitle(page.title)}" and its ${count - 1} sub-page${count > 2 ? "s" : ""}? This cannot be undone.`
        : `Delete "${displayTitle(page.title)}"? This cannot be undone.`,
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;

  // Pick the page to show afterwards: next sibling, else previous, else parent.
  const sibs = doc.siblingsOf(target);
  const i = sibs.indexOf(target);
  const next = sibs[i + 1] ?? sibs[i - 1] ?? page.parentId;
  const removed = new Set(doc.deletePage(target));
  if (ui.activePageId && removed.has(ui.activePageId)) {
    ui.activePageId = null;
    if (next) openPage(next);
    else if (doc.rootIds[0]) openPage(doc.rootIds[0]);
  }
}

export function movePageUp(id?: string) {
  const t = targetPage(id);
  if (t) stores().doc.moveUp(t);
}

export function movePageDown(id?: string) {
  const t = targetPage(id);
  if (t) stores().doc.moveDown(t);
}

export function indentPage(id?: string) {
  const { doc, ui } = stores();
  const t = targetPage(id);
  if (t && doc.indent(t)) ui.setExpanded(doc.pages[t].parentId!, true);
}

export function outdentPage(id?: string) {
  const t = targetPage(id);
  if (t) stores().doc.outdent(t);
}

export function insertPageLink() {
  const { doc, ui } = stores();
  if (!doc.isOpen || !ui.activePageId) return;
  ui.picker = "insert-link";
}

export function goToPage() {
  const { doc, ui } = stores();
  if (!doc.isOpen) return;
  ui.picker = "go-to";
}

export function focusFilter() {
  const { ui } = stores();
  if (!ui.hierarchyVisible) toggleHierarchy();
  ui.focusFilterTick++;
}

// ------------------------------------------------------------------ edit

function focusedTextInput(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
}

export function undo() {
  if (focusedTextInput()) document.execCommand("undo");
  else activeEditor()?.undo();
}

export function redo() {
  if (focusedTextInput()) document.execCommand("redo");
  else activeEditor()?.redo();
}

export function cut() {
  document.execCommand("cut");
}

export function copy() {
  document.execCommand("copy");
}

export async function paste() {
  let text = "";
  try {
    text = await readClipboardText();
  } catch {
    return;
  }
  if (!text) return;
  if (focusedTextInput()) {
    document.execCommand("insertText", false, text);
    return;
  }
  activeEditor()?.insertMarkdown(text);
}

export function selectAll() {
  const input = focusedTextInput();
  if (input) input.select();
  else activeEditor()?.selectAll();
}

// ------------------------------------------------------------------ view

export function toggleHierarchy() {
  const { ui } = stores();
  ui.hierarchyVisible = !ui.hierarchyVisible;
  void saveSetting("hierarchyVisible", ui.hierarchyVisible);
}

export function expandAll() {
  const { doc, ui } = stores();
  for (const p of Object.values(doc.pages)) if (p.children.length) ui.setExpanded(p.id, true);
}

export function collapseAll() {
  const { ui } = stores();
  for (const id of Object.keys(ui.expanded)) ui.setExpanded(id, false);
}

export function setTheme(theme: ThemeSetting) {
  const { ui } = stores();
  ui.theme = theme;
  void saveSetting("theme", theme);
}

const ZOOM_STEPS = [0.75, 0.85, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

function setZoom(z: number) {
  const { ui } = stores();
  ui.zoom = z;
  void saveSetting("zoom", z);
}

export function zoomIn() {
  const { ui } = stores();
  setZoom(ZOOM_STEPS.find((s) => s > ui.zoom + 0.001) ?? ui.zoom);
}

export function zoomOut() {
  const { ui } = stores();
  setZoom([...ZOOM_STEPS].reverse().find((s) => s < ui.zoom - 0.001) ?? ui.zoom);
}

export function zoomReset() {
  setZoom(1);
}

export function showAbout() {
  stores().ui.aboutOpen = true;
}

export function showShortcuts() {
  stores().ui.shortcutsOpen = true;
}
