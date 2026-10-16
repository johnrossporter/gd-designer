import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import type { ThemeSetting } from "../services/settings";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export interface ConfirmRequest {
  title: string;
  message: string;
  okLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export type PickerPurpose = "insert-link" | "go-to";

export const useUiStore = defineStore("ui", () => {
  const activePageId = ref<string | null>(null);
  const filter = ref("");
  /** Ids of expanded tree nodes. */
  const expanded = reactive<Record<string, boolean>>({});
  /** Page whose title is being edited inline in the hierarchy. */
  const renamingId = ref<string | null>(null);

  const theme = ref<ThemeSetting>("system");
  const zoom = ref(1);
  const hierarchyVisible = ref(true);
  const hierarchyWidth = ref(280);

  const saveStatus = ref<SaveStatus>("saved");
  const saveError = ref<string | null>(null);
  const recentFiles = ref<string[]>([]);

  const picker = ref<PickerPurpose | null>(null);
  const confirmRequest = ref<ConfirmRequest | null>(null);
  const aboutOpen = ref(false);
  const shortcutsOpen = ref(false);

  /** Incremented to ask a component to take focus. */
  const focusFilterTick = ref(0);
  const focusTitleTick = ref(0);
  const focusEditorTick = ref(0);

  function confirm(opts: { title: string; message: string; okLabel?: string; danger?: boolean }): Promise<boolean> {
    confirmRequest.value?.resolve(false);
    return new Promise((resolve) => {
      confirmRequest.value = {
        title: opts.title,
        message: opts.message,
        okLabel: opts.okLabel ?? "OK",
        danger: opts.danger ?? false,
        resolve: (ok) => {
          confirmRequest.value = null;
          resolve(ok);
        },
      };
    });
  }

  function setExpanded(id: string, value: boolean) {
    if (value) expanded[id] = true;
    else delete expanded[id];
  }

  function resetForDocument() {
    activePageId.value = null;
    filter.value = "";
    renamingId.value = null;
    for (const id of Object.keys(expanded)) delete expanded[id];
  }

  return {
    activePageId,
    filter,
    expanded,
    renamingId,
    theme,
    zoom,
    hierarchyVisible,
    hierarchyWidth,
    saveStatus,
    saveError,
    recentFiles,
    picker,
    confirmRequest,
    aboutOpen,
    shortcutsOpen,
    focusFilterTick,
    focusTitleTick,
    focusEditorTick,
    confirm,
    setExpanded,
    resetForDocument,
  };
});
