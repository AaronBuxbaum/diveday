"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { GroupLabel } from "@/components/ui/ledger";
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
 * above the content is the sub-nav card this repo deleted once already. That
 * is also why a row is 36px rather than the app's 44px touch floor — no finger
 * ever reaches this control, and the floor is the dock test's, an operating
 * condition for a wet hand on a phone.
 *
 * **The selection model is one thing, decided in `settings-groups.ts`.** A row
 * pointing at a sub-route selects by pathname; a row pointing at a hub section
 * is a `#fragment` link and selects by the scroll-spy below. The two never
 * blur, and neither ever turns a hub section into a route.
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
    <nav aria-label={ariaLabel} className="hidden lg:block">
      {/* Sticky, and scrollable in its own right: the map is longer than a
          laptop viewport, and a rail that scrolled the page away with it would
          be a map you have to leave to read. */}
      <div className="sticky top-20 max-h-[calc(100svh-6rem)] space-y-6 overflow-y-auto py-10 pe-2">
        {groups.map((group) => (
          <div key={group.id}>
            {/* Prefixed rather than reusing the group's own id: the pane
                already renders that id on its `<h2>`, and two of them would
                make the fragment ambiguous. */}
            <GroupLabel id={`settings-rail-${group.id}`} className="mb-2 px-2">
              {group.label}
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
        ))}
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
  const className = `flex h-9 items-center justify-between gap-2 rounded-lg px-2 text-sm font-medium transition-brand ${
    selected
      ? "bg-primary-tint text-primary"
      : "text-muted hover:bg-surface-sunken hover:text-foreground"
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
