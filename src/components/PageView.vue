<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { displayTitle } from "../lib/pageLinks";
import * as A from "../services/actions";
import MarkdownEditor from "../editor/MarkdownEditor.vue";

const doc = useDocumentStore();
const ui = useUiStore();

const page = computed(() => (ui.activePageId ? doc.pages[ui.activePageId] : null));
const ancestors = computed(() => (page.value ? doc.ancestors(page.value.id) : []));
const backlinks = computed(() => (page.value ? doc.backlinks(page.value.id) : []));
const childPages = computed(() => (page.value ? page.value.children.map((id) => doc.pages[id]).filter(Boolean) : []));

const titleEl = ref<HTMLTextAreaElement | null>(null);
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null);

function autosize() {
  const el = titleEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

watch(
  () => page.value?.title,
  () => nextTick(autosize),
  { immediate: true },
);

watch(
  () => ui.focusTitleTick,
  async () => {
    await nextTick();
    titleEl.value?.focus();
    titleEl.value?.select();
  },
);

watch(
  () => ui.focusEditorTick,
  async () => {
    await nextTick();
    editor.value?.focus();
  },
);

function onTitleInput(e: Event) {
  if (!page.value) return;
  // Titles are single-line; strip pasted newlines.
  const value = (e.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, " ");
  doc.setTitle(page.value.id, value);
  autosize();
}

function onTitleKey(e: KeyboardEvent) {
  if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
    e.preventDefault();
    editor.value?.focus();
  }
}

const updatedLabel = computed(() => {
  if (!page.value) return "";
  const d = new Date(page.value.updatedAt);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
});

const wordCount = computed(() => {
  const text = page.value?.content ?? "";
  const words = text.replace(/\(gdd:\/\/page\/[^)]*\)/g, "").match(/[\p{L}\p{N}'’-]+/gu);
  return words ? words.length : 0;
});

defineExpose({ wordCount });
</script>

<template>
  <section class="page-view" :style="{ '--zoom': ui.zoom }">
    <div v-if="page" :key="page.id" class="page-scroll">
      <article class="page">
        <nav class="breadcrumb" aria-label="Page path">
          <template v-for="a in ancestors" :key="a.id">
            <button class="crumb" @click="A.openPage(a.id)">{{ displayTitle(a.title) }}</button>
            <span class="crumb-sep">›</span>
          </template>
          <span class="crumb current">{{ displayTitle(page.title) }}</span>
        </nav>

        <textarea
          ref="titleEl"
          class="title"
          rows="1"
          placeholder="Untitled"
          spellcheck="true"
          :value="page.title"
          aria-label="Page title"
          @input="onTitleInput"
          @keydown="onTitleKey"
        />
        <div class="meta">
          Last edited {{ updatedLabel }} · {{ wordCount }} word{{ wordCount === 1 ? "" : "s" }}
        </div>

        <MarkdownEditor
          ref="editor"
          :key="page.id"
          :page-id="page.id"
          @navigate="A.openPage"
          @request-link="A.insertPageLink"
        />

        <footer v-if="childPages.length || backlinks.length" class="related">
          <div v-if="childPages.length" class="related-group">
            <h4>Sub-pages</h4>
            <button v-for="c in childPages" :key="c.id" class="chip" @click="A.openPage(c.id)">
              {{ displayTitle(c.title) }}
            </button>
          </div>
          <div v-if="backlinks.length" class="related-group">
            <h4>Linked from</h4>
            <button v-for="b in backlinks" :key="b.id" class="chip" @click="A.openPage(b.id)">
              {{ displayTitle(b.title) }}
            </button>
          </div>
        </footer>
      </article>
    </div>
    <div v-else class="empty">
      <p>No page selected.</p>
      <button class="primary" @click="A.newPage()">Create a page</button>
    </div>
  </section>
</template>

<style scoped>
.page-view {
  height: 100%;
  min-width: 0;
  background: var(--page-bg);
}
.page-scroll {
  height: 100%;
  overflow: auto;
}
.page {
  max-width: calc(860px * var(--zoom));
  margin: 0 auto;
  padding: 28px 40px 80px;
  font-size: calc(16px * var(--zoom));
}
.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-height: 22px;
  margin-bottom: 10px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.crumb {
  border: none;
  background: none;
  padding: 2px 4px;
  border-radius: 4px;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.crumb:hover {
  background: var(--hover);
  color: var(--text);
}
.crumb.current {
  cursor: default;
  color: var(--text);
}
.crumb-sep {
  opacity: 0.6;
}
.title {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  background: transparent;
  color: var(--text);
  font-family: var(--font-title);
  font-size: 2.1em;
  font-weight: 700;
  line-height: 1.2;
}
.title::placeholder {
  color: var(--text-faint);
}
.meta {
  margin: 8px 0 14px;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
}
.related {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: grid;
  gap: 14px;
}
.related h4 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.chip {
  margin: 0 6px 6px 0;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-bg);
  color: var(--link);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.chip:hover {
  background: var(--accent-soft);
}
.empty {
  height: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--text-muted);
}
</style>
