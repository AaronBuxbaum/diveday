"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { LanguageChoice } from "@/components/LanguageChoices";
import { DiveDayIcon, StaffDestinationIcon } from "@/components/StaffDestinationIcon";
import { GroupLabel } from "@/components/ui/ledger";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useFocusTrap } from "@/components/useFocusTrap";
import type { SearchResults } from "@/db/search";
import type { GearItemStatus } from "@/lib/gear";
import {
  type StaffDestinationGates,
  type StaffDestinationLabels,
  type StaffDestinationTitles,
  staffDestinationHref,
  staffPaletteDestinations,
} from "@/lib/staff-destinations";
import { PaletteGlyph } from "./PaletteGlyph";

/**
 * A row in the palette. Most are destinations (`href`); a few *do* something
 * instead (`run`) — switching language is the first, because a language is not
 * a page to visit and pushing a URL to change one would mean inventing a route
 * whose only job is to set a cookie and bounce.
 */
type PaletteItem = {
  key: string;
  label: string;
  detail?: string;
  href?: string;
  run?: () => void;
  /**
   * The row's left rail. Always decorative — every row's accessible name is
   * its `aria-label` — and always present, because a rail that appears on some
   * rows and not others is worse than no rail (issue #773).
   */
  icon?: React.ReactNode;
};
/**
 * `heading` is optional: the trailing "Add diver" row is a group of one whose
 * label already says what it is, and a heading over it would be the heading
 * repeating the only row under it.
 */
type PaletteGroup = { id: string; heading?: string; items: PaletteItem[] };

/** The palette's own key cap — smaller than the header button's ⌘K badge. */
const hintKeyClass =
  "rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-sans text-[0.65rem] leading-none font-semibold";

const EMPTY: SearchResults = {
  divers: [],
  trips: [],
  diveSites: [],
  courses: [],
  orders: [],
  gear: [],
};

export type CommandPaletteCopy = {
  search: string;
  dialogAriaLabel: string;
  comboboxAriaLabel: string;
  placeholder: string;
  emptyShort: string;
  emptyNoMatches: string;
  groupDivers: string;
  addDiver: string;
  groupTrips: string;
  groupDiveSites: string;
  groupCourses: string;
  groupOrders: string;
  groupGear: string;
  /** Every gear status, worded — the palette has the translator, `src/db` does not. */
  gearStatuses: Record<GearItemStatus, string>;
  groupGoTo: string;
  /** Heading over the language rows — also what a staffer types to find them. */
  language: string;
  /** Heading over the rows about this session rather than this shop's work. */
  groupSession: string;
  /** The same word the shop-name menu signs out under — one act, one label. */
  signOut: string;
  /** The legend along the panel's bottom edge: which keys actually work. */
  hintMove: string;
  hintOpen: string;
  hintClose: string;
  /**
   * The same destination labels the nav renders (src/lib/staff-destinations.ts).
   * One record, so "Go to Board" here and "Board" in the header can never
   * become two different words for the same page.
   */
  destinationLabels: StaffDestinationLabels;
  /**
   * What a destination calls *itself* once you are on it, where that differs
   * from its label. Searched but never shown: a staffer who thinks of Reports
   * as "How's your month" and types that got nothing back, because the rows
   * are built from the nav's vocabulary and the page is written in the
   * product's (issue #824). The label stays the row's word — two names on one
   * row is a list you have to read twice.
   */
  destinationTitles: StaffDestinationTitles;
  /** Today's departure — a live href, not a fixed destination. */
  goToBoarding: string;
  /**
   * "Close the day" — a **command**, not a destination.
   *
   * The evening is a state the shop home settles into, so there is no page to
   * go to any more (H-62; ADR 20260827-clearwater-surface-language, decision
   * 4). But a phrase a shop has typed for a year must keep answering, so the
   * palette carries the words and lands them on the home's closing block.
   */
  goToCloseDay: string;
  /** The per-device offline snapshot, which is not shop-scoped. */
  goToOfflineRollCall: string;
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
  gates,
  locale,
  languages,
  setLocaleAction,
  signOutAction,
  createDiverAction,
  copy,
}: {
  shopSlug: string;
  boatBoardingHref?: string;
  /**
   * Owner/manager gates (H-14), the same object the nav gets — a gated
   * destination is absent from both, never present here and missing there.
   */
  gates: StaffDestinationGates;
  /** The language this render was written in; it is not offered as a choice. */
  locale: string;
  /** Every language DiveDay carries, each named in itself. */
  languages: readonly LanguageChoice[];
  setLocaleAction: (locale: string) => Promise<void>;
  /** The same Server Action the shop-name menu's Sign out submits to. */
  signOutAction: () => Promise<void>;
  /** Creates a typed search identity and lands on its Diver record. */
  createDiverAction: (formData: FormData) => Promise<void>;
  copy: CommandPaletteCopy;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const root = `/shop/${shopSlug}`;

  useFocusTrap(open, dialogRef);
  // 180ms matches .animate-scale-out in globals.css — the two must move
  // together. Restrained on purpose (docs/design/principles.md §5): a short
  // scale-and-fade, the same pair every other menu on the page uses, so the
  // palette reads as a layer arriving rather than a dialog performing.
  const { mounted, closing } = useExitAnimation(open, 180);

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
  // A GET (rather than the old `searchShopAction` Server Action) so keystrokes
  // don't queue behind Next's per-client Server Action serialization or any
  // in-flight mutation action, and so a stale request can be `AbortController`
  // cancelled instead of merely ignored.
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
  }, [query]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const rawQuery = query.trim();
    const q = rawQuery.toLowerCase();
    const goto: PaletteItem[] = [];
    if (boatBoardingHref && ("boarding".includes(q) || "boat".includes(q) || q === "")) {
      goto.push({
        key: "goto:boarding",
        label: copy.goToBoarding,
        href: boatBoardingHref,
        icon: <PaletteGlyph name="boarding" />,
      });
    }
    // The one row here that is an *act* rather than a place. It lands on the
    // home's `#close-day` anchor, which is where the closing block renders
    // once every departure of the shop day has settled — and on a day still
    // being dived it lands on the spine that will hold it, which is the
    // honest answer to "close the day" at 11 a.m.
    if (q === "" || "close the day".includes(q) || "closeout".includes(q)) {
      goto.push({
        key: "goto:close-day",
        label: copy.goToCloseDay,
        href: `${root}#close-day`,
        icon: <PaletteGlyph name="closeDay" />,
      });
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
        icon: <PaletteGlyph name="offline" />,
      });
    }
    // One list with the nav and the keyboard shortcuts, already filtered for
    // this viewer's permissions.
    for (const destination of staffPaletteDestinations(gates)) {
      const label = copy.destinationLabels[destination.id];
      const title = copy.destinationTitles[destination.id];
      if (q === "" || label.toLowerCase().includes(q) || title?.toLowerCase().includes(q)) {
        goto.push({
          key: `goto:${destination.id}`,
          label,
          href: staffDestinationHref(root, destination),
          // The registry's own artwork, so the palette and the phone dock can
          // never draw one destination two ways.
          icon: <StaffDestinationIcon id={destination.id} className="size-5" />,
        });
      }
    }
    const out: PaletteGroup[] = [];
    const diverItems: PaletteItem[] = results.divers.map((diver) => ({
      key: `diver:${diver.id}`,
      label: diver.fullName,
      detail: diver.detail ?? undefined,
      href: `${root}/divers/${diver.id}`,
      icon: <PaletteGlyph name="diver" />,
    }));
    // "Add a diver called <whatever you typed>" matches *every* query by
    // construction, so it is the one row that can never lose a ranking contest
    // — which is how typing "sign out" used to offer to create a diver named
    // "sign out" above the actual Sign out command. It is appended after every
    // real match instead of sitting inside Divers, so it is always the last
    // thing an arrow key reaches and never what Enter takes on a query that
    // matched something real.
    const addDiver: PaletteItem | null =
      q.length >= 2
        ? (() => {
            const formData = new FormData();
            formData.set("query", rawQuery);
            return {
              key: "diver:add",
              label: copy.addDiver,
              detail: rawQuery,
              icon: <PaletteGlyph name="diver" />,
              run: () => startTransition(() => createDiverAction(formData)),
            };
          })()
        : null;
    if (goto.length > 0) out.push({ id: "go-to", heading: copy.groupGoTo, items: goto });
    if (diverItems.length > 0) {
      out.push({
        id: "divers",
        heading: copy.groupDivers,
        items: diverItems,
      });
    }
    if (results.trips.length > 0) {
      out.push({
        id: "trips",
        heading: copy.groupTrips,
        items: results.trips.map((trip) => ({
          key: `trip:${trip.id}`,
          label: trip.title,
          detail: trip.detail,
          href: `${root}/trips/${trip.id}`,
          icon: <PaletteGlyph name="trip" />,
        })),
      });
    }
    if (results.diveSites.length > 0) {
      out.push({
        id: "dive-sites",
        heading: copy.groupDiveSites,
        items: results.diveSites.map((site) => ({
          key: `dive-site:${site.id}`,
          label: site.name,
          href: `${root}/dive-sites/${site.id}`,
          icon: <PaletteGlyph name="diveSite" />,
        })),
      });
    }
    if (results.courses.length > 0) {
      out.push({
        id: "courses",
        heading: copy.groupCourses,
        items: results.courses.map((course) => ({
          key: `course:${course.id}`,
          label: course.title,
          href: `${root}/courses/${course.slug}/edit`,
          icon: <PaletteGlyph name="course" />,
        })),
      });
    }
    // **The tag is the point.** `gear_items.label` carries a schema comment
    // saying it is "how a wet hand finds the row", and it was the one
    // identifier the palette could not find (issue #719). The status rides
    // along because finding "BCD #14" and learning it is out for service in the
    // same glance is the whole value.
    if (results.gear.length > 0) {
      out.push({
        id: "gear",
        heading: copy.groupGear,
        items: results.gear.map((unit) => ({
          key: `gear:${unit.id}`,
          label: unit.label,
          detail: unit.detail
            ? `${copy.gearStatuses[unit.status]} · ${unit.detail}`
            : copy.gearStatuses[unit.status],
          href: `${root}/gear/${unit.id}`,
          icon: <PaletteGlyph name="gear" />,
        })),
      });
    }
    if (results.orders.length > 0) {
      out.push({
        id: "orders",
        heading: copy.groupOrders,
        items: results.orders.map((order) => ({
          key: `order:${order.id}`,
          label: order.personName,
          detail: order.detail,
          href: `${root}/orders/${order.id}`,
          icon: <PaletteGlyph name="order" />,
        })),
      });
    }
    // The second door to the language switcher, beside the one behind the
    // shop's name. Only the languages *not* in force: a row that changes
    // nothing is not a command. Matched on the group heading and on each
    // language's own name, so both "language" and "español" find it.
    const headingMatch = copy.language.toLowerCase().includes(q);
    const otherLanguages = languages
      .filter((choice) => choice.locale !== locale)
      .filter(
        (choice) =>
          q === "" ||
          headingMatch ||
          choice.label.toLowerCase().includes(q) ||
          choice.locale.toLowerCase().includes(q),
      );
    if (otherLanguages.length > 0) {
      out.push({
        id: "language",
        heading: copy.language,
        items: otherLanguages.map((choice) => ({
          key: `language:${choice.locale}`,
          label: choice.label,
          run: () => startTransition(() => setLocaleAction(choice.locale)),
          icon: <PaletteGlyph name="language" />,
        })),
      });
    }
    // Sign out, last. The palette is where a staffer who is already typing
    // looks for anything at all, and until now the one control that is about
    // *ending this session* could only be reached by finding the shop's name
    // and opening the menu behind it — which is exactly the disclosure a
    // person handing the tablet on is least likely to go hunting through.
    //
    // Filed with Language rather than under "Go to": neither is a page, both
    // are about this reader on this device, and the sign-out act is the same
    // one the shop-name menu performs — the same Server Action under the same
    // word, never a second way to end a session. Matched on the heading too,
    // so "session" finds it as readily as "sign out".
    //
    // Bottom of the list on purpose. The menu's Sign out is two taps
    // (`InlineConfirm`) because it must be deliberate on a shared device; a
    // palette row cannot borrow that shape without inventing a confirm step
    // inside a combobox, so deliberateness comes from position instead — it is
    // never the row an arrow key lands on first.
    if (
      q === "" ||
      copy.groupSession.toLowerCase().includes(q) ||
      copy.signOut.toLowerCase().includes(q)
    ) {
      out.push({
        id: "session",
        heading: copy.groupSession,
        items: [
          {
            key: "session:sign-out",
            label: copy.signOut,
            run: () => startTransition(() => signOutAction()),
            icon: <PaletteGlyph name="signOut" />,
          },
        ],
      });
    }
    // Last, under everything, with no heading of its own: the row states the
    // act and carries the typed name as its detail, so a heading over a group
    // of one would only repeat it.
    if (addDiver) out.push({ id: "add-diver", items: [addDiver] });
    return out;
  }, [
    results,
    query,
    boatBoardingHref,
    root,
    gates,
    copy,
    languages,
    locale,
    setLocaleAction,
    signOutAction,
    createDiverAction,
  ]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // "3 divers, 2 trips" — composed from each group's own (already-translated)
  // heading and count rather than a new pluralized template, so this needs no
  // copy beyond what the palette already has.
  const resultsAnnouncement = useMemo(() => {
    if (query.trim().length < 2) return copy.emptyShort;
    if (flat.length === 0) return copy.emptyNoMatches;
    return groups
      .map((group) =>
        group.heading ? `${group.heading} (${group.items.length})` : group.items[0]?.label,
      )
      .filter(Boolean)
      .join(", ");
  }, [query, flat.length, groups, copy.emptyShort, copy.emptyNoMatches]);

  // Keep the active row in range as results change.
  useEffect(() => {
    setActive((current) => (flat.length === 0 ? 0 : Math.min(current, flat.length - 1)));
  }, [flat.length]);

  const go = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      setOpen(false);
      if (item.run) {
        item.run();
        return;
      }
      if (item.href) router.push(item.href);
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
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
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

      {mounted
        ? createPortal(
            // The header this button lives in has `backdrop-blur`, which makes it a
            // containing block for `position: fixed` descendants — a portal escapes
            // that so the backdrop covers the full viewport instead of just the
            // header's own box.
            // Click-away backdrop; Escape and the toggle button also close it.
            // biome-ignore lint/a11y/noStaticElementInteractions: presentational backdrop
            <div
              // A wash, not a curtain: `backdrop-blur-sm` over a 30% scrim
              // left the page behind unreadable, which takes away the sense of
              // the palette floating over your own work (issue #773).
              className={`fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 px-4 pt-[12vh] backdrop-blur-[2px] ${closing ? "animate-fade-out" : "animate-fade-in"}`}
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
                className={`w-full max-w-xl overflow-hidden rounded-panel border border-border bg-surface shadow-2xl outline-none ${closing ? "animate-scale-out" : "animate-scale-in"}`}
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
                {/* `pb-2` inside the scroll box, not on the panel: the last
                    row now ends on its own padding rather than being sliced
                    through its text by the scroll edge (issue #773). */}
                <div
                  id={listId}
                  role="listbox"
                  className="max-h-[58vh] overflow-y-auto py-2 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]"
                >
                  {flat.length === 0 ? (
                    <p className="px-5 py-6 text-center text-sm text-muted">
                      {query.trim().length < 2 ? copy.emptyShort : copy.emptyNoMatches}
                    </p>
                  ) : (
                    groups.map((group, groupIndex) => (
                      <div
                        key={group.id}
                        className={
                          !group.heading && groupIndex > 0
                            ? "mt-2 border-t border-border pt-2"
                            : undefined
                        }
                      >
                        {group.heading ? (
                          <GroupLabel className="px-5 pt-2 pb-1">{group.heading}</GroupLabel>
                        ) : null}
                        {group.items.map((item) => {
                          const isActive = item.key === activeKey;
                          return (
                            <button
                              key={item.key}
                              id={`${listId}-${item.key}`}
                              type="button"
                              role="option"
                              aria-label={item.label}
                              aria-selected={isActive}
                              tabIndex={-1}
                              onMouseMove={() =>
                                setActive(flat.findIndex((entry) => entry.key === item.key))
                              }
                              onClick={() => go(item)}
                              className={`flex w-full items-center gap-3 px-5 py-2.5 text-left ${
                                isActive ? "bg-primary/10" : ""
                              }`}
                            >
                              {/* Decorative and fixed-width: the rail only
                                  works as a rail if every label starts at the
                                  same x, so the slot holds its space even for
                                  a row whose glyph is missing. */}
                              <span
                                aria-hidden="true"
                                className={`flex size-5 shrink-0 items-center justify-center ${
                                  isActive ? "text-primary" : "text-muted"
                                }`}
                              >
                                {item.icon}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {item.label}
                              </span>
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
                {/* **What the palette has always done, said out loud.** It
                    opens on ⌘K, moves on arrows, commits on Enter and closes
                    on Escape, and said none of it — so a staffer who reached
                    it by clicking "Search ⌘K" in the header reached back for
                    the mouse, which is the whole advantage gone. Muted and
                    small: a legend, never a row you could mistake for a
                    result. `aria-hidden` because every key it names is already
                    announced by the combobox pattern, and a screen-reader
                    user hearing "arrow keys to move" inside a listbox is
                    being told what they are already doing. */}
                <p
                  aria-hidden="true"
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-2.5 text-xs text-muted"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <kbd className={hintKeyClass}>
                      <DiveDayIcon name="arrow-up" className="size-3" />
                    </kbd>
                    <kbd className={hintKeyClass}>
                      <DiveDayIcon name="arrow-down" className="size-3" />
                    </kbd>
                    {copy.hintMove}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <kbd className={hintKeyClass}>↵</kbd>
                    {copy.hintOpen}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <kbd className={hintKeyClass}>esc</kbd>
                    {copy.hintClose}
                  </span>
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
