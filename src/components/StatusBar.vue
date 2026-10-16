<script setup lang="ts">
import { computed } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { flushSave } from "../services/autosave";

const doc = useDocumentStore();
const ui = useUiStore();

const status = computed(() => {
  switch (ui.saveStatus) {
    case "saving":
      return { text: "Saving…", cls: "saving" };
    case "dirty":
      return { text: "Unsaved changes", cls: "dirty" };
    case "error":
      return { text: "Save failed — click to retry", cls: "error" };
    default:
      return { text: "All changes saved", cls: "saved" };
  }
});
</script>

<template>
  <footer class="statusbar">
    <template v-if="doc.isOpen">
      <span class="path" :title="doc.filePath ?? ''">{{ doc.filePath }}</span>
      <button
        class="save-state"
        :class="status.cls"
        :title="ui.saveError ?? 'Changes are saved automatically'"
        @click="flushSave()"
      >
        <span class="dot" />{{ status.text }}
      </button>
    </template>
    <span v-else class="path">No document open</span>
    <span class="zoom" v-if="ui.zoom !== 1">{{ Math.round(ui.zoom * 100) }}%</span>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 24px;
  padding: 0 10px;
  border-top: 1px solid var(--border);
  background: var(--chrome-bg);
  font-size: 12px;
  color: var(--text-muted);
  user-select: none;
}
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.save-state {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  padding: 0 4px;
  cursor: default;
}
.save-state.error {
  color: var(--danger);
  cursor: pointer;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
}
.dirty .dot,
.saving .dot {
  background: var(--warn);
}
.error .dot {
  background: var(--danger);
}
</style>
