// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CertificationSummary } from "@/db/self-declared-cards";
import type { CertificationLevel, CertRequirementSource } from "@/lib/readiness";
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
  certificationSummaries: Map<string, CertificationSummary> = new Map(),
  departureRequirement: CertRequirementSource | null = null,
) {
  return render(
    <WaitlistSection
      departureRequirement={departureRequirement}
      waitlist={waitlist}
      shopSlug="blue-mantis"
      tripId="trip-1"
      shopName="Blue Mantis"
      tripTitle="Wreck Trip"
      tripWhen="Sat 15 Aug"
      inviteAction={async () => "sent" as const}
      certificationSummaries={certificationSummaries}
      locale="en-US"
      timezone="America/New_York"
    />,
  );
}

function requirement(minimumCertificationLevel: CertificationLevel): CertRequirementSource {
  return { minimumCertificationLevel, requiredSpecialties: [], requiresNitrox: false };
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
            noCertificationDeclared: false,
            nitrox: false,
            nitroxSelfDeclared: false,
          } satisfies CertificationSummary,
        ],
      ]),
    );

    // Names the absence, not the source. "Open Water (self-declared)" parsed as
    // "we know they're Open Water" with a footnote about provenance — and on a
    // phone-width row the footnote is the first thing to truncate.
    const line = screen.getByText(/Open Water — unconfirmed/);
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
            noCertificationDeclared: false,
            nitrox: true,
            nitroxSelfDeclared: true,
          } satisfies CertificationSummary,
        ],
      ]),
    );

    // The level is the shop's own record and stands plainly; the nitrox tick
    // beside it is still only a claim, and carries its own mark — the two can
    // differ for one diver, which is why each is marked separately.
    const line = screen.getByText(/Advanced Open Water/);
    expect(line.textContent).not.toMatch(/Advanced Open Water — diver's word/);
    expect(line.textContent).toMatch(/Nitrox — unconfirmed/);
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

  /**
   * The answer these rows could not tell from silence until 2026-08-15. A
   * wait-list invite is a staffer offering one named person a seat on one
   * departure, so reading "Level not said" for somebody who has never breathed
   * off a regulator is the same failure as the deal blast's, one diver at a
   * time.
   */
  it("tells 'not certified yet' apart from a joiner who said nothing", () => {
    renderSection(
      waiting,
      new Map([
        [
          "p-a",
          {
            level: null,
            levelSelfDeclared: false,
            noCertificationDeclared: true,
            nitrox: false,
            nitroxSelfDeclared: false,
          } satisfies CertificationSummary,
        ],
      ]),
    );

    const line = screen.getByText(/Not certified yet — unconfirmed/);
    expect(line).toBeVisible();
    // Somebody's word, nobody's card — the same tone every unchecked claim on
    // this row wears.
    expect(line).toHaveClass("text-warning");
  });
});

/**
 * **The mark without the ordering** (ADR 20260814-self-declared-cards, the
 * 2026-08-15 amendment).
 *
 * A wait list is per-trip, so the departure's own bar is in hand on this page —
 * and the invite beside each name is a staffer offering *this* seat to *this*
 * diver, one at a time. So the row says when the diver ranks under it. What it
 * must never do is what the deal list does with the same fact: lift, hide, or
 * gate. The order here is who asked first (ADR 20260813-wait-list-is-a-lead-list).
 */
describe("WaitlistSection below the departure's bar", () => {
  const waiting = [entry("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z"))];
  const card = (over: Partial<CertificationSummary> = {}): CertificationSummary => ({
    level: "open_water",
    levelSelfDeclared: false,
    noCertificationDeclared: false,
    nitrox: false,
    nitroxSelfDeclared: false,
    ...over,
  });
  const summaries = (over?: Partial<CertificationSummary>) => new Map([["p-a", card(over)]]);

  it("says a carded diver ranks below this departure's minimum", () => {
    renderSection(waiting, summaries(), requirement("advanced_open_water"));

    const line = screen.getByText("Open Water · below this departure's minimum");
    expect(line).toBeVisible();
    // The tone is untouched: it answers "has anybody seen this card?" and only
    // that. This card the shop holds, so the row stays calm and says the rest
    // in words (design/principles.md #6).
    expect(line).toHaveClass("text-muted");
  });

  it("keeps both marks when the level is also only the diver's word", () => {
    renderSection(
      waiting,
      summaries({ levelSelfDeclared: true }),
      requirement("advanced_open_water"),
    );

    const line = screen.getByText("Open Water — unconfirmed · below this departure's minimum");
    expect(line).toBeVisible();
    // Two facts, two carriers: unchecked tones the row, under the bar is words.
    expect(line).toHaveClass("text-warning");
  });

  it("says nothing of the sort about a diver at or above the bar", () => {
    renderSection(
      waiting,
      summaries({ level: "advanced_open_water" }),
      requirement("advanced_open_water"),
    );

    const line = screen.getByText("Advanced Open Water");
    expect(line).toBeVisible();
    expect(screen.queryByText(/below this departure's minimum/)).toBeNull();
  });

  it("says nothing when the departure asks for no level at all", () => {
    renderSection(waiting, summaries(), null);

    expect(screen.getByText("Open Water")).toBeVisible();
    expect(screen.queryByText(/below this departure's minimum/)).toBeNull();
  });

  it("marks a diver who said they have no card as below any departure bar", () => {
    // The shared predicate treats a stated absence of a card as below a rung,
    // specialty, or nitrox requirement without pretending "none" is a ladder
    // level. This row states the same fact as the deal panel, but does not move.
    renderSection(
      waiting,
      new Map([["p-a", card({ level: null, noCertificationDeclared: true })]]),
      requirement("advanced_open_water"),
    );

    expect(
      screen.getByText(/Not certified yet — unconfirmed · below this departure's minimum/),
    ).toBeVisible();
  });

  it("leaves the order alone: the mark lifts nobody", () => {
    renderSection(
      [
        entry("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z")),
        entry("b", "Rafa Ortiz", new Date("2026-08-03T14:00:00Z")),
      ],
      new Map([
        // Rafa asked second and is the one under the bar. He stays second.
        ["p-a", card({ level: "instructor" })],
        ["p-b", card()],
      ]),
      requirement("advanced_open_water"),
    );

    const names = [...document.querySelectorAll("li p.font-medium")].map((node) =>
      node.textContent?.trim(),
    );
    expect(names).toEqual(["Nora Quinn", "Rafa Ortiz"]);
    // And the invite is still offered to him, unchanged: this informs, it never
    // gates (ADR 20260814-self-declared-cards decision 4).
    expect(screen.getByRole("button", { name: /Email Rafa an invite/ })).toBeEnabled();
  });
});
