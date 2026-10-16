import { watch } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { activeEditor } from "../editor/bridge";
import { writeDocument } from "./fileService";

/**
 * Writes the open document to disk shortly after every change. Changes are
 * tracked by the document store's `revision` counter.
 */

const DELAY_MS = 750;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let savedRevision = -1;
let started = false;

function stores() {
  return { doc: useDocumentStore(), ui: useUiStore() };
}

export function startAutosave() {
  if (started) return;
  started = true;
  const { doc, ui } = stores();
  watch(
    () => doc.revision,
    (rev) => {
      if (!doc.isOpen || !doc.filePath || rev === savedRevision) return;
      ui.saveStatus = "dirty";
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flushSave(), DELAY_MS);
    },
  );
}

/** Marks the current state as already on disk (after opening a file). */
export function markSaved() {
  const { doc, ui } = stores();
  if (timer) clearTimeout(timer);
  timer = null;
  savedRevision = doc.revision;
  ui.saveStatus = "saved";
  ui.saveError = null;
}

/** Saves now if there are unsaved changes. Resolves once the disk is current. */
export async function flushSave(): Promise<boolean> {
  const { doc, ui } = stores();
  if (timer) clearTimeout(timer);
  timer = null;
  activeEditor()?.flush();

  while (doc.isOpen && doc.filePath && savedRevision !== doc.revision) {
    if (inFlight) {
      await inFlight.catch(() => undefined);
      continue;
    }
    const rev = doc.revision;
    ui.saveStatus = "saving";
    inFlight = writeDocument(doc.filePath, doc.toFile()).then(() => {
      savedRevision = rev;
    });
    try {
      await inFlight;
      ui.saveError = null;
    } catch (e) {
      ui.saveStatus = "error";
      ui.saveError = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      inFlight = null;
    }
  }
  if (savedRevision === doc.revision) ui.saveStatus = "saved";
  return true;
}
