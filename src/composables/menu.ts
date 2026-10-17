import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import * as A from "../services/actions";
import { baseName, isTauri } from "../services/platform";

export interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => unknown;
  disabled?: boolean;
  checked?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
  /** Keep focus/selection where it is when clicked (Edit commands). */
  keepFocus?: boolean;
}

export interface Menu {
  label: string;
  /** Alt+<mnemonic> opens the menu. */
  mnemonic: string;
  items: () => MenuItem[];
}

const sep: MenuItem = { separator: true };

/** Builds the menu bar contents. Item lists are functions so state is current when opened. */
export function buildMenus(): Menu[] {
  const doc = useDocumentStore();
  const ui = useUiStore();
  const noDoc = () => !doc.isOpen;
  const noPage = () => !doc.isOpen || !ui.activePageId;

  return [
    {
      label: "File",
      mnemonic: "f",
      items: () => [
        { label: "New Document…", shortcut: "Ctrl+N", action: A.newDocument },
        { label: "Open…", shortcut: "Ctrl+O", action: A.openDocument },
        {
          label: "Open Recent",
          disabled: ui.recentFiles.length === 0,
          submenu: ui.recentFiles.map((path) => ({
            label: `${baseName(path)}  —  ${path}`,
            action: () => A.openDocumentAt(path),
          })),
        },
        sep,
        { label: "Save As…", shortcut: "Ctrl+Shift+S", action: A.saveDocumentAs, disabled: noDoc() },
        { label: "Export Page as Markdown…", action: A.exportActivePage, disabled: noPage() },
        { label: "Show in Explorer", action: A.revealDocument, disabled: noDoc() || !isTauri },
        sep,
        { label: "Close Document", shortcut: "Ctrl+W", action: A.closeDocument, disabled: noDoc() },
        { label: "Exit", shortcut: "Alt+F4", action: A.exitApp },
      ],
    },
    {
      label: "Edit",
      mnemonic: "e",
      items: () => [
        { label: "Undo", shortcut: "Ctrl+Z", action: A.undo, disabled: noPage(), keepFocus: true },
        { label: "Redo", shortcut: "Ctrl+Y", action: A.redo, disabled: noPage(), keepFocus: true },
        sep,
        { label: "Cut", shortcut: "Ctrl+X", action: A.cut, keepFocus: true },
        { label: "Copy", shortcut: "Ctrl+C", action: A.copy, keepFocus: true },
        { label: "Paste", shortcut: "Ctrl+V", action: A.paste, keepFocus: true },
        { label: "Select All", shortcut: "Ctrl+A", action: A.selectAll, keepFocus: true },
        sep,
        { label: "Filter Pages", shortcut: "Ctrl+F", action: A.focusFilter, disabled: noDoc() },
        { label: "Go to Page…", shortcut: "Ctrl+P", action: A.goToPage, disabled: noDoc() },
      ],
    },
    {
      label: "Page",
      mnemonic: "p",
      items: () => [
        { label: "New Page", shortcut: "Ctrl+Shift+N", action: () => A.newPage(), disabled: noDoc() },
        { label: "New Child Page", shortcut: "Ctrl+Alt+N", action: () => A.newChildPage(), disabled: noPage() },
        { label: "New Top-Level Page", action: A.newTopLevelPage, disabled: noDoc() },
        sep,
        { label: "Insert Page Link…", shortcut: "Ctrl+L", action: A.insertPageLink, disabled: noPage(), keepFocus: true },
        sep,
        { label: "Rename", shortcut: "F2", action: () => A.renamePage(), disabled: noPage() },
        { label: "Delete…", action: () => A.deletePage(), disabled: noPage() },
        sep,
        { label: "Move Up", shortcut: "Alt+Shift+Up", action: () => A.movePageUp(), disabled: noPage() },
        { label: "Move Down", shortcut: "Alt+Shift+Down", action: () => A.movePageDown(), disabled: noPage() },
        { label: "Indent (Make Child)", shortcut: "Alt+Shift+Right", action: () => A.indentPage(), disabled: noPage() },
        { label: "Outdent", shortcut: "Alt+Shift+Left", action: () => A.outdentPage(), disabled: noPage() },
      ],
    },
    {
      label: "View",
      mnemonic: "v",
      items: () => [
        { label: "Hierarchy Pane", shortcut: "Ctrl+\\", action: A.toggleHierarchy, checked: ui.hierarchyVisible },
        { label: "Expand All", action: A.expandAll, disabled: noDoc() },
        { label: "Collapse All", action: A.collapseAll, disabled: noDoc() },
        sep,
        {
          label: "Theme",
          submenu: [
            { label: "System", action: () => A.setTheme("system"), checked: ui.theme === "system" },
            { label: "Light", action: () => A.setTheme("light"), checked: ui.theme === "light" },
            { label: "Dark", action: () => A.setTheme("dark"), checked: ui.theme === "dark" },
          ],
        },
        sep,
        { label: "Zoom In", shortcut: "Ctrl+=", action: A.zoomIn },
        { label: "Zoom Out", shortcut: "Ctrl+-", action: A.zoomOut },
        { label: `Reset Zoom (${Math.round(ui.zoom * 100)}%)`, shortcut: "Ctrl+0", action: A.zoomReset },
      ],
    },
    {
      label: "Tools",
      mnemonic: "t",
      items: () => [
        {
          label: "AI Agent Access (MCP)…",
          action: A.showMcpSettings,
          checked: ui.mcp.running,
        },
      ],
    },
    {
      label: "Help",
      mnemonic: "h",
      items: () => [
        { label: "Markdown & Keyboard Shortcuts", shortcut: "F1", action: A.showShortcuts },
        sep,
        { label: "About GDDesigner", action: A.showAbout },
      ],
    },
  ];
}

interface Shortcut {
  combo: string;
  action: () => unknown;
}

/** App-wide shortcuts. Editing keys (Ctrl+Z/X/C/V/A…) are left to the focused control. */
const shortcuts: Shortcut[] = [
  { combo: "ctrl+n", action: A.newDocument },
  { combo: "ctrl+o", action: A.openDocument },
  { combo: "ctrl+shift+s", action: A.saveDocumentAs },
  { combo: "ctrl+s", action: () => undefined }, // Autosave: swallow the browser's "save page".
  { combo: "ctrl+w", action: A.closeDocument },
  { combo: "ctrl+f", action: A.focusFilter },
  { combo: "ctrl+p", action: A.goToPage },
  { combo: "ctrl+shift+n", action: () => A.newPage() },
  { combo: "ctrl+alt+n", action: () => A.newChildPage() },
  { combo: "ctrl+l", action: A.insertPageLink },
  { combo: "f2", action: () => A.renamePage() },
  { combo: "alt+shift+arrowup", action: () => A.movePageUp() },
  { combo: "alt+shift+arrowdown", action: () => A.movePageDown() },
  { combo: "alt+shift+arrowright", action: () => A.indentPage() },
  { combo: "alt+shift+arrowleft", action: () => A.outdentPage() },
  { combo: "ctrl+\\", action: A.toggleHierarchy },
  { combo: "ctrl+=", action: A.zoomIn },
  { combo: "ctrl+shift+=", action: A.zoomIn },
  { combo: "ctrl++", action: A.zoomIn },
  { combo: "ctrl+shift++", action: A.zoomIn },
  { combo: "ctrl+-", action: A.zoomOut },
  { combo: "ctrl+0", action: A.zoomReset },
  { combo: "f1", action: A.showShortcuts },
];

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  return parts.join("+");
}

/** Runs the app shortcut for `e`, if any. Returns true when handled. */
export function handleShortcut(e: KeyboardEvent): boolean {
  const combo = comboOf(e);
  const hit = shortcuts.find((s) => s.combo === combo);
  if (!hit) return false;
  e.preventDefault();
  e.stopPropagation();
  void hit.action();
  return true;
}
