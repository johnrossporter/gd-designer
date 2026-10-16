/** True when running inside the Tauri webview (false in a plain browser preview). */
export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** File name without folders or the `.gdd.json` / `.json` extension. */
export function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.gdd\.json$/i, "").replace(/\.json$/i, "");
}
