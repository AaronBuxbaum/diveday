import { useEffect, useState } from "react";
import type { SearchResults } from "@/db/search";

/** No results: the palette before a query, and after one the server refused. */
export const EMPTY: SearchResults = {
  divers: [],
  trips: [],
  diveSites: [],
  courses: [],
  orders: [],
  gear: [],
};

// ⌘K / Ctrl-K from anywhere toggles the palette. Returns true once the
// listener is attached: the trigger publishes it as the staff surfaces'
// `data-hydrated` flag, so a test that presses ⌘K on a fresh page can wait for
// it rather than lose the keypress to the server-rendered button (issue #2366).
export function useCommandKey(setOpen: (update: (current: boolean) => boolean) => void): boolean {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey);
    setListening(true);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
  return listening;
}

/**
 * Debounced, race-safe shop search. Only queries of 2+ chars hit the server.
 * A GET (rather than the old `searchShopAction` Server Action) so keystrokes
 * don't queue behind Next's per-client Server Action serialization or any
 * in-flight mutation action, and so a stale request can be `AbortController`
 * cancelled instead of merely ignored.
 */
export function useShopSearch(query: string, setResults: (results: SearchResults) => void) {
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(EMPTY);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setResults(EMPTY);
          return;
        }
        setResults((await response.json()) as SearchResults);
      } catch (error) {
        if ((error as { name?: string }).name !== "AbortError") setResults(EMPTY);
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, setResults]);
}
