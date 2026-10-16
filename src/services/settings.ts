import { isTauri } from "./platform";

/**
 * App-level settings (recent files, last document, UI preferences), kept in
 * the Tauri store plugin's `settings.json` in the app data folder, or in
 * localStorage in a browser preview.
 */

export type ThemeSetting = "system" | "light" | "dark";

export interface Settings {
  recentFiles: string[];
  lastFile: string | null;
  theme: ThemeSetting;
  zoom: number;
  hierarchyWidth: number;
  hierarchyVisible: boolean;
}

export const defaultSettings: Settings = {
  recentFiles: [],
  lastFile: null,
  theme: "system",
  zoom: 1,
  hierarchyWidth: 280,
  hierarchyVisible: true,
};

const MAX_RECENT = 10;
const LOCAL_KEY = "gddesigner:settings";

type StoreLike = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

let storePromise: Promise<StoreLike | null> | null = null;

function getStore(): Promise<StoreLike | null> {
  if (!storePromise) {
    storePromise = isTauri
      ? import("@tauri-apps/plugin-store").then(({ load }) =>
          load("settings.json", { autoSave: 200, defaults: {} }) as Promise<StoreLike>,
        )
      : Promise.resolve(null);
  }
  return storePromise;
}

function readLocal(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export async function loadSettings(): Promise<Settings> {
  const store = await getStore();
  if (!store) return { ...defaultSettings, ...readLocal() };
  const out = { ...defaultSettings };
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    const value = await store.get(key);
    if (value !== undefined && value !== null) (out as Record<string, unknown>)[key] = value;
    else if (key === "lastFile") out.lastFile = null;
  }
  return out;
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const store = await getStore();
  if (!store) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(), [key]: value }));
    return;
  }
  await store.set(key, value);
}

export function withRecent(list: string[], path: string): string[] {
  const norm = (p: string) => p.toLowerCase();
  return [path, ...list.filter((p) => norm(p) !== norm(path))].slice(0, MAX_RECENT);
}
