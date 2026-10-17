<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useUiStore } from "../stores/ui";
import { isTauri } from "../services/platform";
import { mcpEndpoint, regenerateMcpToken, setMcpEnabled, setMcpPort } from "../mcp/service";

const ui = useUiStore();
const showToken = ref(false);
const portInput = ref(String(ui.mcp.port));
const copied = ref<string | null>(null);

watch(
  () => ui.mcp.port,
  (p) => (portInput.value = String(p)),
);

const endpoint = computed(() => mcpEndpoint(ui.mcp.port));
const shownToken = computed(() => (showToken.value ? ui.mcp.token : "•".repeat(24)));

const claudeCommand = computed(
  () =>
    `claude mcp add --transport http gddesigner ${endpoint.value} --header "Authorization: Bearer ${ui.mcp.token}"`,
);
const jsonConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        gddesigner: { type: "http", url: endpoint.value, headers: { Authorization: `Bearer ${ui.mcp.token}` } },
      },
    },
    null,
    2,
  ),
);

async function copy(label: string, text: string) {
  try {
    if (isTauri) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    copied.value = label;
    setTimeout(() => (copied.value = copied.value === label ? null : copied.value), 1500);
  } catch {
    copied.value = null;
  }
}

function applyPort() {
  const port = Number(portInput.value);
  if (port !== ui.mcp.port) void setMcpPort(port);
}

const status = computed(() => {
  if (ui.mcp.error) return { cls: "error", text: ui.mcp.error };
  if (ui.mcp.running) return { cls: "on", text: `Listening on ${endpoint.value}` };
  return { cls: "off", text: "Off" };
});
</script>

<template>
  <div class="backdrop" @mousedown.self="ui.mcpDialogOpen = false">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
      <h3 id="mcp-title">AI Agent Access (MCP)</h3>
      <p class="muted">
        Lets AI agents such as Claude Code read and edit the open document through the Model Context Protocol.
        Agents can list, search, read, create, edit, move and delete pages. Changes appear here immediately and are
        saved automatically.
      </p>

      <label class="toggle">
        <input type="checkbox" :checked="ui.mcp.enabled" :disabled="!isTauri" @change="setMcpEnabled(($event.target as HTMLInputElement).checked)" />
        <span>Allow agents to connect</span>
      </label>
      <div class="status" :class="status.cls"><span class="dot" />{{ status.text }}</div>

      <div class="field">
        <label for="mcp-port">Port</label>
        <input id="mcp-port" v-model="portInput" class="port" inputmode="numeric" @change="applyPort" @keydown.enter="applyPort" />
        <span class="hint">Only reachable from this computer (127.0.0.1).</span>
      </div>

      <div class="field">
        <label>Access token</label>
        <code class="token">{{ shownToken }}</code>
        <button @click="showToken = !showToken">{{ showToken ? "Hide" : "Show" }}</button>
        <button @click="copy('token', ui.mcp.token)">{{ copied === "token" ? "Copied" : "Copy" }}</button>
        <button title="Create a new token; connected agents will need the new one" @click="regenerateMcpToken">New</button>
      </div>

      <h4>Connect Claude Code</h4>
      <div class="snippet">
        <pre>claude mcp add --transport http gddesigner {{ endpoint }} --header "Authorization: Bearer {{ showToken ? ui.mcp.token : '…' }}"</pre>
        <button @click="copy('cmd', claudeCommand)">{{ copied === "cmd" ? "Copied" : "Copy" }}</button>
      </div>

      <h4>Other MCP clients (JSON config)</h4>
      <div class="snippet">
        <pre>{{ showToken ? jsonConfig : jsonConfig.replace(ui.mcp.token, "…") }}</pre>
        <button @click="copy('json', jsonConfig)">{{ copied === "json" ? "Copied" : "Copy" }}</button>
      </div>

      <p class="muted small">Keep the token private: anyone with it can change your notes while GDDesigner is open.</p>
      <div class="buttons"><button class="primary" @click="ui.mcpDialogOpen = false">Close</button></div>
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
  width: min(620px, calc(100vw - 32px));
  max-height: 88vh;
  overflow: auto;
  padding: 18px 20px 16px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}
h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
h4 {
  margin: 16px 0 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
p {
  margin: 0 0 12px;
  line-height: 1.5;
}
.muted {
  color: var(--text-muted);
}
.small {
  font-size: 12px;
  margin-top: 12px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  cursor: pointer;
}
.toggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 14px 24px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.status.error {
  color: var(--danger);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
  flex: none;
}
.on .dot {
  background: var(--ok);
}
.error .dot {
  background: var(--danger);
}
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.field label {
  width: 96px;
  color: var(--text-muted);
}
.port {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
}
.hint {
  font-size: 12px;
  color: var(--text-muted);
}
.token {
  flex: 1;
  min-width: 160px;
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--hover);
  font-family: var(--font-code);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button:not(.primary) {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel-bg);
  color: var(--text);
  cursor: pointer;
}
button:not(.primary):hover {
  background: var(--hover);
}
.snippet {
  position: relative;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.snippet pre {
  flex: 1;
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--hover);
  font-family: var(--font-code);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
