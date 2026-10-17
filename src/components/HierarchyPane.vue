<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { filterPages, highlightSegments } from "../lib/filter";
import { displayTitle, PAGE_DRAG_MIME } from "../lib/pageLinks";
import * as A from "../services/actions";
import type { MenuItem } from "../composables/menu";
import { activeEditor } from "../editor/bridge";
import ContextMenu from "./ContextMenu.vue";

const doc = useDocumentStore();
const ui = useUiStore();

const filterInput = ref<HTMLInputElement | null>(null);
const treeEl = ref<HTMLElement | null>(null);
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
const renameValue = ref("");

interface Row {
  id: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  isMatch: boolean;
}

const filterResult = computed(() => filterPages(doc.pages, ui.filter));

/** The tree flattened into the rows currently visible. */
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const fr = filterResult.value;
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      const page = doc.pages[id];
      if (!page) continue;
      if (fr && !fr.visible.has(id)) continue;
      const hasChildren = fr ? page.children.some((c) => fr.visible.has(c)) : page.children.length > 0;
      const expanded = fr ? hasChildren : !!ui.expanded[id];
      out.push({ id, depth, hasChildren, expanded, isMatch: !!fr?.matches.has(id) });
      if (hasChildren && expanded) walk(page.children, depth + 1);
    }
  };
  walk(doc.rootIds, 0);
  return out;
});

const matchCount = computed(() => filterResult.value?.matches.size ?? 0);

// ------------------------------------------------------------ focus requests

watch(
  () => ui.focusFilterTick,
  async () => {
    await nextTick();
    filterInput.value?.focus();
    filterInput.value?.select();
  },
);

watch(
  () => ui.renamingId,
  async (id) => {
    if (!id) return;
    renameValue.value = doc.pages[id]?.title ?? "";
    await nextTick();
    const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
    input?.focus();
    input?.select();
  },
);

watch(
  () => ui.activePageId,
  async (id) => {
    if (!id) return;
    await nextTick();
    treeEl.value?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  },
);

// ------------------------------------------------------------ interactions

function toggle(row: Row) {
  if (!row.hasChildren || filterResult.value) return;
  ui.setExpanded(row.id, !row.expanded);
}

function select(id: string) {
  A.openPage(id);
}

function commitRename() {
  const id = ui.renamingId;
  if (!id) return;
  doc.setTitle(id, renameValue.value.trim());
  ui.renamingId = null;
  treeEl.value?.focus();
}

function cancelRename() {
  ui.renamingId = null;
  treeEl.value?.focus();
}

function onFilterKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    ui.filter = "";
  } else if (e.key === "ArrowDown" || e.key === "Enter") {
    e.preventDefault();
    const first = rows.value.find((r) => r.isMatch) ?? rows.value[0];
    if (first) select(first.id);
    if (e.key === "ArrowDown") treeEl.value?.focus();
    else ui.focusEditorTick++;
  }
}

function onTreeKey(e: KeyboardEvent) {
  if (ui.renamingId) return;
  const list = rows.value;
  const i = list.findIndex((r) => r.id === ui.activePageId);
  const row = list[i];
  const page = row ? doc.pages[row.id] : null;
  switch (e.key) {
    case "ArrowDown":
      if (e.altKey) return;
      if (list[i + 1]) select(list[i + 1].id);
      else if (i < 0 && list[0]) select(list[0].id);
      break;
    case "ArrowUp":
      if (e.altKey) return;
      if (i > 0) select(list[i - 1].id);
      break;
    case "ArrowRight":
      if (e.altKey || !row) return;
      if (row.hasChildren && !row.expanded) ui.setExpanded(row.id, true);
      else if (row.hasChildren && list[i + 1]) select(list[i + 1].id);
      break;
    case "ArrowLeft":
      if (e.altKey || !row) return;
      if (row.hasChildren && row.expanded && !filterResult.value) ui.setExpanded(row.id, false);
      else if (page?.parentId) select(page.parentId);
      break;
    case "Home":
      if (list[0]) select(list[0].id);
      break;
    case "End":
      if (list.length) select(list[list.length - 1].id);
      break;
    case "Enter":
      ui.focusEditorTick++;
      break;
    case "Delete":
      if (row) void A.deletePage(row.id);
      break;
    case "Insert":
      void A.newPage();
      break;
    default:
      return;
  }
  e.preventDefault();
}

// ------------------------------------------------------------ context menu

const ctx = ref<{ x: number; y: number; items: MenuItem[]; id: string | null } | null>(null);

function openContext(e: MouseEvent, id: string | null) {
  e.preventDefault();
  if (!doc.isOpen) return;
  const page = id ? doc.pages[id] : null;
  const sibs = id ? doc.siblingsOf(id) : [];
  const idx = id ? sibs.indexOf(id) : -1;
  const items: MenuItem[] = id
    ? [
        { label: "New Page", shortcut: "Ctrl+Shift+N", action: () => A.newPage(id) },
        { label: "New Child Page", shortcut: "Ctrl+Alt+N", action: () => A.newChildPage(id) },
        { separator: true },
        { label: "Rename", shortcut: "F2", action: () => A.renamePage(id) },
        {
          label: "Insert Link in Current Page",
          action: () => insertLinkTo(id),
          disabled: !ui.activePageId || ui.activePageId === id,
        },
        { separator: true },
        { label: "Move Up", action: () => A.movePageUp(id), disabled: idx <= 0 },
        { label: "Move Down", action: () => A.movePageDown(id), disabled: idx >= sibs.length - 1 },
        { label: "Indent (Make Child)", action: () => A.indentPage(id), disabled: idx <= 0 },
        { label: "Outdent", action: () => A.outdentPage(id), disabled: !page?.parentId },
        { separator: true },
        { label: "Delete…", shortcut: "Del", action: () => A.deletePage(id) },
      ]
    : [{ label: "New Top-Level Page", action: A.newTopLevelPage }];
  ctx.value = { x: e.clientX, y: e.clientY, items, id };
}

function insertLinkTo(id: string) {
  activeEditor()?.insertPageLink(id);
}

// ------------------------------------------------------------ drag and drop

type DropPos = "before" | "inside" | "after";
const dragId = ref<string | null>(null);
const dropTarget = ref<{ id: string | null; pos: DropPos } | null>(null);

function onDragStart(e: DragEvent, id: string) {
  if (ui.renamingId) return e.preventDefault();
  dragId.value = id;
  // Dropping onto the editor inserts a link to the page (see pageLinkPlugin).
  e.dataTransfer?.setData(PAGE_DRAG_MIME, id);
  e.dataTransfer?.setData("text/plain", displayTitle(doc.pages[id]?.title));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
}

function dropPosFor(e: DragEvent, el: HTMLElement): DropPos {
  const box = el.getBoundingClientRect();
  const y = (e.clientY - box.top) / box.height;
  return y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
}

function canDrop(targetId: string | null, pos: DropPos): boolean {
  const id = dragId.value;
  if (!id) return false;
  if (targetId === null) return true;
  if (targetId === id) return false;
  const parent = pos === "inside" ? targetId : (doc.pages[targetId]?.parentId ?? null);
  return doc.canMove(id, parent);
}

function onDragOver(e: DragEvent, id: string | null) {
  if (!dragId.value) return;
  const pos = id ? dropPosFor(e, e.currentTarget as HTMLElement) : "after";
  if (!canDrop(id, pos)) {
    dropTarget.value = null;
    return;
  }
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dropTarget.value = { id, pos };
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const id = dragId.value;
  const target = dropTarget.value;
  dragId.value = null;
  dropTarget.value = null;
  if (!id || !target) return;
  if (target.id === null) {
    doc.movePage(id, null);
  } else if (target.pos === "inside") {
    doc.movePage(id, target.id);
    ui.setExpanded(target.id, true);
  } else {
    const parent = doc.pages[target.id].parentId;
    const index = doc.siblingsOf(target.id).indexOf(target.id) + (target.pos === "after" ? 1 : 0);
    doc.movePage(id, parent, index);
  }
  A.openPage(id);
}

function onDragEnd() {
  dragId.value = null;
  dropTarget.value = null;
}

function dropClass(id: string) {
  const t = dropTarget.value;
  return t && t.id === id ? `drop-${t.pos}` : "";
}
</script>

<template>
  <aside class="hierarchy">
    <div class="filter">
      <svg class="filter-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <input
        ref="filterInput"
        v-model="ui.filter"
        type="search"
        placeholder="Filter pages"
        spellcheck="false"
        aria-label="Filter pages"
        @keydown="onFilterKey"
      />
      <button v-if="ui.filter" class="clear" title="Clear filter (Esc)" @click="ui.filter = ''">×</button>
    </div>
    <div v-if="ui.filter" class="filter-info">
      {{ matchCount === 0 ? "No matching pages" : `${matchCount} matching page${matchCount === 1 ? "" : "s"}` }}
    </div>

    <div
      ref="treeEl"
      class="tree"
      role="tree"
      tabindex="0"
      aria-label="Pages"
      @keydown="onTreeKey"
      @contextmenu.self="openContext($event, null)"
      @dragover.self="onDragOver($event, null)"
      @drop.self="onDrop"
    >
      <div
        v-for="row in rows"
        :key="row.id"
        class="row"
        role="treeitem"
        :data-id="row.id"
        :aria-selected="ui.activePageId === row.id"
        :aria-expanded="row.hasChildren ? row.expanded : undefined"
        :class="[
          {
            active: ui.activePageId === row.id,
            'context-target': ctx?.id === row.id,
            dim: ui.filter && !row.isMatch,
            dragging: dragId === row.id,
          },
          dropClass(row.id),
        ]"
        :style="{ paddingLeft: 6 + row.depth * 16 + 'px' }"
        :draggable="ui.renamingId !== row.id"
        @click="select(row.id)"
        @dblclick="A.renamePage(row.id)"
        @contextmenu="openContext($event, row.id)"
        @dragstart="onDragStart($event, row.id)"
        @dragover="onDragOver($event, row.id)"
        @drop="onDrop"
        @dragend="onDragEnd"
      >
        <span class="twisty" :class="{ leaf: !row.hasChildren }" @click.stop="toggle(row)">
          <svg v-if="row.hasChildren" viewBox="0 0 16 16" :class="{ open: row.expanded }" aria-hidden="true">
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <input
          v-if="ui.renamingId === row.id"
          ref="renameInput"
          v-model="renameValue"
          class="rename"
          spellcheck="false"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <span v-else class="label" :class="{ untitled: !doc.pages[row.id].title.trim() }">
          <template v-for="(seg, k) in highlightSegments(displayTitle(doc.pages[row.id].title), ui.filter)" :key="k">
            <mark v-if="seg.hit">{{ seg.text }}</mark>
            <template v-else>{{ seg.text }}</template>
          </template>
        </span>
      </div>
      <div
        v-if="doc.isOpen"
        class="tree-end"
        :class="{ 'drop-root': dropTarget && dropTarget.id === null }"
        @dragover="onDragOver($event, null)"
        @drop="onDrop"
        @contextmenu="openContext($event, null)"
        @dblclick="A.newTopLevelPage()"
      />
    </div>

    <div class="pane-footer">
      <button title="New page (Ctrl+Shift+N)" :disabled="!doc.isOpen" @click="A.newPage()">+ Page</button>
      <button title="New child page (Ctrl+Alt+N)" :disabled="!ui.activePageId" @click="A.newChildPage()">+ Child</button>
      <span class="count">{{ doc.pageCount }} page{{ doc.pageCount === 1 ? "" : "s" }}</span>
    </div>

    <ContextMenu v-if="ctx" :x="ctx.x" :y="ctx.y" :items="ctx.items" @close="ctx = null" />
  </aside>
</template>

<style scoped>
.hierarchy {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--sidebar-bg);
}
.filter {
  position: relative;
  display: flex;
  align-items: center;
  margin: 8px;
}
.filter-icon {
  position: absolute;
  left: 8px;
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  pointer-events: none;
}
.filter input {
  flex: 1;
  min-width: 0;
  padding: 6px 26px 6px 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  outline: none;
}
.filter input::-webkit-search-cancel-button {
  display: none;
}
.filter input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.clear {
  position: absolute;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
}
.clear:hover {
  background: var(--hover);
}
.filter-info {
  padding: 0 12px 6px;
  font-size: 12px;
  color: var(--text-muted);
}
.tree {
  flex: 1;
  overflow: auto;
  padding: 2px 4px 0;
  outline: none;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding-right: 8px;
  border-radius: 5px;
  cursor: default;
  user-select: none;
  white-space: nowrap;
}
.row:hover {
  background: var(--hover);
}
.row.active {
  background: var(--selected);
}
.tree:focus .row.active {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
.row.context-target {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.row.dim .label {
  color: var(--text-muted);
}
.row.dragging {
  opacity: 0.5;
}
.row.drop-inside {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.row.drop-before::before,
.row.drop-after::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
}
.row.drop-before::before {
  top: -1px;
}
.row.drop-after::after {
  bottom: -1px;
}
.twisty {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  border-radius: 4px;
}
.twisty:not(.leaf):hover {
  background: var(--hover-strong);
}
.twisty svg {
  width: 12px;
  height: 12px;
  transition: transform 0.12s ease;
}
.twisty svg.open {
  transform: rotate(90deg);
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  /* Room for the slant of italic text (e.g. "Untitled"), which overflow would clip. */
  padding-right: 0.2em;
}
.label.untitled {
  color: var(--text-muted);
  font-style: italic;
}
.label mark {
  background: var(--highlight);
  color: inherit;
  border-radius: 2px;
}
.rename {
  flex: 1;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  outline: none;
}
.tree-end {
  min-height: 40px;
  height: 100%;
}
.tree-end.drop-root {
  box-shadow: inset 0 2px 0 var(--accent);
}
.pane-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
}
.pane-footer button {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel-bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.pane-footer button:hover:not(:disabled) {
  background: var(--hover);
}
.pane-footer button:disabled {
  color: var(--text-faint);
  cursor: default;
}
.count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
