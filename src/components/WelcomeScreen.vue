<script setup lang="ts">
import { useUiStore } from "../stores/ui";
import { baseName } from "../services/platform";
import * as A from "../services/actions";

const ui = useUiStore();
</script>

<template>
  <div class="welcome">
    <div class="card">
      <h1>GDDesigner</h1>
      <p class="tagline">Notes, writing and world building — one page at a time.</p>
      <div class="actions">
        <button class="primary" @click="A.newDocument()">New Document…</button>
        <button @click="A.openDocument()">Open…</button>
      </div>
      <div v-if="ui.recentFiles.length" class="recent">
        <h2>Recent</h2>
        <ul>
          <li v-for="path in ui.recentFiles" :key="path">
            <button class="recent-item" :title="path" @click="A.openDocumentAt(path)">
              <span class="name">{{ baseName(path) }}</span>
              <span class="where">{{ path }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--page-bg);
  overflow: auto;
}
.card {
  width: min(520px, calc(100vw - 32px));
  padding: 32px 0;
}
h1 {
  margin: 0;
  font-family: var(--font-title);
  font-size: 36px;
}
.tagline {
  margin: 6px 0 22px;
  color: var(--text-muted);
}
.actions {
  display: flex;
  gap: 8px;
}
.recent {
  margin-top: 32px;
}
h2 {
  margin: 0 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.recent-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.recent-item:hover {
  background: var(--hover);
}
.where {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
