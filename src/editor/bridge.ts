/**
 * Lets the menu bar and shortcuts reach the editor of the page currently shown
 * (there is at most one mounted at a time).
 */
export interface EditorHandle {
  undo(): void;
  redo(): void;
  selectAll(): void;
  focus(): void;
  /** Inserts markdown at the cursor (used by Edit > Paste). */
  insertMarkdown(markdown: string): void;
  insertPageLink(pageId: string): void;
  /** Pushes the editor's current markdown into the store immediately. */
  flush(): void;
  /** True when the editor (rather than some other input) has focus. */
  hasFocus(): boolean;
  /**
   * Marks the `occurrence`-th search match as current and scrolls to it.
   * With `focus`, also selects it and moves keyboard focus into the editor.
   */
  revealMatch(occurrence: number, focus?: boolean): void;
}

let active: EditorHandle | null = null;

export function setActiveEditor(handle: EditorHandle | null) {
  active = handle;
}

export function clearActiveEditor(handle: EditorHandle) {
  if (active === handle) active = null;
}

export function activeEditor(): EditorHandle | null {
  return active;
}
