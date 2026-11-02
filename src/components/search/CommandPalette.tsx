"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { LanguageChoice } from "@/components/LanguageChoices";
import { StaffDestinationIcon } from "@/components/StaffDestinationIcon";
import { GroupLabel } from "@/components/ui/group-label";
import { useDialogBehaviour } from "@/components/ui/useDialogBehaviour";
import type { SearchResults } from "@/db/search";
import type { GearItemStatus } from "@/lib/gear";
import { motionMs } from "@/lib/motion";
import {
  type StaffDestinationGates,
  type StaffDestinationLabels,
  type StaffDestinationTitles,
  staffDestinationHref,
  staffPaletteDestinations,
} from "@/lib/staff-destinations";
import { forgetThisDevice } from "../forget-device";
import { PaletteGlyph } from "./PaletteGlyph";
import { hintKeyClass, PaletteLegend } from "./PaletteLegend";
import { PaletteSearchField } from "./PaletteSearchField";
import { PaletteSearchStatus, paletteSearchPresentation } from "./PaletteSearchStatus";
import { useCommandKey, usePaletteRecents, useShopSearch } from "./palette-hooks";
import { recentsStorageKey, rememberRecent, type StoredRecent } from "./palette-recents";
import {
  diverItem,
  gearItem,
  NO_RECENTS,
  NO_TODAY_BOATS,
  orderItem,
  type PaletteRecents,
  type PaletteTodayBoat,
  startGroups,
  tripItem,
} from "./palette-start-rows";

/**
 * A row in the palette. Most are destinations (`href`); a few *do* something
 * instead (`run`) — switching language is the first, because a language is not
 * a page to visit and pushing a URL to change one would mean inventing a route
 * whose only job is to set a cookie and bounce.
 */
export type PaletteItem = {
  key: string;
  label: string;
  detail?: string;
  /**
   * The row's accessible name when `label` alone would name two rows. A
   * Settings row called "Crew schedule" sits in the same list as the staffing
   * destination of the same name; its name carries the group so a reader (and
   * a locator) can tell the two apart.
   */
  ariaLabel?: string;
  href?: string;
  run?: () => void;
  /**
   * The answer card's body (ADR 20260906-before-you-ask, decision 3): the
   * fact lines under the row's label, and the act Enter takes. Only the first
   * row of a query that names one thing carries it.
   */
  card?: { lines: string[]; act: string };
  /** A record this row opens, kept as one of this staffer's recents once chosen. */
  recent?: StoredRecent;
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
export type PaletteGroup = { id: string; heading?: string; items: PaletteItem[] };

/**
 * One row of the Settings rail, offered under "Go to" (the rail's own label,
 * its group's name as the row's detail, and where it leads). Built where the
 * rail is (`settings-groups.ts`) and already filtered for this reader, so the
 * palette never decides who may see a setting.
 */
export type SettingsShortcut = { id: string; label: string; group: string; href: string };

/**
 * How many settings rows one query may add. "e" matches most of the rail, and
 * forty rows of settings under every keystroke would bury the diver a desk
 * was looking for.
 */
const MAX_SETTINGS_SHORTCUTS = 6;
const NO_SETTINGS_SHORTCUTS: readonly SettingsShortcut[] = [];

export type CommandPaletteCopy = {
  search: string;
  dialogAriaLabel: string;
  comboboxAriaLabel: string;
  placeholder: string;
  emptyShort: string;
  emptyNoMatches: string;
  searching: string;
  searchFailed: string;
  searchUnauthorized: string;
  retry: string;
  signInAgain: string;
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
  /** What this staffer opened from here on this device, before anything is typed. */
  groupRecent: string;
  /** Today's departures, before anything is typed. */
  groupToday: string;
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
  close: string;
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
  /** The per-device offline snapshot, which is not shop-scoped. */
  goToOfflineRollCall: string;
};

/**
 * **What the palette offers for this query**, group by group: the places to
 * go, the shop's own records the search answered, the settings rows, the
 * languages, the account's own doors, and "Add a diver called …" last. Pure
 * over its inputs; `CommandPalette` memoises it per query and result set.
 */
function paletteGroups({
  results,
  searchSucceeded,
  recents = NO_RECENTS,
  todayBoats = NO_TODAY_BOATS,
  query,
  boatBoardingHref,
  root,
  gates,
  switches,
  copy,
  languages,
  locale,
  setLocaleAction,
  signOutAction,
  createDiverAction,
  settingsShortcuts,
  startTransition,
}: {
  results: SearchResults;
  searchSucceeded: boolean;
  /** This staffer's recents on this device, as read back on opening (`palette-hooks.ts`). */
  recents?: PaletteRecents;
  todayBoats?: readonly PaletteTodayBoat[];
  query: string;
  boatBoardingHref: string | undefined;
  root: string;
  gates: StaffDestinationGates;
  switches: Parameters<typeof staffPaletteDestinations>[1];
  copy: CommandPaletteCopy;
  languages: readonly LanguageChoice[];
  locale: string;
  setLocaleAction: (locale: string) => Promise<void>;
  signOutAction: () => Promise<void>;
  createDiverAction: (formData: FormData) => Promise<void>;
  settingsShortcuts: readonly SettingsShortcut[];
  startTransition: (action: () => void | Promise<void>) => void;
}): PaletteGroup[] {
  const rawQuery = query.trim();
  const q = rawQuery.toLowerCase();
  const goto = gotoItems({
    q,
    root,
    boatBoardingHref,
    gates,
    switches,
    settingsShortcuts,
    copy,
  });
  const out: PaletteGroup[] = [];
  // Before anything is typed, what you were just doing (`palette-start-rows.tsx`).
  if (rawQuery === "") out.push(...startGroups({ recents, todayBoats, root, copy }));
  // **Ask it, and it answers.** The first row when the query names one
  // thing: the fact, and the primary act the home's ledger rows would
  // offer. The doors that ship today render beneath; a query that names
  // nothing never has this row.
  if (results.answer) {
    const { answer } = results;
    const glyph = answer.kind === "diver" ? "diver" : answer.kind === "day" ? "boarding" : "trip";
    const items: PaletteItem[] = [
      {
        key: "answer",
        label: answer.title,
        href: answer.act.href,
        card: { lines: answer.lines, act: answer.act.label },
        icon: <PaletteGlyph name={glyph} />,
      },
    ];
    if (answer.more) {
      items.push({
        key: "answer:more",
        label: answer.more.label,
        href: answer.more.href,
        icon: <PaletteGlyph name={glyph} />,
      });
    }
    out.push({ id: "answer", items });
  }
  const diverItems: PaletteItem[] = results.divers.map((diver) => diverItem(diver, root));
  // "Add a diver called <whatever you typed>" matches *every* query by
  // construction, so it is the one row that can never lose a ranking contest
  // — which is how typing "sign out" used to offer to create a diver named
  // "sign out" above the actual Sign out command. It is appended after every
  // real match instead of sitting inside Divers, so it is always the last
  // thing an arrow key reaches and never what Enter takes on a query that
  // matched something real.
  const addDiver: PaletteItem | null =
    q.length >= 2 && searchSucceeded
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
      items: results.trips.map((trip) => tripItem(trip, root)),
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
      items: results.gear.map((unit) => gearItem(unit, root, copy.gearStatuses)),
    });
  }
  if (results.orders.length > 0) {
    out.push({
      id: "orders",
      heading: copy.groupOrders,
      items: results.orders.map((order) => orderItem(order, root)),
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
}

/**
 * The "Go to" rows for one query: the boarding and offline doors, every
 * destination the nav offers this reader, and the Settings rail's rows by
 * name. Pure, so the palette's memo only re-runs it when its inputs move.
 */
function gotoItems({
  q,
  root,
  boatBoardingHref,
  gates,
  switches,
  settingsShortcuts,
  copy,
}: {
  /** The trimmed, lower-cased query; "" lists every door. */
  q: string;
  root: string;
  boatBoardingHref: string | undefined;
  gates: StaffDestinationGates;
  switches: Parameters<typeof staffPaletteDestinations>[1];
  settingsShortcuts: readonly SettingsShortcut[];
  copy: CommandPaletteCopy;
}): PaletteItem[] {
  const goto: PaletteItem[] = [];
  if (boatBoardingHref && ("boarding".includes(q) || "boat".includes(q) || q === "")) {
    goto.push({
      key: "goto:boarding",
      label: copy.goToBoarding,
      href: boatBoardingHref,
      icon: <PaletteGlyph name="boarding" />,
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
  for (const destination of staffPaletteDestinations(gates, switches)) {
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
  // "Tips", "desk hours", "counter card": the rail is where an owner hunts,
  // so its rows answer by name too. A row whose page is already a
  // destination above (Team, Activity, Email) is that row, not a second one.
  if (q !== "") {
    const offered = new Set(goto.map((item) => item.href));
    let added = 0;
    for (const shortcut of settingsShortcuts) {
      if (added >= MAX_SETTINGS_SHORTCUTS) break;
      if (offered.has(shortcut.href)) continue;
      const label = shortcut.label.toLowerCase();
      const group = shortcut.group.toLowerCase();
      if (!label.includes(q) && !group.includes(q)) continue;
      offered.add(shortcut.href);
      added += 1;
      goto.push({
        key: `goto:settings:${shortcut.id}`,
        label: shortcut.label,
        detail: shortcut.group,
        ariaLabel: `${shortcut.label} · ${shortcut.group}`,
        href: shortcut.href,
        icon: <StaffDestinationIcon id="settings" className="size-5" />,
      });
    }
  }
  return goto;
}

/**
 * Global search for the front desk: "pull up Priya" without navigating to a
 * list first. Opened by ⌘K / Ctrl-K or the nav button. A hand-rolled combobox
 * (no new dependency) with correct ARIA and full keyboard control; results are
 * shop-scoped server-side and debounced. Selecting a trip opens its staff page
 * and a shortcut its surface; a diver opens as a sheet over the day, because a
 * person is the one answer here that has no hour of its own (slice 23e).
 */
export function CommandPalette({
  shopSlug,
  boatBoardingHref,
  gates,
  switches,
  locale,
  languages,
  setLocaleAction,
  signOutAction,
  createDiverAction,
  settingsShortcuts = NO_SETTINGS_SHORTCUTS,
  todayBoats = NO_TODAY_BOATS,
  readerId,
  copy,
  variant = "bar",
}: {
  /**
   * `bar` is the shell's own control, a field from `sm` and an icon below it.
   * `field` is the same palette as a full-width field at every width, for a
   * page with no shell to hold the bar (the staff 404).
   */
  variant?: "bar" | "field";
  shopSlug: string;
  boatBoardingHref?: string;
  /**
   * Owner/manager gates (H-20260724-staff-role-reach), the same object the nav gets — a gated
   * destination is absent from both, never present here and missing there.
   */
  gates: StaffDestinationGates;
  /** Which Features-page switches are on; a switched-off feature's doors are not offered. */
  switches?: Parameters<typeof staffPaletteDestinations>[1];
  /** The language this render was written in; it is not offered as a choice. */
  locale: string;
  /** Every language DiveDay carries, each named in itself. */
  languages: readonly LanguageChoice[];
  setLocaleAction: (locale: string) => Promise<void>;
  /** The same Server Action the shop-name menu's Sign out submits to. */
  signOutAction: () => Promise<void>;
  /** Creates a typed search identity and lands on its Diver record. */
  createDiverAction: (formData: FormData) => Promise<void>;
  /**
   * The Settings rail's rows this reader may open (none for anyone outside
   * the settings gate). Offered only once something is typed, matched on the
   * row's label or its group's name.
   */
  settingsShortcuts?: readonly SettingsShortcut[];
  /** Today's departures, offered before anything is typed (fifth loop, item 13). */
  todayBoats?: readonly PaletteTodayBoat[];
  /** The signed-in staffer: "Recent" is kept per shop and per staffer on this device. */
  readerId?: string;
  copy: CommandPaletteCopy;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const recentsKey = recentsStorageKey(shopSlug, readerId);
  // A shared desk's next staffer inherits none of these; the wipe is awaited.
  const signOutForgetting = useCallback(async () => {
    await forgetThisDevice();
    return signOutAction();
  }, [signOutAction]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const root = `/shop/${shopSlug}`;

  // 180ms matches .animate-scale-out in globals.css — the two must move
  // together. Restrained on purpose (docs/design/principles.md §5): a short
  // scale-and-fade, the same pair every other menu on the page uses, so the
  // palette reads as a layer arriving rather than a dialog performing.
  const { mounted, closing, dialogProps } = useDialogBehaviour({
    open,
    onClose: () => setOpen(false),
    containerRef: dialogRef,
    exitMs: motionMs("base"),
  });

  const listening = useCommandKey(setOpen);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const { results, status, authorizationLost, retry, onUnauthorized } = useShopSearch(query, open);
  const recents = usePaletteRecents(open && !authorizationLost, recentsKey, onUnauthorized);
  const visibleBoats = authorizationLost ? NO_TODAY_BOATS : todayBoats;

  const groups = useMemo(
    () =>
      paletteGroups({
        results,
        searchSucceeded: status === "success",
        recents,
        todayBoats: visibleBoats,
        query,
        boatBoardingHref,
        root,
        gates,
        switches,
        copy,
        languages,
        locale,
        setLocaleAction,
        signOutAction: signOutForgetting,
        createDiverAction,
        settingsShortcuts,
        startTransition,
      }),
    [
      results,
      status,
      recents,
      visibleBoats,
      query,
      boatBoardingHref,
      root,
      gates,
      switches,
      copy,
      languages,
      locale,
      setLocaleAction,
      signOutForgetting,
      createDiverAction,
      settingsShortcuts,
    ],
  );

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  const { searchMessage, resultsAnnouncement } = paletteSearchPresentation({
    status,
    query,
    groups,
    copy,
  });

  // Keep the active row in range as results change.
  useEffect(() => {
    setActive((current) => (flat.length === 0 ? 0 : Math.min(current, flat.length - 1)));
  }, [flat.length]);

  const go = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      setOpen(false);
      if (item.recent) rememberRecent(recentsKey, item.recent);
      if (item.run) {
        item.run();
        return;
      }
      if (item.href) router.push(item.href);
    },
    [router, recentsKey],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.max(0, Math.min(current + 1, flat.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(flat[active]);
    }
  }

  const activeKey = flat[active]?.key;

  return (
    <>
      <PaletteTrigger
        variant={variant}
        onOpen={() => setOpen(true)}
        hydrated={listening}
        search={copy.search}
        placeholder={copy.placeholder}
      />

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
                {...dialogProps}
                aria-label={copy.dialogAriaLabel}
                className={`w-full max-w-xl overflow-hidden rounded-panel border border-border bg-surface shadow-2xl outline-none ${closing ? "animate-scale-out" : "animate-scale-in"}`}
              >
                {/* Counts, not the full result list — a screen reader user
                    typing a query hears how many matches landed in each
                    category without every result being read out loud. */}
                <div aria-live="polite" className="sr-only">
                  {resultsAnnouncement}
                </div>
                <PaletteSearchField
                  inputRef={inputRef}
                  pending={status === "pending"}
                  listId={listId}
                  activeId={activeKey ? `${listId}-${activeKey}` : undefined}
                  copy={copy}
                  query={query}
                  onQueryChange={(next) => {
                    setQuery(next);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  onClose={() => setOpen(false)}
                />
                <PaletteSearchStatus
                  message={searchMessage}
                  status={status}
                  retry={retry}
                  copy={copy}
                />
                {/* `pb-2` inside the scroll box, not on the panel: the last
                    row now ends on its own padding rather than being sliced
                    through its text by the scroll edge (issue #773). */}
                <div
                  id={listId}
                  role="listbox"
                  className="max-h-[58vh] overflow-y-auto py-2 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]"
                >
                  {flat.length === 0 && !searchMessage ? (
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
                              aria-label={item.ariaLabel ?? item.label}
                              aria-selected={isActive}
                              tabIndex={-1}
                              onMouseMove={() =>
                                setActive(flat.findIndex((entry) => entry.key === item.key))
                              }
                              onClick={() => go(item)}
                              className={`flex w-full items-center gap-3 px-5 py-2.5 text-left focus-visible:focus-ring-inset ${
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
                              {item.card ? (
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-semibold">{item.label}</span>
                                  {item.card.lines.map((line) => (
                                    <span key={line} className="block truncate text-sm text-muted">
                                      {line}
                                    </span>
                                  ))}
                                  <span className="mt-1 block text-sm font-medium text-primary">
                                    <kbd className={hintKeyClass}>↵</kbd> {item.card.act}
                                  </span>
                                </span>
                              ) : (
                                /* **The label and its detail share one column.**
                                   Side by side on a phone the detail never
                                   shrank, so a departure's name took all the
                                   loss — cut to 81px while its date kept 172
                                   (the pixel audit, command-palette-results).
                                   Below `sm` the detail is the label's second
                                   line; from `sm` up the column lays them out
                                   in a row, the date at its full width as
                                   before. A card carries its facts in `lines`
                                   and has no detail. */
                                <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                                  <span className="block min-w-0 truncate font-medium sm:flex-1">
                                    {item.label}
                                  </span>
                                  {item.detail ? (
                                    <span className="block truncate text-sm text-muted sm:shrink-0">
                                      {item.detail}
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
                <PaletteLegend copy={copy} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The control that opens the palette. `bar` is the shell's own, a field from
 * `sm` and an icon below it; `field` is the same palette as a full-width field
 * at every width, for a page with no shell to hold the bar (the staff 404).
 */
function PaletteTrigger({
  variant,
  onOpen,
  hydrated,
  search,
  placeholder,
}: {
  variant: "bar" | "field";
  onOpen: () => void;
  search: string;
  placeholder: string;
  /** True once the ⌘K listener is attached; drawn as `data-hydrated`. */
  hydrated: boolean;
}) {
  return variant === "field" ? (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts="Meta+K Control+K"
      aria-label={search}
      data-hydrated={hydrated ? "true" : undefined}
      className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 text-start text-sm text-muted transition-[color,background-color] hover:bg-surface-sunken hover:text-foreground"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4 shrink-0"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span className="min-w-0 flex-1 truncate">{placeholder}</span>
      <kbd className="hidden rounded border border-border bg-surface-sunken px-1.5 text-xs font-semibold text-muted sm:inline">
        ⌘K
      </kbd>
    </button>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts="Meta+K Control+K"
      aria-label={search}
      data-hydrated={hydrated ? "true" : undefined}
      // **The transition names its two properties rather than saying
      // `transition-colors`.** That shorthand covers `border-color`, and the
      // border below arrives at `sm` — so crossing that breakpoint started
      // four longhand transitions (one per side) on the very resize
      // `capture()` performs, and a screenshot taken during the fade catches
      // a half-drawn border. `e2e/visual-capture-harness.spec.ts`'s canary is
      // what found it. Hover changes the text and the background and nothing
      // else, so those are what may move.
      //
      // **A field's box only where it is a field.** From `sm` up this reads
      // as one — a magnifier, the word, the shortcut, bordered like an
      // input. Below it the word and the ⌘K hide and the border stayed, a
      // box drawn around a bare icon and the one control in the bar that did
      // not match the date beside it (`Tide.dc.html` draws both as plain
      // strokes). So the border, the padding and the auto width all arrive
      // at `sm` together with the text that earns them.
      className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium text-muted transition-[color,background-color] hover:bg-surface-sunken hover:text-foreground sm:size-auto sm:min-h-11 sm:justify-start sm:rounded-lg sm:border sm:border-border sm:px-3"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // 20px beside the date, 16px beside its own word. `Tide.dc.html`
        // sizes the two the same way — the pocket's marks at 22px, the desk
        // bar's magnifier at 18px next to "Search anyone, any day" — because
        // an icon standing alone is the control and an icon labelling a
        // field is punctuation.
        className="size-5 sm:size-4"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span className="hidden sm:inline">{search}</span>
      <kbd className="hidden rounded border border-border bg-surface-sunken px-1.5 text-xs font-semibold text-muted sm:inline">
        ⌘K
      </kbd>
    </button>
  );
}
