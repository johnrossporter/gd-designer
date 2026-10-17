<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useDocumentStore } from "../stores/document";
import { useUiStore } from "../stores/ui";
import { flushSave } from "../services/autosave";

const doc = useDocumentStore();
const ui = useUiStore();

// Show the agent's latest change for a few seconds.
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(tick));
const agentRecent = computed(() => !!ui.mcpActivity && now.value - ui.mcpActivity.at < 6000);

const mcpTitle = computed(() => {
  if (ui.mcp.error) return ui.mcp.error;
  const last = ui.mcpActivity
    ? `\nLast agent change: ${ui.mcpActivity.text} at ${new Date(ui.mcpActivity.at).toLocaleTimeString()}`
    : "";
  return `AI agent access is on (127.0.0.1:${ui.mcp.port})${last}`;
});

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
    <button
      v-if="ui.mcp.enabled"
      class="mcp"
      :class="{ error: !!ui.mcp.error, fresh: agentRecent }"
      :title="mcpTitle"
      @click="ui.mcpDialogOpen = true"
    >
      <span class="dot" />{{ agentRecent ? ui.mcpActivity!.text : ui.mcp.error ? "MCP error" : "MCP" }}
    </button>
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
.mcp {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  padding: 0 4px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mcp .dot {
  background: var(--accent);
}
.mcp.fresh {
  color: var(--accent);
}
.mcp.error {
  color: var(--danger);
}
.mcp.error .dot {
  background: var(--danger);
}
.dirty .dot,
.saving .dot {
  background: var(--warn);
}
.error .dot {
  background: var(--danger);
}
</style>
