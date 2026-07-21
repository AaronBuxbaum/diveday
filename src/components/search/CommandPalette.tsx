"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { searchShopAction } from "@/app/actions/search";
import type { SearchResults } from "@/db/search";

type PaletteItem = { key: string; label: string; detail?: string; href: string };
type PaletteGroup = { heading: string; items: PaletteItem[] };

const GO_TO: { label: string; suffix: string }[] = [
  { label: "Today", suffix: "" },
  { label: "Blockers", suffix: "/blockers" },
  { label: "Schedule", suffix: "/schedule" },
  { label: "Divers", suffix: "/divers" },
  { label: "Waivers", suffix: "/waivers" },
  { label: "Settings", suffix: "/settings/payments" },
];

const EMPTY: SearchResults = { divers: [], trips: [] };

/**
 * Global search for the front desk: "pull up Priya" without navigating to a
 * list first. Opened by ⌘K / Ctrl-K or the nav button. A hand-rolled combobox
 * (no new dependency) with correct ARIA and full keyboard control; results are
 * shop-scoped server-side and debounced. Selecting a diver opens their record,
 * a trip its staff page, a shortcut its surface.
 */
export function CommandPalette({
  shopSlug,
  boatBoardingHref,
}: {
  shopSlug: string;
  boatBoardingHref?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const root = `/shop/${shopSlug}`;

  // ⌘K / Ctrl-K from anywhere opens the palette.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery("");
      setResults(EMPTY);
      setActive(0);
    }
  }, [open]);

  // Debounced, race-safe shop search. Only queries of 2+ chars hit the server.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(EMPTY);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const next = await searchShopAction(trimmed);
        if (!cancelled) setResults(next);
      } catch {
        if (!cancelled) setResults(EMPTY);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const goto: PaletteItem[] = [];
    if (boatBoardingHref && ("boarding".includes(q) || "boat".includes(q) || q === "")) {
      goto.push({ key: "goto:boarding", label: "Boarding — today's boat", href: boatBoardingHref });
    }
    for (const entry of GO_TO) {
      if (q === "" || entry.label.toLowerCase().includes(q)) {
        goto.push({
          key: `goto:${entry.suffix}`,
          label: entry.label,
          href: `${root}${entry.suffix}`,
        });
      }
    }
    const out: PaletteGroup[] = [];
    if (results.divers.length > 0) {
      out.push({
        heading: "Divers",
        items: results.divers.map((diver) => ({
          key: `diver:${diver.id}`,
          label: diver.fullName,
          detail: diver.detail ?? undefined,
          href: `${root}/divers/${diver.id}`,
        })),
      });
    }
    if (results.trips.length > 0) {
      out.push({
        heading: "Trips",
        items: results.trips.map((trip) => ({
          key: `trip:${trip.id}`,
          label: trip.title,
          detail: trip.detail,
          href: `${root}/trips/${trip.id}`,
        })),
      });
    }
    if (goto.length > 0) out.push({ heading: "Go to", items: goto });
    return out;
  }, [results, query, boatBoardingHref, root]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // Keep the active row in range as results change.
  useEffect(() => {
    setActive((current) => (flat.length === 0 ? 0 : Math.min(current, flat.length - 1)));
  }, [flat.length]);

  const go = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(flat[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const activeKey = flat[active]?.key;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Search"
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-border bg-surface-sunken px-1.5 text-xs font-semibold text-muted sm:inline">
          ⌘K
        </kbd>
      </button>

      {open ? (
        // Click-away backdrop; Escape and the toggle button also close it.
        // biome-ignore lint/a11y/noStaticElementInteractions: presentational backdrop
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/30 px-4 pt-[12vh] backdrop-blur-sm"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeKey ? `${listId}-${activeKey}` : undefined}
              aria-label="Search divers, trips, and pages"
              autoComplete="off"
              placeholder="Search divers, trips, or jump to a page…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="w-full border-b border-border bg-transparent px-5 py-4 text-base outline-none placeholder:text-muted"
            />
            <div id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-2">
              {flat.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted">
                  {query.trim().length < 2
                    ? "Type to search people and trips, or jump to a page."
                    : "No matches. Try a name, email, or trip title."}
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.heading}>
                    <p className="px-5 pt-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
                      {group.heading}
                    </p>
                    {group.items.map((item) => {
                      const isActive = item.key === activeKey;
                      return (
                        <button
                          key={item.key}
                          id={`${listId}-${item.key}`}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          tabIndex={-1}
                          onMouseMove={() =>
                            setActive(flat.findIndex((entry) => entry.key === item.key))
                          }
                          onClick={() => go(item)}
                          className={`flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left ${
                            isActive ? "bg-primary/10" : ""
                          }`}
                        >
                          <span className="min-w-0 truncate font-medium">{item.label}</span>
                          {item.detail ? (
                            <span className="shrink-0 truncate text-sm text-muted">
                              {item.detail}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
