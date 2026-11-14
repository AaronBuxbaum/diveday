// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// This component only needs pure grouping; the feature barrel also exports DB readers.
vi.mock("@/features/today", async () => import("@/features/today/today"));

import type { TodayAction } from "@/features/today";
import { pushRollCallRows } from "@/features/today/today-roll-call-rows";
import { rowsContext } from "@/features/today/today-rows-test-fixtures";
import { staffTranslator } from "@/i18n/staff-messages";
import { NeedsYouGroups } from "./NeedsYouGroups";

afterEach(cleanup);

const action = (id: string, label: string): TodayAction => ({
  id,
  kind: "roll_call_unfinished",
  urgency: "now",
  subject: "Reef trip",
  context: label,
  departure: { tripId: "reef", label },
  aboutDeparture: true,
  detail: `${label}: 2 of 11 people have no result`,
  detailWithoutMeetingDay: "2 of 11 people have no result",
  actionLabel: "Open roll call",
  href: "/manifest",
  dueAt: null,
});

function show(rows: TodayAction[]) {
  render(
    <NeedsYouGroups
      rows={rows}
      row={(item) => <li key={item.id}>{item.detail}</li>}
      shopSlug="demo"
      t={staffTranslator("en-US")}
    />,
  );
}

it("says shared meeting context once without changing the underlying warning", () => {
  const rows = [action("diver", "Nov 13, 2:30 PM EST"), action("crew", "Nov 13, 2:30 PM EST")];
  const originals = rows.map((item) => item.detail);
  show(rows);
  expect(screen.getAllByText("2 of 11 people have no result")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "Nov 13, 2:30 PM EST" })).toBeVisible();
  expect(rows.map((item) => item.detail)).toEqual(originals);
});

it("retains row context when the same trip has multiple meetings or moments", () => {
  const rows = [action("day1", "Nov 13, 2:30 PM EST"), action("day2", "Nov 14, 2:30 PM EST")];
  show(rows);
  for (const item of rows) expect(screen.getByText(item.detail)).toBeVisible();
});

it("does not collapse distinct meeting days that happen to share a formatted label", () => {
  const first = {
    ...action("day1", "Nov 13, 2:30 PM EST"),
    meetingDayNumber: 1,
    detail: "Day 1 warning",
  };
  const second = {
    ...action("day2", "Nov 13, 2:30 PM EST"),
    meetingDayNumber: 2,
    detail: "Day 2 warning",
  };
  show([first, second]);
  expect(screen.getByText("Day 1 warning")).toBeVisible();
  expect(screen.getByText("Day 2 warning")).toBeVisible();
});

it.each([
  ["en-US", "Day 2"],
  ["es-ES", "Día 2"],
] as const)("keeps the course day number for a single later meeting in %s", (locale, label) => {
  const rows: TodayAction[] = [];
  pushRollCallRows(
    rows,
    rowsContext(
      {
        boatsOut: { out: [], blocked: [] },
        crewClashState: {
          departures: [],
          clashes: new Map(),
          boatClashes: new Map(),
          crew: new Map(),
          divers: new Map(),
        },
        rollCallGaps: [
          {
            tripId: "reef",
            title: "Reef trip",
            dayNumber: 2,
            startsAt: new Date("2026-07-21T12:00:00Z"),
            endsAt: new Date("2026-07-21T16:00:00Z"),
            capacity: 12,
            priceCents: null,
            reason: "after_dive_uncounted",
            diveNumber: 2,
            uncounted: 2,
            total: 11,
            rosterSize: 11,
            underway: false,
            stale: false,
            alertedAt: null,
            shoreAlertedAt: null,
          },
        ],
      },
      { locale, t: staffTranslator(locale) },
    ),
  );
  show(rows);
  expect(screen.getByRole("listitem")).toHaveTextContent(label);
});

it.each([
  [true, false, "Owners alerted"],
  [false, true, "Shore contact alerted"],
  [true, true, "Owners and shore contact alerted"],
] as const)(
  "preserves alert recipients and timestamp while compacting (%s, %s)",
  (owners, shore, label) => {
    const rows: TodayAction[] = [];
    const sentAt = new Date("2026-07-21T16:40:00Z");
    pushRollCallRows(
      rows,
      rowsContext({
        boatsOut: { out: [], blocked: [] },
        rollCallGaps: [
          {
            tripId: "reef",
            title: "Reef trip",
            dayNumber: 1,
            startsAt: new Date("2026-07-21T12:00:00Z"),
            endsAt: new Date("2026-07-21T16:00:00Z"),
            capacity: 12,
            priceCents: null,
            reason: "after_dive_uncounted",
            diveNumber: 2,
            uncounted: 2,
            total: 11,
            rosterSize: 11,
            underway: false,
            stale: true,
            alertedAt: owners ? sentAt : null,
            shoreAlertedAt: shore ? sentAt : null,
          },
        ],
        crewClashState: {
          departures: [],
          clashes: new Map(),
          boatClashes: new Map(),
          crew: new Map(),
          divers: new Map(),
        },
      }),
    );
    show(rows);
    const displayed = screen.getByRole("listitem").textContent?.replace(/\s+/gu, " ");
    expect(displayed).toContain(`${label}: Jul 21, 12:40 PM EDT.`);
    expect(displayed).toContain("2 of 11");
    expect(displayed).not.toContain("Day 1");
    expect(rows[0].detail).toContain("Day 1");
  },
);
