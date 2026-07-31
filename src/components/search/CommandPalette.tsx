"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchShopAction } from "@/app/actions/search";
import { useFocusTrap } from "@/components/useFocusTrap";
import type { SearchResults } from "@/db/search";

type PaletteItem = { key: string; label: string; detail?: string; href: string };
type PaletteGroup = { heading: string; items: PaletteItem[] };

const EMPTY: SearchResults = { divers: [], trips: [], diveSites: [], courses: [], orders: [] };

export type CommandPaletteCopy = {
  search: string;
  dialogAriaLabel: string;
  comboboxAriaLabel: string;
  placeholder: string;
  emptyShort: string;
  emptyNoMatches: string;
  groupDivers: string;
  groupTrips: string;
  groupDiveSites: string;
  groupCourses: string;
  groupOrders: string;
  groupGoTo: string;
  goToToday: string;
  goToBlockers: string;
  goToCheckIn: string;
  goToStaffing: string;
  goToDiveSites: string;
  goToCourses: string;
  goToReviews: string;
  goToReports: string;
  goToPromos: string;
  goToSchedule: string;
  goToDivers: string;
  goToSettings: string;
  goToWaivers: string;
  goToBoarding: string;
  goToWalkIn: string;
  goToOfflineRollCall: string;
  goToOrders: string;
};

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
  canManageWaivers,
  canManageReports,
  copy,
}: {
  shopSlug: string;
  boatBoardingHref?: string;
  canManageWaivers: boolean;
  /** Owner/manager surfaces (H-14) — Reports and Promo codes, same gate as the nav. */
  canManageReports: boolean;
  copy: CommandPaletteCopy;
}) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const root = `/shop/${shopSlug}`;

  useFocusTrap(open, dialogRef);

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
      goto.push({ key: "goto:boarding", label: copy.goToBoarding, href: boatBoardingHref });
    }
    // Not shop-scoped (the offline snapshot lives per-device, not per-shop
    // route) so this doesn't need a `boatBoardingHref`-style prop — it's
    // always the same URL and always findable, per task 77 (persona 10, Sal):
    // the entry point used to be only a button below the live manifest
    // header, easy to miss on a device that's about to lose signal.
    if (q === "" || "offline".includes(q) || "roll call".includes(q) || "manifest".includes(q)) {
      goto.push({
        key: "goto:offline-roll-call",
        label: copy.goToOfflineRollCall,
        href: "/offline-manifest",
      });
    }
    const baseGoTo: { label: string; suffix: string }[] = [
      { label: copy.goToToday, suffix: "" },
      { label: copy.goToWalkIn, suffix: "/check-in/walk-in" },
      { label: copy.goToBlockers, suffix: "/blockers" },
      { label: copy.goToCheckIn, suffix: "/check-in" },
      { label: copy.goToSchedule, suffix: "/schedule" },
      { label: copy.goToDivers, suffix: "/divers" },
      { label: copy.goToStaffing, suffix: "/staffing" },
      { label: copy.goToDiveSites, suffix: "/dive-sites" },
      { label: copy.goToCourses, suffix: "/courses" },
      { label: copy.goToReviews, suffix: "/reviews" },
      { label: copy.goToOrders, suffix: "/orders" },
      { label: copy.goToSettings, suffix: "/settings" },
    ];
    const goTo = [
      ...baseGoTo,
      ...(canManageWaivers ? [{ label: copy.goToWaivers, suffix: "/waivers" }] : []),
      ...(canManageReports
        ? [
            { label: copy.goToReports, suffix: "/reports" },
            { label: copy.goToPromos, suffix: "/promos" },
          ]
        : []),
    ];
    for (const entry of goTo) {
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
        heading: copy.groupDivers,
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
        heading: copy.groupTrips,
        items: results.trips.map((trip) => ({
          key: `trip:${trip.id}`,
          label: trip.title,
          detail: trip.detail,
          href: `${root}/trips/${trip.id}`,
        })),
      });
    }
    if (results.diveSites.length > 0) {
      out.push({
        heading: copy.groupDiveSites,
        items: results.diveSites.map((site) => ({
          key: `dive-site:${site.id}`,
          label: site.name,
          href: `${root}/dive-sites/${site.id}`,
        })),
      });
    }
    if (results.courses.length > 0) {
      out.push({
        heading: copy.groupCourses,
        items: results.courses.map((course) => ({
          key: `course:${course.id}`,
          label: course.title,
          href: `${root}/courses/${course.slug}/edit`,
        })),
      });
    }
    if (results.orders.length > 0) {
      out.push({
        heading: copy.groupOrders,
        items: results.orders.map((order) => ({
          key: `order:${order.id}`,
          label: order.personName,
          detail: order.detail,
          href: `${root}/orders/${order.id}`,
        })),
      });
    }
    if (goto.length > 0) out.push({ heading: copy.groupGoTo, items: goto });
    return out;
  }, [results, query, boatBoardingHref, root, canManageWaivers, canManageReports, copy]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // "3 divers, 2 trips" — composed from each group's own (already-translated)
  // heading and count rather than a new pluralized template, so this needs no
  // copy beyond what the palette already has.
  const resultsAnnouncement = useMemo(() => {
    if (query.trim().length < 2) return copy.emptyShort;
    if (flat.length === 0) return copy.emptyNoMatches;
    return groups.map((group) => `${group.heading} (${group.items.length})`).join(", ");
  }, [query, flat.length, groups, copy.emptyShort, copy.emptyNoMatches]);

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
        aria-label={copy.search}
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
        <span className="hidden sm:inline">{copy.search}</span>
        <kbd className="hidden rounded border border-border bg-surface-sunken px-1.5 text-xs font-semibold text-muted sm:inline">
          ⌘K
        </kbd>
      </button>

      {open
        ? createPortal(
            // The header this button lives in has `backdrop-blur`, which makes it a
            // containing block for `position: fixed` descendants — a portal escapes
            // that so the backdrop covers the full viewport instead of just the
            // header's own box.
            // Click-away backdrop; Escape and the toggle button also close it.
            // biome-ignore lint/a11y/noStaticElementInteractions: presentational backdrop
            <div
              className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/30 px-4 pt-[12vh] backdrop-blur-sm"
              role="presentation"
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={copy.dialogAriaLabel}
                tabIndex={-1}
                className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl outline-none"
              >
                {/* Counts, not the full result list — a screen reader user
                    typing a query hears how many matches landed in each
                    category without every result being read out loud. */}
                <div aria-live="polite" className="sr-only">
                  {resultsAnnouncement}
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={activeKey ? `${listId}-${activeKey}` : undefined}
                  aria-label={copy.comboboxAriaLabel}
                  autoComplete="off"
                  placeholder={copy.placeholder}
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
                      {query.trim().length < 2 ? copy.emptyShort : copy.emptyNoMatches}
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
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
