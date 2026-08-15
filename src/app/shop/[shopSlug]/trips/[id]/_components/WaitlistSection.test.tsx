// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DeclaredDiveProfile } from "@/db/self-declared-cards";
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

function renderSection(
  waitlist: Waitlist,
  diveProfiles: Map<string, DeclaredDiveProfile> = new Map(),
) {
  return render(
    <WaitlistSection
      waitlist={waitlist}
      shopSlug="blue-mantis"
      tripId="trip-1"
      shopName="Blue Mantis"
      tripTitle="Wreck Trip"
      tripWhen="Sat 15 Aug"
      inviteAction={async () => "sent" as const}
      diveProfiles={diveProfiles}
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

/**
 * The row a staffer reads before deciding who to invite onto a gated
 * departure (FU-20260813). A level a diver typed about themselves on the public
 * form is *never* allowed to read like a card the shop checked — that
 * indistinguishability is the whole failure this section was changed to
 * prevent — and a diver who said nothing has to say so out loud rather than
 * leaving a gap.
 */
describe("WaitlistSection declared level", () => {
  const waiting = [entry("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z"))];

  it("marks a self-declared level as self-declared", () => {
    renderSection(
      waiting,
      new Map([
        [
          "p-a",
          {
            level: "open_water",
            levelSelfDeclared: true,
            nitrox: false,
            nitroxSelfDeclared: false,
          } satisfies DeclaredDiveProfile,
        ],
      ]),
    );

    // Names the absence, not the source. "Open Water (self-declared)" parsed as
    // "we know they're Open Water" with a footnote about provenance — and on a
    // phone-width row the footnote is the first thing to truncate.
    const line = screen.getByText(/Open Water — diver's word, no card/);
    expect(line).toBeVisible();
    // Warning-toned, the same treatment an imported specialty card gets so it
    // is never scanned as a plain level.
    expect(line).toHaveClass("text-warning");
  });

  it("renders a card the shop actually holds without the self-declared mark", () => {
    renderSection(
      waiting,
      new Map([
        [
          "p-a",
          {
            level: "advanced_open_water",
            levelSelfDeclared: false,
            nitrox: true,
            nitroxSelfDeclared: true,
          } satisfies DeclaredDiveProfile,
        ],
      ]),
    );

    // The level is the shop's own record and stands plainly; the nitrox tick
    // beside it is still only a claim, and carries its own mark — the two can
    // differ for one diver, which is why each is marked separately.
    const line = screen.getByText(/Advanced Open Water/);
    expect(line.textContent).not.toMatch(/Advanced Open Water — diver's word/);
    expect(line.textContent).toMatch(/Nitrox — diver's word, no card/);
    // One unchecked claim anywhere on the line tones the whole line: the row is
    // a single decision ("do I invite this person?"), and the weakest fact on
    // it is the one that has to survive a glance.
    expect(line).toHaveClass("text-warning");
  });

  it("states that a joiner said nothing, rather than leaving the row blank", () => {
    renderSection(waiting);

    const line = screen.getByText(/Level not said/);
    expect(line).toBeVisible();
    // "Not said" is honest and common, not a warning: nobody claimed anything,
    // so there is no unchecked claim on the row to tone it.
    expect(line).toHaveClass("text-muted");
  });
});
