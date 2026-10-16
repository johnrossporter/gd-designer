<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { displayTitle } from "../lib/pageLinks";
import { highlightSegments } from "../lib/filter";
import { activeEditor } from "../editor/bridge";
import * as A from "../services/actions";

const doc = useDocumentStore();
const ui = useUiStore();

const query = ref("");
const index = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);

const purpose = computed(() => ui.picker);

interface Option {
  id: string;
  title: string;
  path: string;
}

const options = computed<Option[]>(() => {
  const q = query.value.trim().toLowerCase();
  const exclude = purpose.value === "insert-link" ? ui.activePageId : null;
  const all = doc
    .orderedIds()
    .filter((id) => id !== exclude)
    .map((id) => ({
      id,
      title: displayTitle(doc.pages[id].title),
      path: doc
        .ancestors(id)
        .map((a) => displayTitle(a.title))
        .join(" › "),
    }));
  if (!q) return all;
  const starts = all.filter((o) => o.title.toLowerCase().startsWith(q));
  const contains = all.filter((o) => !o.title.toLowerCase().startsWith(q) && o.title.toLowerCase().includes(q));
  return [...starts, ...contains];
});

watch(query, () => (index.value = 0));
watch(index, async () => {
  await nextTick();
  list.value?.querySelector(".option.active")?.scrollIntoView({ block: "nearest" });
});

onMounted(() => input.value?.focus());

function close(refocus = true) {
  ui.picker = null;
  if (refocus) nextTick(() => activeEditor()?.focus());
}

function choose(opt: Option | undefined) {
  if (!opt) return;
  const p = purpose.value;
  close(false);
  if (p === "insert-link") {
    nextTick(() => activeEditor()?.insertPageLink(opt.id));
  } else {
    A.openPage(opt.id);
  }
}

/** Creates a new top-level page named after the query and links to it. */
function createAndLink() {
  const title = query.value.trim();
  if (!title) return;
  const id = doc.createPage({ parentId: ui.activePageId, title });
  if (ui.activePageId) ui.setExpanded(ui.activePageId, true);
  close(false);
  nextTick(() => activeEditor()?.insertPageLink(id));
}

const canCreate = computed(
  () =>
    purpose.value === "insert-link" &&
    query.value.trim().length > 0 &&
    !options.value.some((o) => o.title.toLowerCase() === query.value.trim().toLowerCase()),
);

function onKey(e: KeyboardEvent) {
  const total = options.value.length + (canCreate.value ? 1 : 0);
  switch (e.key) {
    case "ArrowDown":
      index.value = total ? (index.value + 1) % total : 0;
      break;
    case "ArrowUp":
      index.value = total ? (index.value - 1 + total) % total : 0;
      break;
    case "Enter":
      if (index.value < options.value.length) choose(options.value[index.value]);
      else if (canCreate.value) createAndLink();
      break;
    case "Escape":
      close();
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}
</script>

<template>
  <div class="backdrop" @mousedown.self="close()">
    <div class="picker" role="dialog" :aria-label="purpose === 'insert-link' ? 'Insert page link' : 'Go to page'">
      <div class="picker-head">{{ purpose === "insert-link" ? "Link to page" : "Go to page" }}</div>
      <input
        ref="input"
        v-model="query"
        class="picker-input"
        placeholder="Type to search pages…"
        spellcheck="false"
        @keydown="onKey"
      />
      <ul ref="list" class="options" role="listbox">
        <li
          v-for="(opt, i) in options"
          :key="opt.id"
          class="option"
          role="option"
          :class="{ active: i === index }"
          :aria-selected="i === index"
          @mouseenter="index = i"
          @mousedown.prevent="choose(opt)"
        >
          <span class="opt-title">
            <template v-for="(seg, k) in highlightSegments(opt.title, query)" :key="k">
              <mark v-if="seg.hit">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
          <span v-if="opt.path" class="opt-path">{{ opt.path }}</span>
        </li>
        <li
          v-if="canCreate"
          class="option create"
          :class="{ active: index === options.length }"
          @mouseenter="index = options.length"
          @mousedown.prevent="createAndLink"
        >
          <span class="opt-title">+ Create sub-page “{{ query.trim() }}” and link it</span>
        </li>
        <li v-if="!options.length && !canCreate" class="none">No pages found</li>
      </ul>
      <div class="picker-foot">↑↓ to choose · Enter to {{ purpose === "insert-link" ? "insert" : "open" }} · Esc to cancel</div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: var(--backdrop);
}
.picker {
  width: min(560px, calc(100vw - 32px));
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.picker-head {
  padding: 10px 14px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.picker-input {
  margin: 8px 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 15px;
  outline: none;
}
.picker-input:focus {
  border-color: var(--accent);
}
.options {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 0 6px 6px;
  list-style: none;
}
.option {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.option.active {
  background: var(--accent-soft);
}
.opt-title mark {
  background: var(--highlight);
  color: inherit;
}
.opt-path {
  font-size: 12px;
  color: var(--text-muted);
}
.option.create .opt-title {
  color: var(--link);
}
.none {
  padding: 12px;
  color: var(--text-muted);
  text-align: center;
}
.picker-foot {
  padding: 6px 14px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
