// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Waitlist } from "./types";
import { WaitlistSection } from "./WaitlistSection";

afterEach(cleanup);

function entry(id: string, fullName: string, createdAt: Date): Waitlist[number] {
  return {
    // The section reads only these fields off the joined row; the full
    // `trip_waitlist_entries`/`people` shapes aren't exercised here.
    entry: { id, createdAt, invitedAt: null } as unknown as Waitlist[number]["entry"],
    person: {
      id: `p-${id}`,
      fullName,
      email: `${id}@example.com`,
    } as unknown as Waitlist[number]["person"],
  };
}

function renderSection(waitlist: Waitlist) {
  return render(
    <WaitlistSection
      waitlist={waitlist}
      shopSlug="blue-mantis"
      tripId="trip-1"
      shopName="Blue Mantis"
      tripTitle="Wreck Trip"
      tripWhen="Sat 15 Aug"
      inviteAction={async () => "sent" as const}
      locale="en-US"
      timezone="America/New_York"
    />,
  );
}

/**
 * A wait list is a set of leads, not a queue (ADR
 * 20260813-wait-list-is-a-lead-list). The rank badge this list used to render
 * down its left edge was the queue claim, sitting on the one surface where the
 * invite decision is actually made — so it must not come back.
 */
describe("WaitlistSection ranking", () => {
  const waiting = [
    entry("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z")),
    entry("b", "Rafa Ortiz", new Date("2026-08-03T14:00:00Z")),
  ];

  it("ranks nobody: no ordered list, and no position badge beside a name", () => {
    const { container } = renderSection(waiting);

    expect(container.querySelector("ol")).toBeNull();
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    // The badge was a `<span>` inside the row holding nothing but the index.
    // Any element in the list whose entire text is a small integer is that
    // badge coming back. (The heading's own count span is outside the list.)
    const rankLike = [...(list?.querySelectorAll("span") ?? [])].filter((node) =>
      /^\d{1,2}$/.test(node.textContent?.trim() ?? ""),
    );
    expect(rankLike).toEqual([]);
  });

  it("shows when each diver asked, in the shop's zone, so the longest wait is still visible", () => {
    renderSection(waiting);

    // 14:00 UTC is the same calendar day in America/New_York; a naive render in
    // the host zone (UTC on CI) would agree here, so the zone is asserted by
    // `formatShortDate`'s required parameter rather than by this expectation.
    expect(screen.getByText(/Asked Sat, Aug 1/)).toBeVisible();
    expect(screen.getByText(/Asked Mon, Aug 3/)).toBeVisible();
  });

  it("tells staff plainly that nobody on the list is owed the seat", () => {
    renderSection(waiting);

    expect(screen.getByText(/nobody here is promised the seat/)).toBeVisible();
  });
});
