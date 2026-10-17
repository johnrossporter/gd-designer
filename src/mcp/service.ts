import { invoke } from "@tauri-apps/api/core";
import { useUiStore } from "../stores/ui";
import { isTauri } from "../services/platform";
import { saveSetting, type Settings } from "../services/settings";
import { handleMcpMessage } from "./handler";

/**
 * Runs the local MCP endpoint: starts/stops the Rust HTTP listener and answers
 * the `mcp-request` events it forwards.
 */

export function mcpEndpoint(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let listening = false;

async function listenForRequests() {
  if (listening || !isTauri) return;
  listening = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ id: number; body: string }>("mcp-request", async ({ payload }) => {
    let response = "";
    try {
      const result = await handleMcpMessage(JSON.parse(payload.body));
      response = result ? JSON.stringify(result) : "";
    } catch (e) {
      const parseError = e instanceof SyntaxError;
      response = JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: parseError ? -32700 : -32603, message: parseError ? "Parse error" : String(e) },
      });
    }
    await invoke("mcp_respond", { id: payload.id, response });
  });
}

/** Starts or stops the endpoint to match the current settings. */
export async function applyMcp(): Promise<void> {
  const ui = useUiStore();
  if (!isTauri) {
    ui.mcp.running = false;
    ui.mcp.error = ui.mcp.enabled ? "Agent access is only available in the desktop app." : null;
    return;
  }
  await listenForRequests();
  if (!ui.mcp.enabled) {
    await invoke("mcp_stop");
    ui.mcp.running = false;
    ui.mcp.error = null;
    return;
  }
  try {
    await invoke("mcp_start", { port: ui.mcp.port, token: ui.mcp.requireToken ? ui.mcp.token : null });
    ui.mcp.running = true;
    ui.mcp.error = null;
  } catch (e) {
    ui.mcp.running = false;
    ui.mcp.error = String(e);
  }
}

/** Loads MCP settings at startup (creating a token the first time) and applies them. */
export async function initMcp(settings: Settings): Promise<void> {
  const ui = useUiStore();
  ui.mcp.enabled = settings.mcpEnabled === true;
  ui.mcp.port = Number.isInteger(settings.mcpPort) ? settings.mcpPort : 3917;
  ui.mcp.token = typeof settings.mcpToken === "string" ? settings.mcpToken : "";
  ui.mcp.requireToken = settings.mcpRequireToken !== false;
  if (ui.mcp.token.length < 16) {
    ui.mcp.token = generateToken();
    await saveSetting("mcpToken", ui.mcp.token);
  }
  await applyMcp();
}

export async function setMcpEnabled(enabled: boolean) {
  const ui = useUiStore();
  ui.mcp.enabled = enabled;
  await saveSetting("mcpEnabled", enabled);
  await applyMcp();
}

export async function setMcpPort(port: number) {
  const ui = useUiStore();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    ui.mcp.error = "Port must be a number between 1024 and 65535.";
    return;
  }
  ui.mcp.port = port;
  await saveSetting("mcpPort", port);
  await applyMcp();
}

export async function setMcpRequireToken(required: boolean) {
  const ui = useUiStore();
  ui.mcp.requireToken = required;
  await saveSetting("mcpRequireToken", required);
  await applyMcp();
}

export async function regenerateMcpToken() {
  const ui = useUiStore();
  ui.mcp.token = generateToken();
  await saveSetting("mcpToken", ui.mcp.token);
  await applyMcp();
}
