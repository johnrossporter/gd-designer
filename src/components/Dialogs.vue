<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useUiStore } from "../stores/ui";

/** Confirm, About and Help dialogs. */
const ui = useUiStore();
const okButton = ref<HTMLButtonElement | null>(null);

watch(
  () => ui.confirmRequest,
  async (req) => {
    if (!req) return;
    await nextTick();
    okButton.value?.focus();
  },
);

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  if (ui.confirmRequest) ui.confirmRequest.resolve(false);
  ui.aboutOpen = false;
  ui.shortcutsOpen = false;
}

const shortcuts: [string, string][] = [
  ["Ctrl+N", "New document"],
  ["Ctrl+O", "Open document"],
  ["Ctrl+Shift+S", "Save document as"],
  ["Ctrl+Shift+N", "New page (sibling)"],
  ["Ctrl+Alt+N", "New child page"],
  ["F2", "Rename page"],
  ["Alt+Shift+↑ / ↓", "Move page up / down"],
  ["Alt+Shift+→ / ←", "Indent / outdent page"],
  ["Ctrl+L or [[", "Insert link to a page"],
  ["Ctrl+F", "Filter the hierarchy"],
  ["Ctrl+Shift+F", "Search all pages (Enter / Shift+Enter: next / previous match)"],
  ["Ctrl+P", "Go to page"],
  ["Ctrl+\\", "Show / hide hierarchy"],
  ["Ctrl+= / Ctrl+- / Ctrl+0", "Zoom in / out / reset"],
];

const markdown: [string, string][] = [
  ["# Heading", "Heading (## for level 2, …)"],
  ["**bold**  *italic*", "Bold, italic"],
  ["~~strike~~  `code`", "Strikethrough, inline code"],
  ["- item  /  1. item", "Bulleted / numbered list"],
  ["- [ ] task", "Checklist"],
  ["> quote", "Block quote"],
  ["```", "Code block"],
  ["---", "Divider"],
  ["/", "Block menu (tables, images, …)"],
];
</script>

<template>
  <div v-if="ui.confirmRequest" class="backdrop" @keydown="onKey" @mousedown.self="ui.confirmRequest.resolve(false)">
    <div class="dialog" role="alertdialog" aria-modal="true">
      <h3>{{ ui.confirmRequest.title }}</h3>
      <p>{{ ui.confirmRequest.message }}</p>
      <div class="buttons">
        <button @click="ui.confirmRequest.resolve(false)">Cancel</button>
        <button
          ref="okButton"
          :class="ui.confirmRequest.danger ? 'danger' : 'primary'"
          @click="ui.confirmRequest.resolve(true)"
        >
          {{ ui.confirmRequest.okLabel }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="ui.aboutOpen" class="backdrop" tabindex="-1" @keydown="onKey" @mousedown.self="ui.aboutOpen = false">
    <div class="dialog" role="dialog" aria-modal="true">
      <h3>GDDesigner</h3>
      <p>Version 0.1.0</p>
      <p>Hierarchical notes, writing and world building. Pages are stored as Markdown inside a human-readable <code>.gdd.json</code> file, saved automatically.</p>
      <p class="muted">Built with Tauri, Vue and Milkdown.</p>
      <div class="buttons"><button class="primary" @click="ui.aboutOpen = false">Close</button></div>
    </div>
  </div>

  <div v-if="ui.shortcutsOpen" class="backdrop" tabindex="-1" @keydown="onKey" @mousedown.self="ui.shortcutsOpen = false">
    <div class="dialog wide" role="dialog" aria-modal="true">
      <h3>Keyboard shortcuts</h3>
      <table>
        <tr v-for="[k, d] in shortcuts" :key="k"><td><kbd>{{ k }}</kbd></td><td>{{ d }}</td></tr>
      </table>
      <h3>Markdown shortcuts (type in a page)</h3>
      <table>
        <tr v-for="[k, d] in markdown" :key="k"><td><code>{{ k }}</code></td><td>{{ d }}</td></tr>
      </table>
      <div class="buttons"><button class="primary" @click="ui.shortcutsOpen = false">Close</button></div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  background: var(--backdrop);
}
.dialog {
  width: min(440px, calc(100vw - 32px));
  max-height: 85vh;
  overflow: auto;
  padding: 18px 20px 16px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}
.dialog.wide {
  width: min(600px, calc(100vw - 32px));
}
h3 {
  margin: 0 0 10px;
  font-size: 16px;
}
h3:not(:first-child) {
  margin-top: 18px;
}
p {
  margin: 0 0 10px;
  line-height: 1.5;
}
.muted {
  color: var(--text-muted);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
td:first-child {
  white-space: nowrap;
  width: 40%;
}
kbd,
code {
  font-family: var(--font-code);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--hover);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>
