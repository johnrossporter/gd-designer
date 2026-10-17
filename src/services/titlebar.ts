import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

/**
 * Colors the native Windows title bar like the app's menu bar, using the
 * current theme's CSS variables (call after the theme is applied).
 */
export async function syncTitlebarColors(dark: boolean): Promise<void> {
  if (!isTauri) return;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => css.getPropertyValue(name).trim();
  try {
    await invoke("set_titlebar_colors", {
      caption: read("--chrome-bg"),
      text: read("--text"),
      border: read("--border"),
      dark,
    });
  } catch (e) {
    console.warn("Could not color the title bar:", e);
  }
}
