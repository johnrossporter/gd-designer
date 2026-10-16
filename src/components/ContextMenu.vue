<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { MenuItem } from "../composables/menu";

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ close: [] }>();

const el = ref<HTMLElement | null>(null);
const pos = ref({ left: props.x, top: props.y });

async function place() {
  await nextTick();
  const box = el.value?.getBoundingClientRect();
  if (!box) return;
  pos.value = {
    left: Math.min(props.x, window.innerWidth - box.width - 4),
    top: Math.min(props.y, window.innerHeight - box.height - 4),
  };
}

watch(() => [props.x, props.y], place);

function run(item: MenuItem) {
  if (item.disabled || item.separator) return;
  emit("close");
  void item.action?.();
}

function onDown(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) emit("close");
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    emit("close");
  }
}

onMounted(() => {
  place();
  window.addEventListener("mousedown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", () => emit("close"));
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onDown, true);
  window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <ul ref="el" class="context-menu" role="menu" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" @contextmenu.prevent>
    <template v-for="(item, i) in items" :key="i">
      <li v-if="item.separator" class="sep" role="separator" />
      <li v-else class="item" :class="{ disabled: item.disabled }" role="menuitem" @click="run(item)">
        <span>{{ item.label }}</span>
        <span class="shortcut">{{ item.shortcut }}</span>
      </li>
    </template>
  </ul>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 100;
  min-width: 210px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow);
  user-select: none;
}
.item {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: default;
}
.item:hover:not(.disabled) {
  background: var(--accent-soft);
}
.item.disabled {
  color: var(--text-faint);
}
.shortcut {
  color: var(--text-muted);
  font-size: 12px;
}
.sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
