<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { useDocumentStore } from "./stores/document";
import { useUiStore } from "./stores/ui";
import { handleShortcut } from "./composables/menu";
import { flushSave, startAutosave } from "./services/autosave";
import { loadSettings, saveSetting } from "./services/settings";
import { openDocumentAt } from "./services/actions";
import { isTauri } from "./services/platform";
import MenuBar from "./components/MenuBar.vue";
import HierarchyPane from "./components/HierarchyPane.vue";
import PageView from "./components/PageView.vue";
import StatusBar from "./components/StatusBar.vue";
import WelcomeScreen from "./components/WelcomeScreen.vue";
import PagePicker from "./components/PagePicker.vue";
import Dialogs from "./components/Dialogs.vue";

const doc = useDocumentStore();
const ui = useUiStore();
const booting = ref(true);

// ------------------------------------------------------------------ theme

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const prefersDark = ref(systemDark.matches);
const onSystemTheme = (e: MediaQueryListEvent) => (prefersDark.value = e.matches);
systemDark.addEventListener("change", onSystemTheme);

watchEffect(() => {
  const dark = ui.theme === "dark" || (ui.theme === "system" && prefersDark.value);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
});

// ------------------------------------------------------------------ window title

watchEffect(async () => {
  const title = doc.isOpen ? `${doc.title || "Untitled"} - GDDesigner` : "GDDesigner";
  document.title = title;
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  }
});

// ------------------------------------------------------------------ hierarchy splitter

const resizing = ref(false);

function startResize(e: PointerEvent) {
  resizing.value = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}
function onResize(e: PointerEvent) {
  if (!resizing.value) return;
  ui.hierarchyWidth = Math.round(Math.max(180, Math.min(e.clientX, window.innerWidth * 0.6)));
}
function endResize() {
  if (!resizing.value) return;
  resizing.value = false;
  void saveSetting("hierarchyWidth", ui.hierarchyWidth);
}

const gridColumns = computed(() =>
  ui.hierarchyVisible ? `${ui.hierarchyWidth}px 5px minmax(0, 1fr)` : "minmax(0, 1fr)",
);

// ------------------------------------------------------------------ keyboard

const modalOpen = computed(() => !!(ui.picker || ui.confirmRequest || ui.aboutOpen || ui.shortcutsOpen));

function onKeydown(e: KeyboardEvent) {
  if (modalOpen.value) {
    if (e.key === "Escape" && !ui.picker) {
      ui.confirmRequest?.resolve(false);
      ui.aboutOpen = false;
      ui.shortcutsOpen = false;
      e.preventDefault();
    }
    return;
  }
  handleShortcut(e);
}

// ------------------------------------------------------------------ lifecycle

let unlistenClose: (() => void) | null = null;

function onBeforeUnload() {
  void flushSave();
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("beforeunload", onBeforeUnload);

  const settings = await loadSettings();
  ui.theme = settings.theme;
  ui.zoom = settings.zoom;
  ui.hierarchyWidth = settings.hierarchyWidth;
  ui.hierarchyVisible = settings.hierarchyVisible;
  ui.recentFiles = settings.recentFiles;
  startAutosave();

  if (settings.lastFile) await openDocumentAt(settings.lastFile, { silent: true });
  booting.value = false;

  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    // Make sure the last edits reach the disk before the window goes away.
    unlistenClose = await win.onCloseRequested(async (event) => {
      const ok = await flushSave();
      if (!ok) {
        event.preventDefault();
        const discard = await ui.confirm({
          title: "Unsaved changes",
          message: `Your latest changes could not be saved (${ui.saveError}). Quit anyway?`,
          okLabel: "Quit without saving",
          danger: true,
        });
        if (discard) await win.destroy();
      }
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("beforeunload", onBeforeUnload);
  systemDark.removeEventListener("change", onSystemTheme);
  unlistenClose?.();
});
</script>

<template>
  <div class="app" :class="{ resizing }">
    <MenuBar />
    <main v-if="doc.isOpen" class="workspace" :style="{ gridTemplateColumns: gridColumns }">
      <HierarchyPane v-if="ui.hierarchyVisible" />
      <div
        v-if="ui.hierarchyVisible"
        class="splitter"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="startResize"
        @pointermove="onResize"
        @pointerup="endResize"
        @pointercancel="endResize"
        @dblclick="ui.hierarchyWidth = 280"
      />
      <PageView />
    </main>
    <main v-else class="workspace single">
      <WelcomeScreen v-if="!booting" />
    </main>
    <StatusBar />
    <PagePicker v-if="ui.picker" />
    <Dialogs />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100vh;
}
.app.resizing {
  cursor: col-resize;
  user-select: none;
}
.workspace {
  display: grid;
  min-height: 0;
}
.workspace.single {
  grid-template-columns: 1fr;
}
.splitter {
  cursor: col-resize;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  touch-action: none;
}
.splitter:hover,
.resizing .splitter {
  background: var(--accent-soft);
}
</style>
