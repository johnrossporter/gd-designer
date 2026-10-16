<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { buildMenus, type MenuItem } from "../composables/menu";

const menus = buildMenus();
const openIndex = ref<number | null>(null);
/** Highlighted item in the open menu (keyboard navigation). */
const activeItem = ref(-1);
const openSubmenu = ref<number | null>(null);
const barEl = ref<HTMLElement | null>(null);

const items = computed<MenuItem[]>(() => (openIndex.value === null ? [] : menus[openIndex.value].items()));

function open(i: number, viaKeyboard = false) {
  openIndex.value = i;
  openSubmenu.value = null;
  activeItem.value = viaKeyboard ? firstEnabled(menus[i].items(), 0, 1) : -1;
}

function close() {
  openIndex.value = null;
  openSubmenu.value = null;
  activeItem.value = -1;
}

function toggle(i: number) {
  if (openIndex.value === i) close();
  else open(i);
}

function hover(i: number) {
  if (openIndex.value !== null && openIndex.value !== i) open(i);
}

function run(item: MenuItem) {
  if (item.disabled || item.separator) return;
  if (item.submenu) return;
  close();
  void item.action?.();
}

function firstEnabled(list: MenuItem[], from: number, dir: 1 | -1): number {
  const n = list.length;
  for (let step = 0; step < n; step++) {
    const i = (((from + step * dir) % n) + n) % n;
    if (!list[i].separator && !list[i].disabled) return i;
  }
  return -1;
}

function onKeydown(e: KeyboardEvent) {
  // Alt+<mnemonic> opens a menu from anywhere.
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.length === 1) {
    const i = menus.findIndex((m) => m.mnemonic === e.key.toLowerCase());
    if (i >= 0) {
      e.preventDefault();
      e.stopPropagation();
      open(i, true);
      return;
    }
  }
  if (openIndex.value === null) return;
  const list = items.value;
  const sub = openSubmenu.value !== null ? list[openSubmenu.value].submenu ?? [] : null;
  switch (e.key) {
    case "Escape":
      if (sub) openSubmenu.value = null;
      else close();
      break;
    case "ArrowDown":
      activeItem.value = firstEnabled(list, activeItem.value + 1, 1);
      openSubmenu.value = null;
      break;
    case "ArrowUp":
      activeItem.value = firstEnabled(list, activeItem.value - 1 + list.length, -1);
      openSubmenu.value = null;
      break;
    case "ArrowRight": {
      const item = list[activeItem.value];
      if (item?.submenu && !item.disabled) openSubmenu.value = activeItem.value;
      else open((openIndex.value + 1) % menus.length, true);
      break;
    }
    case "ArrowLeft":
      if (sub) openSubmenu.value = null;
      else open((openIndex.value - 1 + menus.length) % menus.length, true);
      break;
    case "Enter":
    case " ": {
      const item = list[activeItem.value];
      if (item?.submenu && !item.disabled) openSubmenu.value = activeItem.value;
      else if (item) run(item);
      break;
    }
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}

function onDocMouseDown(e: MouseEvent) {
  if (openIndex.value !== null && barEl.value && !barEl.value.contains(e.target as Node)) close();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("mousedown", onDocMouseDown, true);
  window.addEventListener("blur", close);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("mousedown", onDocMouseDown, true);
  window.removeEventListener("blur", close);
});

defineExpose({ isOpen: () => openIndex.value !== null });
</script>

<template>
  <nav ref="barEl" class="menubar" role="menubar" @mousedown.prevent>
    <div v-for="(menu, i) in menus" :key="menu.label" class="menu-root">
      <button
        class="menu-title"
        :class="{ open: openIndex === i }"
        role="menuitem"
        :aria-expanded="openIndex === i"
        tabindex="-1"
        @click="toggle(i)"
        @mouseenter="hover(i)"
      >
        <u>{{ menu.label[0] }}</u>{{ menu.label.slice(1) }}
      </button>
      <ul v-if="openIndex === i" class="menu-dropdown" role="menu">
        <template v-for="(item, j) in items" :key="j">
          <li v-if="item.separator" class="menu-sep" role="separator" />
          <li
            v-else
            class="menu-item"
            role="menuitem"
            :class="{ disabled: item.disabled, active: activeItem === j, 'has-sub': item.submenu }"
            :aria-disabled="item.disabled"
            @mouseenter="activeItem = j; openSubmenu = item.submenu && !item.disabled ? j : null"
            @click="run(item)"
          >
            <span class="menu-check">{{ item.checked ? "✓" : "" }}</span>
            <span class="menu-label">{{ item.label }}</span>
            <span class="menu-shortcut">{{ item.shortcut }}</span>
            <span class="menu-arrow">{{ item.submenu ? "›" : "" }}</span>
            <ul v-if="item.submenu && openSubmenu === j" class="menu-dropdown submenu" role="menu">
              <li v-if="item.submenu.length === 0" class="menu-item disabled">
                <span class="menu-check" /><span class="menu-label">(empty)</span>
              </li>
              <li
                v-for="(sub, k) in item.submenu"
                :key="k"
                class="menu-item"
                :class="{ disabled: sub.disabled }"
                role="menuitem"
                @click.stop="run(sub)"
              >
                <span class="menu-check">{{ sub.checked ? "✓" : "" }}</span>
                <span class="menu-label">{{ sub.label }}</span>
                <span class="menu-shortcut">{{ sub.shortcut }}</span>
                <span class="menu-arrow" />
              </li>
            </ul>
          </li>
        </template>
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.menubar {
  display: flex;
  align-items: stretch;
  height: 30px;
  padding: 0 4px;
  background: var(--chrome-bg);
  border-bottom: 1px solid var(--border);
  user-select: none;
  position: relative;
  z-index: 50;
}
.menu-root {
  position: relative;
  display: flex;
}
.menu-title {
  background: none;
  border: none;
  color: var(--text);
  font: inherit;
  padding: 0 10px;
  border-radius: 4px;
  margin: 3px 0;
  cursor: default;
}
.menu-title u {
  text-decoration: none;
}
.menubar:focus-within .menu-title u,
.menu-title.open u {
  text-decoration: underline;
}
.menu-title:hover,
.menu-title.open {
  background: var(--hover);
}
.menu-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 240px;
  width: max-content;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow);
}
.submenu {
  top: -5px;
  left: 100%;
  max-width: 560px;
}
.menu-item {
  position: relative;
  display: grid;
  grid-template-columns: 18px 1fr auto 14px;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 4px;
  white-space: nowrap;
  cursor: default;
}
.menu-item .menu-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu-item.active:not(.disabled),
.menu-item:hover:not(.disabled) {
  background: var(--accent-soft);
}
.menu-item.disabled {
  color: var(--text-faint);
}
.menu-shortcut {
  color: var(--text-muted);
  font-size: 12px;
  padding-left: 24px;
}
.menu-check,
.menu-arrow {
  text-align: center;
  color: var(--text-muted);
}
.menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
