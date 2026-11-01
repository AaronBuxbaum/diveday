"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { GroupLabel } from "@/components/ui/group-label";
import { DoorChevron } from "@/components/ui/ledger";
import { RAIL_ROW_CLASS, RAIL_ROW_CURRENT, RAIL_ROW_IDLE } from "@/components/ui/rail";
import {
  currentSettingsRailRowId,
  type SettingsRailRow,
  settingsSectionFragment,
} from "../settings-groups";
import { SETTINGS_SELECTION_EVENT } from "./SettingsSelection";
import {
  SETTINGS_RAIL_COLUMN_CLASS,
  SETTINGS_RAIL_CONTENT_CLASS,
  SETTINGS_RAIL_FRAME_CLASS,
  SETTINGS_RAIL_LABEL_CLASS,
  SETTINGS_RAIL_LABEL_WORDS_CLASS,
} from "./settings-rail-geometry";

/**
 * **The settings rail** — the left column of ADR
 * 20260827-clearwater-surface-language's decision 6, "Settings is a rail and a
 * pane". The whole map of the shop's switches at desktop; phones carry the
 * same destinations in a horizontal section bar.
 *
 * On narrow screens the same destinations sit in a horizontal section bar.
 *
 * **The selection model is one thing, decided in `settings-groups.ts`.** A row
 * pointing at a sub-route selects by pathname; a row pointing at a hub section
 * is a `#fragment` link and selects by the scroll-spy below. The two never
 * blur, and neither ever turns a hub section into a route.
 *
 * **Three groups, and the reader can always tell which one they are in.** The
 * map is 42 rows — about 2,000px at the rail's 44px row — against roughly
 * 740px of viewport beside the bar, so it has always been a *scrolling* map
 * and no legible row height changes that. What it was missing is the part
 * that makes a long map usable: a reader landed on "Your shop" and had no
 * signal that the groups below the first existed at all below the fold.
 * Each group label is sticky inside the rail's own scroll area now, so the
 * group you are reading is named at the top of the column and the next one
 * announces itself as it arrives, and the group holding the current row wears
 * the `primary` tone `GroupLabel` keeps for exactly that. The frame is tighter
 * too (`py-6`, `space-y-5`) — four more rows before the fold, at no cost to
 * the ramp.
 */

export type SettingsRailGroupView = {
  id: string;
  label: string;
  rows: readonly SettingsRailRow[];
};

export function SettingsRail({
  groups,
  labels,
  badges,
  shopBasePath,
  ariaLabel,
}: {
  groups: readonly SettingsRailGroupView[];
  /** Row id → the word on the row. Resolved on the server; this is chrome. */
  labels: Readonly<Record<string, string>>;
  /** Row id → its one warning word, when a summary reader produced one. */
  badges?: Readonly<Record<string, string>>;
  /** `/shop/<slug>`, so a row composes its own destination. */
  shopBasePath: string;
  ariaLabel: string;
}) {
  const pathname = usePathname();
  const sectionId = useSelectedSection(groups);
  const rows = groups.flatMap((group) => group.rows);
  const currentId = currentSettingsRailRowId(rows, {
    pathname,
    basePath: shopBasePath,
    sectionId,
  });
  const hubPath = `${shopBasePath}/settings`;
  const onHub = pathname === hubPath;
  const scrollerRef = useRef<HTMLDivElement>(null);

  // The rail scrolls in a box of its own. Every way in (a direct link, ⌘K's
  // "Go to", the hub's own rows) brings the current destination into view:
  // horizontally on a phone, vertically in the desktop map.
  //
  // The box says when it has moved (`data-rail-settled`), because the move is
  // an effect and lands after the page has painted: the visual suite shot
  // `settings-embed` with the rail at its top on one run and on Website embed
  // on the next, and now waits for this mark instead.
  const [settledFor, setSettledFor] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const reveal = () => {
      if (currentId && scrollerRef.current) revealCurrentRow(scrollerRef.current);
    };
    reveal();
    setSettledFor(currentId);
    window.addEventListener("resize", reveal);
    // The first reveal measures a page that is still settling: a logo, a font or
    // a late banner moves the rows after it, and the current one then sits in the
    // box's bottom fade or off its edge (a flaky `settings-findability` on CI).
    // So the move repeats whenever the rail's content changes size, until the
    // reader's own hand has touched the box. Their scroll is never overridden.
    const scroller = scrollerRef.current;
    let handled = false;
    const markHandled = () => {
      handled = true;
    };
    const resettle = () => {
      if (!handled) reveal();
    };
    const hand = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of hand) scroller?.addEventListener(type, markHandled, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resettle);
    if (scroller?.firstElementChild) observer?.observe(scroller.firstElementChild);
    window.addEventListener("load", resettle);
    return () => {
      window.removeEventListener("resize", reveal);
      window.removeEventListener("load", resettle);
      for (const type of hand) scroller?.removeEventListener(type, markHandled);
      observer?.disconnect();
    };
  }, [currentId]);
  const moreBelow = useMoreBelow(scrollerRef);

  return (
    <nav aria-label={ariaLabel} className={`relative ${SETTINGS_RAIL_COLUMN_CLASS}`}>
      {/* On a phone this is a one-line, horizontally scrollable section bar.
          At desktop width it becomes the same grouped, vertical map. The
          selected destination is brought into view on either axis. */}
      <div
        ref={scrollerRef}
        id="settings-rail-content"
        data-settings-rail-scroller
        data-rail-settled={settledFor === currentId ? "" : undefined}
        data-more-below={moreBelow ? "" : undefined}
        className={`${SETTINGS_RAIL_FRAME_CLASS} overflow-y-hidden lg:overflow-x-hidden lg:overflow-y-auto`}
      >
        <div className={SETTINGS_RAIL_CONTENT_CLASS}>
          {groups.map((group) => {
            const isCurrentGroup = group.rows.some((row) => row.id === currentId);
            return (
              <div key={group.id} className="contents lg:block">
                {/* Prefixed rather than reusing the group's own id: the pane
                    already renders that id on its `<h2>`, and two of them would
                    make the fragment ambiguous.

                    Sticky inside the rail's scroll area, and opaque while it is
                    stuck, so the rows slide under their own group's name rather
                    than past it. `settings-rail-label` (globals.css) paints the
                    words' box from a scroll-state query, which is why they sit
                    in a span of their own: a container cannot style itself. */}
                <GroupLabel
                  id={`settings-rail-${group.id}`}
                  tone={isCurrentGroup ? "primary" : "muted"}
                  className={`settings-rail-label sticky top-0 z-10 hidden ${SETTINGS_RAIL_LABEL_CLASS} lg:block`}
                >
                  <span className={SETTINGS_RAIL_LABEL_WORDS_CLASS}>{group.label}</span>
                </GroupLabel>
                <ul
                  aria-labelledby={`settings-rail-${group.id}`}
                  className="flex w-max items-stretch gap-1 lg:block lg:w-auto"
                >
                  {group.rows.map((row) => {
                    const selected = row.id === currentId;
                    const badge = badges?.[row.id];
                    const isDoor = row.target.kind === "route";
                    return (
                      <li key={row.id} className="shrink-0 lg:shrink">
                        <RailLink
                          href={
                            row.target.kind === "route"
                              ? `${shopBasePath}${row.target.path}`
                              : `${onHub ? "" : hubPath}#${settingsSectionFragment(row.target.id)}`
                          }
                          sameDocument={row.target.kind === "section" && onHub}
                          selected={selected}
                        >
                          <span className="min-w-0 text-pretty">{labels[row.id]}</span>
                          {badge || isDoor ? (
                            <span className="flex shrink-0 items-center gap-2">
                              {badge ? (
                                <Badge tone="warning" size="sm" toneMark={false}>
                                  {badge}
                                </Badge>
                              ) : null}
                              {isDoor ? <DoorChevron /> : null}
                            </span>
                          ) : null}
                        </RailLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

/**
 * Whether the rail's box has rows below its fold: true until the reader
 * scrolls to its foot, and false for a box short enough to show them all.
 * Measured on vertical scroll and resize for the desktop map. The phone bar
 * scrolls on the other axis and has no bottom fade.
 */
function useMoreBelow(scrollerRef: React.RefObject<HTMLDivElement | null>): boolean {
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () =>
      setMoreBelow(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(scroller);
    if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [scrollerRef]);
  return moreBelow;
}

/**
 * Scroll the rail's own box so its current row is in sight when it is not:
 * along the phone's horizontal bar, below the desktop box's fold, or under a
 * group label stuck at the top.
 * A row already in sight is left where it is, so a click inside the rail keeps
 * the reader's place.
 *
 * `scrollTop` or `scrollLeft` on the box, never `scrollIntoView`: that scrolls
 * every scrolling ancestor to the row, the page included, and the reader came
 * to the pane. A zero-sized box is left alone.
 */
function revealCurrentRow(scroller: HTMLElement) {
  const row = scroller.querySelector<HTMLElement>('[aria-current="true"]');
  if (!row) return;
  // Re-measure after a resize or route change; a banner above the rail can
  // make its CSS maximum taller than the space actually left on screen.
  scroller.style.maxHeight = "";
  let box = scroller.getBoundingClientRect();
  if (box.height === 0) return;
  if (scroller.scrollWidth > scroller.clientWidth + 1) {
    const rect = row.getBoundingClientRect();
    if (rect.left >= box.left && rect.right <= box.right) return;
    scroller.scrollLeft += rect.left + rect.width / 2 - (box.left + box.width / 2);
    return;
  }
  if (box.bottom > window.innerHeight) {
    scroller.style.maxHeight = `${Math.max(0, window.innerHeight - box.top - 4)}px`;
    box = scroller.getBoundingClientRect();
  }
  const rect = row.getBoundingClientRect();
  const label = row.closest("ul")?.previousElementSibling;
  const cover = label instanceof HTMLElement ? label.getBoundingClientRect().height : 0;
  // While rows sit below the fold the box's foot fades out (`data-more-below`
  // in globals.css), so a current row in that last 3rem is washed out, not in
  // sight: "Calendar subscriptions" at the rail's foot read as nearly blank.
  const fade =
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1
      ? 3 * (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
      : 0;
  // A demo banner or other chrome can put the bottom of the rail below the
  // viewport even when the row fits inside the rail's own scroll box.
  const visibleBottom = Math.min(box.bottom, window.innerHeight);
  if (rect.top >= box.top + cover && rect.bottom <= visibleBottom - fade) return;
  scroller.scrollTop += rect.top + rect.height / 2 - (box.top + visibleBottom) / 2;
  settleOnRowEdge(scroller, box);
  if (scroller.style.maxHeight) {
    const overflow = row.getBoundingClientRect().bottom - visibleBottom;
    if (overflow > 0) scroller.scrollTop += overflow;
  }
}

/**
 * Finish the move on a row's edge (K-221). Centring put the box's scroll
 * wherever the arithmetic fell, and the label stuck at its top cut whichever
 * row was passing under it — half of "Trip packing checklist" under "YOUR
 * SHOP", a state only a hand could have left the rail in. So the first row the
 * stuck label would cut is brought down to where a row starts under its label
 * at rest, the label's own bottom margin below it. That is less than a row, so
 * the centred row stays in the box.
 */
function settleOnRowEdge(scroller: HTMLElement, box: DOMRect) {
  const stuck = Array.from(scroller.querySelectorAll<HTMLElement>(".settings-rail-label")).find(
    (label) => Math.abs(label.getBoundingClientRect().top - box.top) < 1,
  );
  if (!stuck) return;
  const labelBottom = stuck.getBoundingClientRect().bottom;
  const edge = labelBottom + (Number.parseFloat(getComputedStyle(stuck).marginBottom) || 0);
  const cut = Array.from(scroller.querySelectorAll("li"))
    .map((item) => item.getBoundingClientRect())
    .find((item) => item.bottom > labelBottom);
  if (cut && cut.top < edge) scroller.scrollTop -= edge - cut.top;
}

function RailLink({
  href,
  sameDocument,
  selected,
  children,
}: {
  href: string;
  /** A `#fragment` on the page already open: a plain anchor, so the browser's
   * own reveal algorithm opens the target row and scrolls to it. */
  sameDocument: boolean;
  selected: boolean;
  children: React.ReactNode;
}) {
  // The page rail's one row, ringed inside itself (`ui/rail.ts` says why);
  // `justify-between` keeps a warning badge on the row's far edge.
  const className = `${RAIL_ROW_CLASS} w-max justify-between gap-2 whitespace-nowrap text-base! lg:w-full lg:whitespace-normal lg:text-sm! ${
    selected ? RAIL_ROW_CURRENT : RAIL_ROW_IDLE
  }`;
  const current = selected ? ("true" as const) : undefined;
  if (sameDocument) {
    return (
      <a href={href} aria-current={current} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} aria-current={current} className={className}>
      {children}
    </Link>
  );
}

/** The hub shows one section, identified by its fragment or saved notice. */
function useSelectedSection(groups: readonly SettingsRailGroupView[]): string | null {
  const key = groups
    .flatMap((group) => group.rows)
    .flatMap((row) =>
      row.target.kind === "section"
        ? [`${row.target.id}:${settingsSectionFragment(row.target.id)}`]
        : [],
    )
    .join(",");
  const [sectionId, setSectionId] = useState<string | null>(null);
  useEffect(() => {
    const sections = key
      .split(",")
      .filter(Boolean)
      .map((pair) => {
        const [id, fragment] = pair.split(":");
        return { id: id ?? "", fragment: fragment ?? "" };
      });
    const sync = () => {
      const fragment = window.location.hash.slice(1);
      const saved = new URLSearchParams(window.location.search).get("saved");
      setSectionId(
        sections.find((section) => section.fragment === fragment)?.id ??
          sections.find((section) => section.id === saved)?.id ??
          sections.find((section) => section.id === "timezone")?.id ??
          null,
      );
    };
    const selectionChanged = (event: Event) => {
      const selected = (event as CustomEvent<unknown>).detail;
      setSectionId(sections.find((section) => section.fragment === selected)?.id ?? null);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener(SETTINGS_SELECTION_EVENT, selectionChanged);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(SETTINGS_SELECTION_EVENT, selectionChanged);
    };
  }, [key]);
  return sectionId;
}
