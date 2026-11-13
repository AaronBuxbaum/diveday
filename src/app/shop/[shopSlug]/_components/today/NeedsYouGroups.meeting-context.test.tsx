// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// This component only needs pure grouping; the feature barrel also exports DB readers.
vi.mock("@/features/today", async () => import("@/features/today/today"));

import type { TodayAction } from "@/features/today";
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
