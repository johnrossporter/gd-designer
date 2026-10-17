<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { callCommand, insert, replaceAll } from "@milkdown/kit/utils";
import { redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { selectAll as selectAllCommand } from "@milkdown/kit/prose/commands";
import { TextSelection } from "@milkdown/kit/prose/state";
import "@milkdown/crepe/theme/common/style.css";
import { pageLinkPlugins } from "./pageLinkPlugin";
import { clearActiveEditor, setActiveEditor, type EditorHandle } from "./bridge";
import { useDocumentStore } from "../stores/document";
import { openExternalUrl } from "../services/fileService";
import { parsePageUrl } from "../lib/pageLinks";

const props = defineProps<{ pageId: string }>();
const emit = defineEmits<{
  navigate: [pageId: string];
  requestLink: [];
}>();

const doc = useDocumentStore();
const root = ref<HTMLElement | null>(null);
let crepe: Crepe | null = null;
let ready = false;
let destroyed = false;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Set when the user has edited since the last save (avoids re-saving normalised but unedited markdown). */
let dirty = false;
/** The page content the editor last loaded or saved; anything else in the store came from outside. */
let lastSynced = doc.pages[props.pageId]?.content ?? "";

function save(markdown: string) {
  dirty = false;
  lastSynced = markdown;
  doc.setContent(props.pageId, markdown);
}

// Content changed by someone other than this editor (an AI agent via MCP, or
// link text rewritten after a rename): load it into the editor.
watch(
  () => doc.pages[props.pageId]?.content,
  (content) => {
    if (content === undefined || content === lastSynced || !crepe || !ready) return;
    lastSynced = content;
    dirty = false;
    crepe.editor.action(replaceAll(content));
  },
);

function withView<T>(fn: (view: import("@milkdown/kit/prose/view").EditorView) => T): T | undefined {
  if (!crepe || !ready) return undefined;
  return crepe.editor.action((ctx) => fn(ctx.get(editorViewCtx)));
}

const { remarkPageLink, pageLinkSchema, pageLinkView, pageLinkInput } = pageLinkPlugins({
  getTitle: (id) => doc.pages[id]?.title,
  onOpen: (id) => emit("navigate", id),
  onRequestLink: () => emit("requestLink"),
});

const handle: EditorHandle = {
  undo: () => crepe?.editor.action(callCommand(undoCommand.key)),
  redo: () => crepe?.editor.action(callCommand(redoCommand.key)),
  selectAll: () => withView((view) => selectAllCommand(view.state, view.dispatch)),
  focus: () => withView((view) => view.focus()),
  insertMarkdown: (markdown) => {
    if (!crepe || !ready) return;
    crepe.editor.action(insert(markdown));
  },
  insertPageLink: (pageId) =>
    withView((view) => {
      const type = crepe!.editor.action((ctx) => pageLinkSchema.type(ctx));
      const node = type.create({ pageId, label: doc.pages[pageId]?.title ?? "" });
      const tr = view.state.tr.replaceSelectionWith(node, false);
      // Leave the cursor after the link, followed by a space for convenience.
      const after = tr.selection.to;
      tr.insertText(" ", after);
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    }),
  flush: () => {
    if (crepe && ready && dirty) save(crepe.getMarkdown());
  },
  hasFocus: () => withView((view) => view.hasFocus()) ?? false,
};

/** Ordinary (non-page) links open in the system browser instead of the app window. */
function onClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a || a.classList.contains("page-link")) return;
  const href = a.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  const pageId = parsePageUrl(href);
  if (pageId) emit("navigate", pageId);
  else if (/^(https?|mailto):/i.test(href) && (e.ctrlKey || e.metaKey)) void openExternalUrl(href);
}

onMounted(async () => {
  const page = doc.pages[props.pageId];
  crepe = new Crepe({
    root: root.value,
    defaultValue: page?.content ?? "",
    features: {
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: "Start writing… type / for blocks, [[ to link a page",
        mode: "doc",
      },
      [Crepe.Feature.ImageBlock]: {
        onUpload: readFileAsDataUrl,
        inlineOnUpload: readFileAsDataUrl,
        blockOnUpload: readFileAsDataUrl,
      },
    },
  });
  crepe.editor.use(remarkPageLink).use(pageLinkSchema).use(pageLinkView).use(pageLinkInput);
  crepe.on((listener) => {
    listener.updated(() => {
      dirty = true;
    });
    listener.markdownUpdated((_ctx, markdown) => save(markdown));
  });
  await crepe.create();
  if (destroyed) {
    await crepe.destroy();
    return;
  }
  ready = true;
  setActiveEditor(handle);
});

onBeforeUnmount(() => {
  handle.flush();
  destroyed = true;
  ready = false;
  clearActiveEditor(handle);
  void crepe?.destroy();
});

defineExpose(handle);
</script>

<template>
  <div ref="root" class="markdown-editor" @click="onClick" />
</template>
