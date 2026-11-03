/**
 * **What this tab last typed, per form and URL, in memory only.** An add
 * panel opens on its index (`/divers?add=1`), so leaving it and pressing Back
 * stays on one route: the router hands back the page it cached on the way in,
 * whose draft was read before anything was typed. The server draft is still
 * written; this is only so a Back inside the same document shows the newest
 * input. Keyed by the full URL, so a door that opens the form prefilled
 * (`?add=1&course=…`) is never written over. A fresh document starts empty
 * here and reads the server draft. No browser storage is used.
 */
const unsaved = new Map<string, Array<[string, string]>>();

export function formDraftMemoryKey(form: string): string {
  if (typeof window === "undefined") return "";
  return `${form} ${window.location.pathname}${window.location.search}`;
}

export function rememberFormDraft(key: string, fields: Array<[string, string]>) {
  if (key) unsaved.set(key, fields);
}

export function recallFormDraft(key: string): Array<[string, string]> | undefined {
  return key ? unsaved.get(key) : undefined;
}

export function forgetFormDraft(key: string) {
  unsaved.delete(key);
}

/** Tests: each starts with nothing remembered (src/test/setup.ts). */
export function forgetAllFormDrafts() {
  unsaved.clear();
}
