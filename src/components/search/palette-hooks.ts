import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchResults } from "@/db/search";
import { recentParam } from "@/lib/recent-refs";
import { keepRecents, readRecents } from "./palette-recents";
import { NO_RECENTS, type PaletteRecents } from "./palette-start-rows";

/** No records before the current request succeeds. */
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
export type SearchStatus = "idle" | "pending" | "success" | "error" | "unauthorized";

export function useShopSearch(query: string, open: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [authorizationLost, setAuthorizationLost] = useState(false);
  const authorizationRevoked = useRef(false);
  // Object identity distinguishes repeats of the same text and a reopened dialog.
  // Results are hidden during render, before the debounce effect can run.
  const request = useMemo(() => ({ query: query.trim(), open, attempt }), [query, open, attempt]);
  const [completed, setCompleted] = useState<{
    request: typeof request;
    status: SearchStatus;
    results: SearchResults;
  }>();
  const onUnauthorized = useCallback(() => {
    // Revoke synchronously: another response may settle before effect cleanup.
    // Only signing in through the recovery link starts a fresh session.
    authorizationRevoked.current = true;
    setAuthorizationLost(true);
  }, []);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const searchable = open && request.query.length >= 2 && !authorizationLost;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(request.query)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted || authorizationRevoked.current) return;
        if (!response.ok) {
          const denied = response.status === 401 || response.status === 403;
          if (denied) onUnauthorized();
          setCompleted({ request, status: denied ? "unauthorized" : "error", results: EMPTY });
          return;
        }
        const results = (await response.json()) as SearchResults;
        if (controller.signal.aborted || authorizationRevoked.current) return;
        setCompleted({ request, status: "success", results });
      } catch {
        // Superseded and closed requests are cancellation, never a failed search.
        if (!controller.signal.aborted && !authorizationRevoked.current) {
          setCompleted({ request, status: "error", results: EMPTY });
        }
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [request, searchable, onUnauthorized]);

  const status: SearchStatus = authorizationLost
    ? "unauthorized"
    : !searchable
      ? "idle"
      : completed?.request === request
        ? completed.status
        : "pending";
  return {
    status,
    results: status === "success" && completed?.request === request ? completed.results : EMPTY,
    authorizationLost,
    retry,
    onUnauthorized,
  };
}

/**
 * **⌘K's recents, read back on opening** (security review F2). The device
 * holds ids only; each time the palette opens they go to the shop-scoped
 * search route, which answers with the words it may show this session. A
 * record that does not come back is forgotten here too. A failed read shows no
 * recents rather than stale ones.
 */
export function usePaletteRecents(
  open: boolean,
  storageKey: string,
  onUnauthorized: () => void,
): PaletteRecents {
  const request = useMemo(() => ({ open, storageKey }), [open, storageKey]);
  const [completed, setCompleted] = useState<{
    request: typeof request;
    recents: PaletteRecents;
  }>();
  useEffect(() => {
    if (!open) {
      return;
    }
    const stored = readRecents(storageKey);
    if (stored.length === 0) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/search?recent=${encodeURIComponent(recentParam(stored))}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) onUnauthorized();
          return;
        }
        const hits = (await response.json()) as SearchResults;
        if (controller.signal.aborted) return;
        const found = new Set([
          ...hits.divers.map((hit) => `diver:${hit.id}`),
          ...hits.trips.map((hit) => `trip:${hit.id}`),
          ...hits.orders.map((hit) => `order:${hit.id}`),
          ...hits.gear.map((hit) => `gear:${hit.id}`),
        ]);
        keepRecents(storageKey, found);
        setCompleted({
          request,
          recents: { stored: stored.filter((row) => found.has(row.key)), hits },
        });
      } catch {
        // Offline or aborted: no recents this time.
      }
    })();
    return () => controller.abort();
  }, [open, storageKey, request, onUnauthorized]);
  return open && completed?.request === request ? completed.recents : NO_RECENTS;
}
