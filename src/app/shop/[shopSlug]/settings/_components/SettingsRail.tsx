"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { GroupLabel } from "@/components/ui/ledger";
import { RAIL_ROW_CLASS, RAIL_ROW_CURRENT, RAIL_ROW_IDLE } from "@/components/ui/rail";
import {
  currentSettingsRailRowId,
  type SettingsRailRow,
  settingsSectionFragment,
} from "../settings-groups";

/**
 * **The settings rail** — the left column of ADR
 * 20260827-clearwater-surface-language's decision 6, "Settings is a rail and a
 * pane". The whole map of the shop's switches at desktop, so "where do I
 * change X?" is answered by looking rather than by scrolling forty rows.
 *
 * It renders from `lg` up and **nowhere else**: below that the phone keeps the
 * grouped list, which is already the right anatomy, and a directory stacked
 * above the content is the sub-nav card this repo deleted once already. Its
 * rows are the page rail's one row (`RAIL_ROW_CLASS`, shared with the long
 * editor's section rail) at the 44px floor: `lg` starts at 1024px, which is a
 * landscape tablet held in the hand.
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
 * signal that Money and Data & integrations existed at all below the fold.
 * Each group label is sticky inside the rail's own scroll area now, so the
 * group you are reading is named at the top of the column and the next one
 * announces itself as it arrives, and the group holding the current row wears
 * the `primary` tone `GroupLabel` keeps for exactly that. The frame is tighter
 * too (`py-6`, `space-y-5`) — four more rows before the fold, at no cost to
 * the ramp.
 */

/** How far down the viewport the "current section" reading line sits. */
const READING_LINE_PX = 120;

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
  const sectionId = useSectionScrollSpy(groups);
  const rows = groups.flatMap((group) => group.rows);
  const currentId = currentSettingsRailRowId(rows, {
    pathname,
    basePath: shopBasePath,
    sectionId,
  });
  const hubPath = `${shopBasePath}/settings`;
  const onHub = pathname === hubPath;

  return (
    <nav aria-label={ariaLabel} className="hidden lg:block lg:w-[264px] lg:shrink-0">
      {/* Sticky, and scrollable in its own right: the map is longer than a
          laptop viewport, and a rail that scrolled the page away with it would
          be a map you have to leave to read. It pins at the bar's own height
          token, never a number: `top-20` was a guess 24px below the 3.5rem bar,
          so the rail hung in a gap on every viewport and its scroll area was
          short by the same amount (ADR
          20260827-clearwater-surface-language, decision 10). */}
      <div className="sticky top-(--chrome-h) max-h-[calc(100svh-var(--chrome-h))] space-y-5 overflow-y-auto py-6 pe-2">
        {groups.map((group) => {
          const isCurrentGroup = group.rows.some((row) => row.id === currentId);
          return (
            <div key={group.id}>
              {/* Prefixed rather than reusing the group's own id: the pane
                  already renders that id on its `<h2>`, and two of them would
                  make the fragment ambiguous.

                  Sticky inside the rail's scroll area, and opaque while it is
                  stuck, so the rows slide under their own group's name rather
                  than past it. Only then: at rest the first label sits on the
                  staff page's water-band wash, where an always-opaque label
                  was a grey slab across the blue. `settings-rail-label`
                  (globals.css) paints the words' box from a scroll-state
                  query, which is why they sit in a span of their own: a
                  container cannot style itself. */}
              <GroupLabel
                id={`settings-rail-${group.id}`}
                tone={isCurrentGroup ? "primary" : "muted"}
                className="settings-rail-label sticky top-0 z-10 mb-2"
              >
                <span className="block px-3 py-1">{group.label}</span>
              </GroupLabel>
              <ul aria-labelledby={`settings-rail-${group.id}`}>
                {group.rows.map((row) => {
                  const selected = row.id === currentId;
                  const badge = badges?.[row.id];
                  return (
                    <li key={row.id}>
                      <RailLink
                        href={
                          row.target.kind === "route"
                            ? `${shopBasePath}${row.target.path}`
                            : `${onHub ? "" : hubPath}#${settingsSectionFragment(row.target.id)}`
                        }
                        sameDocument={row.target.kind === "section" && onHub}
                        selected={selected}
                      >
                        <span className="truncate">{labels[row.id]}</span>
                        {/* At most one badge per row, and only for a warning —
                            the settled states of these rows are quiet text on
                            the pane, not a pill on the map. */}
                        {badge ? (
                          <Badge tone="warning" size="sm" toneMark={false}>
                            {badge}
                          </Badge>
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
    </nav>
  );
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
  const className = `${RAIL_ROW_CLASS} justify-between gap-2 ${
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

/**
 * Which hub section the reader is standing in front of, from scroll position.
 *
 * Anchors are looked up by the section's own `#fragment` — the id the pane
 * already renders on each row's heading — so the spy needs no second set of
 * markers to fall out of step with. Off the hub there are no anchors and this
 * answers `null`, which is what leaves the pathname to decide.
 */
function useSectionScrollSpy(groups: readonly SettingsRailGroupView[]): string | null {
  // Serialised to a string so the effect's dependency is the *content* of the
  // list rather than a fresh array identity on every render.
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
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current: string | null = null;
      let first: string | null = null;
      for (const section of sections) {
        const anchor = document.getElementById(section.fragment);
        if (!anchor) continue;
        first ??= section.id;
        if (anchor.getBoundingClientRect().top <= READING_LINE_PX) current = section.id;
        else break;
      }
      // The first section counts as current before the page has scrolled past
      // it, so the map is never blank at the top of the pane.
      setSectionId(current ?? first);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, [key]);

  return sectionId;
}
