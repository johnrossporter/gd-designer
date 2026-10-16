import { invoke } from "@tauri-apps/api/core";
import type { DocumentFile } from "../types/document";
import { FILE_EXTENSION, FILE_FORMAT, FILE_VERSION } from "../types/document";
import { isTauri } from "./platform";

/**
 * Disk access. Inside Tauri it goes through the Rust commands in
 * `src-tauri/src/lib.rs`; in a plain browser (`npm run dev`) it falls back to
 * localStorage so the UI can be previewed without the desktop shell.
 */

const BROWSER_FILE_PREFIX = "gddesigner:file:";

export function serializeDocument(file: DocumentFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

export function parseDocument(text: string): DocumentFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`The file is not valid JSON: ${(e as Error).message}`);
  }
  if (!data || typeof data !== "object") throw new Error("The file is not a GDDesigner document.");
  const doc = data as Partial<DocumentFile>;
  if (doc.format !== FILE_FORMAT) throw new Error("The file is not a GDDesigner document.");
  if (typeof doc.version !== "number" || doc.version > FILE_VERSION) {
    throw new Error(`This document was made by a newer version of GDDesigner (format v${doc.version}).`);
  }
  if (!Array.isArray(doc.pages)) throw new Error("The document has no page list.");
  // Version migrations go here when the format changes.
  return doc as DocumentFile;
}

export async function readTextFile(path: string): Promise<string> {
  if (isTauri) return invoke<string>("read_document", { path });
  const text = localStorage.getItem(BROWSER_FILE_PREFIX + path);
  if (text === null) throw new Error(`File not found: ${path}`);
  return text;
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  if (isTauri) return invoke("write_document", { path, contents });
  localStorage.setItem(BROWSER_FILE_PREFIX + path, contents);
}

export async function fileExists(path: string): Promise<boolean> {
  if (isTauri) return invoke<boolean>("file_exists", { path });
  return localStorage.getItem(BROWSER_FILE_PREFIX + path) !== null;
}

export async function readDocument(path: string): Promise<DocumentFile> {
  return parseDocument(await readTextFile(path));
}

export async function writeDocument(path: string, file: DocumentFile): Promise<void> {
  await writeTextFile(path, serializeDocument(file));
}

const documentFilters = [
  { name: "GDDesigner Document", extensions: [FILE_EXTENSION, "json"] },
];

function ensureExtension(path: string, ext: string): string {
  return path.toLowerCase().endsWith("." + ext) ? path : `${path}.${ext}`;
}

/** Shows an Open dialog; returns the chosen path or null. */
export async function pickDocumentToOpen(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ multiple: false, directory: false, filters: documentFilters });
    return typeof result === "string" ? result : null;
  }
  const known = Object.keys(localStorage)
    .filter((k) => k.startsWith(BROWSER_FILE_PREFIX))
    .map((k) => k.slice(BROWSER_FILE_PREFIX.length));
  const answer = window.prompt(`Open which document?\n${known.join("\n") || "(none saved yet)"}`, known[0] ?? "");
  return answer?.trim() || null;
}

/** Shows a Save dialog for a document; returns the chosen path or null. */
export async function pickDocumentSavePath(defaultName: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const result = await save({
      title: "Save GDDesigner Document",
      defaultPath: `${defaultName}.${FILE_EXTENSION}`,
      filters: documentFilters,
    });
    return result ? ensureExtension(result, FILE_EXTENSION) : null;
  }
  const answer = window.prompt("Save document as:", `${defaultName}.${FILE_EXTENSION}`);
  return answer?.trim() ? ensureExtension(answer.trim(), FILE_EXTENSION) : null;
}

/** Shows a Save dialog for a markdown export; returns the chosen path or null. */
export async function pickMarkdownSavePath(defaultName: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const result = await save({
      title: "Export Page as Markdown",
      defaultPath: `${defaultName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    return result ? ensureExtension(result, "md") : null;
  }
  const answer = window.prompt("Export page as:", `${defaultName}.md`);
  return answer?.trim() || null;
}

export async function showError(message: string, title = "GDDesigner"): Promise<void> {
  if (isTauri) {
    const { message: show } = await import("@tauri-apps/plugin-dialog");
    await show(message, { title, kind: "error" });
    return;
  }
  window.alert(message);
}

export async function revealInExplorer(path: string): Promise<void> {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function readClipboardText(): Promise<string> {
  if (isTauri) {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return (await readText()) ?? "";
  }
  return navigator.clipboard.readText();
}
