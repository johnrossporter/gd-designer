<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { searchPages, type PageSearchResult } from "../lib/search";
import { displayTitle } from "../lib/pageLinks";
import { highlightSegments } from "../lib/filter";
import * as A from "../services/actions";

const doc = useDocumentStore();
const ui = useUiStore();

const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);

/** Hits shown per page before "show more". */
const PREVIEW_HITS = 5;
const expandedPages = reactive<Record<string, boolean>>({});

// Debounce the query so typing stays smooth in large documents.
const query = ref(ui.search.query);
let timer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => ui.search.query,
  (q) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (query.value = q), q.trim() ? 150 : 0);
  },
);

const results = computed<PageSearchResult[]>(() => {
  // Re-run when any page changes.
  void doc.revision;
  return searchPages(doc.pages, doc.orderedIds(), query.value, {
    matchCase: ui.search.matchCase,
    wholeWord: ui.search.wholeWord,
  });
});

const totalMatches = computed(() => results.value.reduce((n, r) => n + r.total + (r.titleMatch ? 1 : 0), 0));

/** Flat list of selectable rows for keyboard navigation. */
interface Item {
  key: string;
  pageId: string;
  occurrence: number; // -1 = the page itself
}

function visibleHits(r: PageSearchResult) {
  return expandedPages[r.id] ? r.hits : r.hits.slice(0, PREVIEW_HITS);
}

const items = computed<Item[]>(() =>
  results.value.flatMap((r) => [
    { key: r.id, pageId: r.id, occurrence: -1 },
    ...visibleHits(r).map((h) => ({ key: `${r.id}:${h.occurrence}`, pageId: r.id, occurrence: h.occurrence })),
  ]),
);

/**
 * The selected row, tracked by key so it survives results being recomputed
 * (which happens on every document change, including just opening a page).
 */
const selectedKey = ref<string | null>(null);
const selected = computed({
  get: () => (selectedKey.value ? items.value.findIndex((i) => i.key === selectedKey.value) : -1),
  set: (index: number) => (selectedKey.value = items.value[index]?.key ?? null),
});
watch(query, () => (selectedKey.value = null));

let seq = 0;
function open(item: Item, focus = false) {
  A.openPage(item.pageId);
  ui.searchReveal = { pageId: item.pageId, occurrence: item.occurrence, focus, seq: ++seq };
  if (focus && item.occurrence < 0) ui.focusEditorTick++;
}

function select(index: number) {
  selected.value = index;
  nextTick(() => list.value?.querySelector(".item.selected")?.scrollIntoView({ block: "nearest" }));
}

/** Next row that is a match: a content hit, or a page whose only match is its title. */
function nextMatchIndex(dir: 1 | -1): number {
  const list = items.value;
  const n = list.length;
  const isMatch = (it: Item) => it.occurrence >= 0 || !results.value.find((r) => r.id === it.pageId)?.total;
  let i = selected.value;
  for (let step = 0; step < n; step++) {
    i = (((i + dir) % n) + n) % n;
    if (isMatch(list[i])) return i;
  }
  return Math.max(selected.value, 0);
}

function onKey(e: KeyboardEvent) {
  const n = items.value.length;
  switch (e.key) {
    case "ArrowDown":
      if (n) select((selected.value + 1) % n);
      break;
    case "ArrowUp":
      if (n) select(selected.value <= 0 ? n - 1 : selected.value - 1);
      break;
    case "Enter": {
      if (!n) return;
      // Enter steps through matches; Shift+Enter goes back; Ctrl+Enter jumps into the editor.
      if (!e.ctrlKey || selected.value < 0) select(nextMatchIndex(e.shiftKey && !e.ctrlKey ? -1 : 1));
      open(items.value[selected.value], e.ctrlKey);
      break;
    }
    case "Escape":
      if (ui.search.query) ui.search.query = "";
      else ui.focusEditorTick++;
      break;
    default:
      return;
  }
  e.preventDefault();
}

function indexOf(pageId: string, occurrence: number) {
  return items.value.findIndex((i) => i.pageId === pageId && i.occurrence === occurrence);
}

function clickItem(pageId: string, occurrence: number) {
  const i = indexOf(pageId, occurrence);
  selected.value = i;
  open(items.value[i]);
}

function pathOf(id: string) {
  return doc
    .ancestors(id)
    .map((a) => displayTitle(a.title))
    .join(" › ");
}

watch(
  () => ui.focusSearchTick,
  async () => {
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
);

const summary = computed(() => {
  if (!query.value.trim()) return "";
  if (!results.value.length) return "No results";
  const pages = results.value.length;
  return `${totalMatches.value} match${totalMatches.value === 1 ? "" : "es"} in ${pages} page${pages === 1 ? "" : "s"}`;
});
</script>

<template>
  <section class="search-pane" aria-label="Search all pages">
    <div class="search-box">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <input
        ref="input"
        v-model="ui.search.query"
        type="search"
        placeholder="Search all pages"
        spellcheck="false"
        aria-label="Search all pages"
        @keydown="onKey"
      />
      <button
        class="opt"
        :class="{ on: ui.search.matchCase }"
        title="Match case"
        :aria-pressed="ui.search.matchCase"
        @click="ui.search.matchCase = !ui.search.matchCase"
      >
        Aa
      </button>
      <button
        class="opt"
        :class="{ on: ui.search.wholeWord }"
        title="Whole word"
        :aria-pressed="ui.search.wholeWord"
        @click="ui.search.wholeWord = !ui.search.wholeWord"
      >
        <u>ab</u>
      </button>
    </div>
    <div v-if="summary" class="summary">{{ summary }}</div>
    <div v-else class="summary hint">Searches the titles and text of every page. Enter steps through matches.</div>

    <div ref="list" class="results" role="listbox">
      <div v-for="r in results" :key="r.id" class="group">
        <div
          class="item page"
          role="option"
          :class="{ selected: selectedKey === r.id, active: ui.activePageId === r.id }"
          :aria-selected="selectedKey === r.id"
          @click="clickItem(r.id, -1)"
          @dblclick="open({ key: r.id, pageId: r.id, occurrence: -1 }, true)"
        >
          <div class="page-line">
            <span class="page-title">
              <template v-for="(seg, k) in r.titleMatch ? highlightSegments(r.title, query) : [{ text: r.title, hit: false }]" :key="k">
                <mark v-if="seg.hit">{{ seg.text }}</mark>
                <template v-else>{{ seg.text }}</template>
              </template>
            </span>
            <span v-if="r.total" class="count">{{ r.total }}</span>
          </div>
          <div v-if="pathOf(r.id)" class="path">{{ pathOf(r.id) }}</div>
        </div>
        <div
          v-for="h in visibleHits(r)"
          :key="h.occurrence"
          class="item hit"
          role="option"
          :class="{ selected: selectedKey === `${r.id}:${h.occurrence}` }"
          :aria-selected="selectedKey === `${r.id}:${h.occurrence}`"
          :title="h.snippet"
          @click="clickItem(r.id, h.occurrence)"
          @dblclick="open({ key: '', pageId: r.id, occurrence: h.occurrence }, true)"
        >
          {{ h.snippet.slice(0, h.start) }}<mark>{{ h.snippet.slice(h.start, h.end) }}</mark>{{ h.snippet.slice(h.end) }}
        </div>
        <button
          v-if="r.hits.length > PREVIEW_HITS"
          class="more"
          @click="expandedPages[r.id] = !expandedPages[r.id]"
        >
          {{ expandedPages[r.id] ? "Show fewer" : `Show ${r.hits.length - PREVIEW_HITS} more` }}
        </button>
        <div v-if="r.total > r.hits.length && expandedPages[r.id]" class="capped">
          + {{ r.total - r.hits.length }} more on this page
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--sidebar-bg);
}
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 8px;
  padding: 2px 3px 2px 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
}
.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.icon {
  position: absolute;
  left: 8px;
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}
.search-box input {
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.search-box input::-webkit-search-cancel-button {
  display: none;
}
.opt {
  flex: none;
  width: 24px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.opt:hover {
  background: var(--hover);
}
.opt.on {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
}
.summary {
  padding: 0 12px 6px;
  font-size: 12px;
  color: var(--text-muted);
}
.summary.hint {
  line-height: 1.4;
}
.results {
  flex: 1;
  overflow: auto;
  padding: 0 4px 8px;
}
.group {
  margin-bottom: 6px;
}
.item {
  padding: 4px 8px;
  border-radius: 5px;
  cursor: default;
  user-select: none;
}
.item:hover {
  background: var(--hover);
}
.item.selected {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
.page-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.page-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.item.page.active .page-title {
  color: var(--accent);
}
.count {
  flex: none;
  min-width: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--hover-strong);
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
}
.path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--text-muted);
}
.hit {
  padding-left: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text-muted);
}
mark {
  background: var(--highlight);
  color: var(--text);
  border-radius: 2px;
}
.more {
  margin: 2px 0 0 18px;
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--link);
  font-size: 12px;
  cursor: pointer;
}
.more:hover {
  background: var(--hover);
}
.capped {
  padding: 2px 0 0 24px;
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
