// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, RollCallRecord, TripManifest } from "@/lib/manifests";
import { DiverRollCall } from "./DiverRollCall";

/**
 * **The two rules slice 5a owes ADR
 * 20260827-the-departure-is-two-working-surfaces**, pinned as behaviour rather
 * than as pixels:
 *
 * - **decision 3** — the not-back path is not reachable in one tap from the
 *   list. It lives inside a person's own panel, which costs a deliberate tap on
 *   their name first.
 * - **decision 4** — an alarm is earned by a recorded fact, never by the absence
 *   of one. At a checkpoint where nobody has recorded an exception, nothing on
 *   this list renders in danger tone.
 *
 * Deliberately not a screenshot. A pixel snapshot of this list fails on every
 * legitimate restyle and teaches the next reader to re-baseline without
 * reading, which on a safety surface is the worst habit a test can teach. What
 * these assert is what the ADR actually decided; the layout is free to move.
 */

afterEach(cleanup);

const t = staffTranslator("en-US");

function diver(
  overrides: Partial<TripManifest["divers"][number]> = {},
): TripManifest["divers"][number] {
  return {
    bookingId: "00000000-0000-4000-8000-000000000001",
    fullName: "Meera Iyer",
    email: null,
    emergencyContactName: "Asha Iyer",
    emergencyContactPhone: "+1-305-555-0231",
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "own_kit" },
    nitroxRequested: false,
    checkedIn: false,
    buddyTeam: null,
    buddyAlert: null,
    ...overrides,
  } as TripManifest["divers"][number];
}

function boardedAt(): RollCallRecord {
  return {
    state: "boarded",
    occurredAt: new Date("2026-09-11T12:22:00.000Z"),
    recordedByName: "Keiko Tanaka",
  } as RollCallRecord;
}

function notBackAt(): RollCallRecord {
  return {
    state: "not_boarded",
    occurredAt: new Date("2026-09-11T12:29:00.000Z"),
    recordedByName: "Keiko Tanaka",
  } as RollCallRecord;
}

function renderList({
  divers,
  checkpoint = "after_dive_1",
}: {
  divers: TripManifest["divers"];
  checkpoint?: RollCallCheckpoint;
}) {
  return render(
    <DiverRollCall
      divers={divers}
      crewNames={[]}
      checkpoint={checkpoint}
      isDeparture={checkpoint === "departure"}
      shopSlug="blue-mantis"
      tripId="00000000-0000-4000-8000-0000000000ff"
      locale="en-US"
      timezone="America/New_York"
      notesByBooking={new Map()}
      rollCallAction={vi.fn(async () => ({ ok: true }) as const)}
      addPrivateNoteAction={vi.fn(async () => undefined) as never}
      rollCallButtonCopy={() => ({ errorRefusal: "Try again", blockedMessage: "Still blocked" })}
      buddyTeamLabel={() => null}
      t={t}
    />,
  );
}

/** Every element the screen paints in the app's danger hue at rest. */
function hiddenAtRest(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.classList.contains("hidden")) return true;
  }
  return false;
}

function dangerToned(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[class]")].filter(
    (element) =>
      /(^|[\s:/])(text|bg|border|ring|from|to|via)-danger(\b|-)/.test(element.className) &&
      !hiddenAtRest(element),
  );
}

/** The exception control, wherever in the row it happens to be. */
function exceptionControl(row: HTMLElement, name: string) {
  return [...row.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
}

describe("the not-back path is a deliberate two-step (decision 3)", () => {
  it("puts no exception control in the row a captain taps down the list", () => {
    renderList({ divers: [diver()] });
    const row = screen.getByRole("listitem");
    // The row's own tap is the affirmative, and it is the only control on the
    // row itself.
    expect(within(row).getByRole("button", { name: "Mark boarded" })).toBeVisible();
    const exception = exceptionControl(row, "Mark not back aboard");
    // The claim that somebody did not come back is absent until the person's
    // own sheet opens; there is no hidden duplicate control in the row DOM.
    expect(row.querySelector("details")).toBeNull();
    expect(exception).toBeUndefined();
    const trigger = within(row).getByRole("button", { name: "Open details for Meera Iyer" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the dock's wording behind the same two steps", () => {
    renderList({ divers: [diver()], checkpoint: "departure" });
    const row = screen.getByRole("listitem");
    const exception = exceptionControl(row, "Mark not boarded");
    expect(exception).toBeUndefined();
  });

  it("offers it once the person's own panel is open", () => {
    renderList({ divers: [diver()] });
    const row = screen.getByRole("listitem");
    // The sheet is the tap on the person — the same one that reveals their
    // contact, medical and notes.
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveTextContent("Emergency contact");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Mark not back aboard" }),
    ).toBeVisible();
  });
});

describe("the screen worries only with reason (decision 4)", () => {
  it("renders nothing in danger tone at a checkpoint with no recorded exception", () => {
    const { container } = renderList({
      divers: [
        diver(),
        // Counted back in — the ordinary mid-count state, and the one that
        // used to paint every teammate's row red before anyone had said a word
        // about them.
        diver({
          bookingId: "00000000-0000-4000-8000-000000000002",
          fullName: "Kiona Blackfeather",
          rollCall: boardedAt(),
        }),
        // Readiness never gates boarding after a dive — the diver is already
        // aboard — so a desk blocker is not an alarm at the rail.
        diver({
          bookingId: "00000000-0000-4000-8000-000000000003",
          fullName: "Amara Osei",
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(dangerToned(container)).toHaveLength(0);
  });

  it("pins the alarm the moment a human records someone not back", () => {
    const { container } = renderList({
      divers: [diver({ rollCall: notBackAt() })],
    });
    expect(dangerToned(container).length).toBeGreaterThan(0);
    // And it carries a word, never colour alone: the who-and-when of the
    // record itself sits under the name.
    expect(screen.getByRole("listitem")).toHaveTextContent(/Keiko Tanaka/);
  });

  it("keeps the minor flag on screen when something louder took the row's capsule", () => {
    // The two cases where the capsule is spoken for — blocked at the dock, and
    // a split team — are exactly the ones where a 13-year-old is most likely to
    // be on the row that lost it. The captain reading the boarding list has no
    // other way to know a booked diver is 12 (H-21).
    renderList({
      checkpoint: "departure",
      divers: [
        diver({
          age: 13,
          minor: true,
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(screen.getAllByText("Minor · age 13").length).toBeGreaterThan(0);
  });
});

describe("a recorded alarm sorts to the top, and paper does not (decision 4)", () => {
  /** The three seats, in the order the manifest gave them. */
  const roster = () => [
    diver({ bookingId: "b-1", fullName: "Ana Ruiz" }),
    diver({ bookingId: "b-2", fullName: "Diego Marín" }),
    diver({ bookingId: "b-3", fullName: "Priya Sharma", rollCall: notBackAt() }),
  ];

  it("pulls the not-back row to the top on screen while it keeps its manifest number", () => {
    const { container } = renderList({ divers: roster() });
    const rows = [...container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")];
    expect(rows.map((row) => row.id)).toEqual(["diver-row-b-1", "diver-row-b-2", "diver-row-b-3"]);

    // The move is `order-first` on a flex column, not a re-sorted array: the
    // DOM *is* the printed order, so paper never depends on what the screen
    // did. Priya is third in the document and first under a reader's eye.
    const alarmed = rows.find((row) => row.id === "diver-row-b-3");
    expect(alarmed?.className).toContain("order-first");
    expect(alarmed?.className).toContain("print:order-none");
    for (const row of rows.filter((candidate) => candidate.id !== "diver-row-b-3")) {
      expect(row.className).not.toContain("order-first");
    }

    // Her place on the manifest is a fact about the boat, not about the list,
    // so it rides with her.
    expect(within(alarmed as HTMLElement).getByText("03")).toBeTruthy();
  });

  it("draws the top hairline where each medium actually starts the list", () => {
    const { container } = renderList({ divers: roster() });
    const rule = (bookingId: string) =>
      container.querySelector<HTMLElement>(`li[id='diver-row-${bookingId}'] > div`)?.className ??
      "";

    // On screen the list starts at the alarmed row, so that one carries no top
    // rule and Ana -- first in the document -- now does.
    expect(rule("b-3")).toContain("border-t-0");
    expect(rule("b-1")).toMatch(/(^|\s)border-t(\s|$)/);
    // On paper the list starts at the top of the manifest, which is Ana.
    expect(rule("b-1")).toContain("print:border-t-0");
    expect(rule("b-3")).toContain("print:border-t");
  });

  it("holds the printed order in block layout, not on the cascade", () => {
    const { container } = renderList({ divers: roster() });
    const list = container.querySelector<HTMLElement>("ul");
    // `order` is inert outside a flex or grid container, so `print:block` is
    // what makes the DOM order the printed order by construction. Without it
    // the sheet a coastguard reads depends on Tailwind emitting the
    // `print:order-none` variant after `order-first` at equal specificity —
    // true today, and not something a manifest should rest on (dive-domain
    // review 20260828).
    expect(list?.className).toContain("flex");
    expect(list?.className).toContain("print:block");
  });

  it("keeps each row whole across a page break", () => {
    // The printed manifest goes ashore. A diver's name split down the middle
    // by a page boundary is a defect in the record, not a layout nit — the
    // printed tables carry the same class for the same reason.
    const { container } = renderList({ divers: roster() });
    for (const row of container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")) {
      expect(row.className).toContain("break-inside-avoid");
    }
  });

  it("keeps two alarmed rows in manifest order among themselves", () => {
    // Equal `order` values fall back to document order, so a second alarm does
    // not reshuffle the first. Worth pinning: a boat with two divers still in
    // the water is the moment a list that reorders under a thumb costs a
    // miscount, and nothing else in the suite states this.
    const { container } = renderList({
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz" }),
        diver({ bookingId: "b-2", fullName: "Diego Marín", rollCall: notBackAt() }),
        diver({ bookingId: "b-3", fullName: "Priya Sharma", rollCall: notBackAt() }),
      ],
    });
    const rows = [...container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")];
    expect(rows.map((row) => row.id)).toEqual(["diver-row-b-1", "diver-row-b-2", "diver-row-b-3"]);
    for (const id of ["diver-row-b-2", "diver-row-b-3"]) {
      expect(rows.find((row) => row.id === id)?.className).toContain("order-first");
    }
    // Diego is the first row on screen, so he carries no top rule and Ana --
    // still first in the document -- gains one.
    const rule = (bookingId: string) =>
      container.querySelector<HTMLElement>(`li[id='diver-row-${bookingId}'] > div`)?.className ??
      "";
    expect(rule("b-2")).toContain("border-t-0");
    expect(rule("b-3")).toMatch(/(^|\s)border-t(\s|$)/);
    expect(rule("b-1")).toMatch(/(^|\s)border-t(\s|$)/);
  });

  it("moves nothing when the only records are ordinary ones", () => {
    const { container } = renderList({
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz", rollCall: boardedAt() }),
        diver({ bookingId: "b-2", fullName: "Diego Marín" }),
      ],
    });
    for (const row of container.querySelectorAll<HTMLElement>("li[id^='diver-row-']")) {
      expect(row.className).not.toContain("order-first");
    }
    // And the list still starts where the manifest does.
    expect(
      container.querySelector<HTMLElement>("li[id='diver-row-b-1'] > div")?.className,
    ).toContain("border-t-0");
  });
});

/**
 * ADR 20260828-a-missing-diver-gets-a-sentence. The note was deleted and came
 * back narrowed, and the narrowing is the whole decision — so what is pinned is
 * where the box appears rather than what it looks like.
 */
describe("the row offers one place to say what happened, and only where it applies", () => {
  const noteBoxes = (container: HTMLElement) =>
    // Not `[name='note']`: the private staff note on the same row posts under
    // that name too, to a different action.
    [...container.querySelectorAll<HTMLTextAreaElement>("textarea[data-roll-call-note]")];

  it("offers no box at the dock, where not boarded means never left", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ bookingId: "b-1" })],
    });
    expect(noteBoxes(container)).toHaveLength(0);
  });

  it("offers exactly one after a dive, on the control about to raise the alarm", () => {
    const { container } = renderList({ divers: [diver({ bookingId: "b-1" })] });
    fireEvent.click(within(container).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(noteBoxes(document.body)).toHaveLength(1);
    // Inside the form that posts the mark, so there is no second save to lose
    // and nothing to mirror to the device.
    expect(noteBoxes(document.body)[0]?.closest("form")).not.toBeNull();
  });

  it("keeps it to one once the alarm stands, on the sighting rather than the undo", () => {
    // Both controls render on an alarmed row: "Mark back aboard" and the
    // settled exception control. Two boxes asking one question side by side is
    // what the rule avoids — the sighting takes it, the `cleared` undo has
    // nothing to observe.
    const { container } = renderList({
      divers: [diver({ bookingId: "b-1", rollCall: notBackAt() })],
    });
    fireEvent.click(within(container).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(noteBoxes(document.body)).toHaveLength(1);
  });

  it("shows what was already written, so nobody types it twice", () => {
    const { container } = renderList({
      divers: [
        diver({
          bookingId: "b-1",
          rollCall: { ...notBackAt(), note: "Surfaced 200 m north, picked up by Reef Runner." },
        }),
      ],
    });
    const row = within(container).getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Surfaced 200 m north, picked up by Reef Runner.",
    );
  });
});

describe("the person a diver must dive with is checked against this departure", () => {
  /**
   * Issue #1068. "Dives with Omar Haddad" at the rail tells a crew a constraint
   * is in place. If Omar was never booked on this departure it is not — the
   * same class of error as a stale readiness badge, about the fact the diver is
   * most relying on. It informs and never gates: the departure sails either
   * way.
   */
  const withBuddy = (name: string) =>
    diver({
      bookingId: "b-1",
      fullName: "Diego Marín",
      supportNeeds: {
        supportDiversNeeded: null,
        supportDiversProvidedBy: null,
        needsBoardingAssistance: false,
        needsWaterLift: false,
        briefingInSign: false,
        briefingInWriting: false,
        briefingAloud: false,
        briefingBySignals: false,
        equipmentAdaptation: null,
        divesWithName: name,
        statedAt: new Date("2026-09-10T09:00:00.000Z"),
      },
    });

  it("says so when that person is on the departure, matching loosely", () => {
    // A first name alone counts: the diver typed what they call him.
    const { container } = renderList({
      divers: [withBuddy("Omar"), diver({ bookingId: "b-2", fullName: "Omar Haddad" })],
    });
    expect(container.textContent).toContain("Dives with Omar, on this departure");
  });

  it("counts the crew, who are on the boat but not on the diver list", () => {
    const { container } = render(
      <DiverRollCall
        divers={[withBuddy("Keiko Tanaka")]}
        crewNames={["Keiko Tanaka"]}
        checkpoint="after_dive_1"
        isDeparture={false}
        shopSlug="blue-mantis"
        tripId="00000000-0000-4000-8000-0000000000ff"
        locale="en-US"
        timezone="America/New_York"
        notesByBooking={new Map()}
        rollCallAction={vi.fn(async () => ({ ok: true }) as const)}
        addPrivateNoteAction={vi.fn(async () => undefined) as never}
        rollCallButtonCopy={() => ({ errorRefusal: "Try again", blockedMessage: "Still blocked" })}
        buddyTeamLabel={() => null}
        t={t}
      />,
    );
    expect(container.textContent).toContain("on this departure");
    expect(container.textContent).not.toContain("not booked");
  });

  it("says plainly when they are not booked, and still blocks nothing", () => {
    const { container } = renderList({ divers: [withBuddy("Omar Haddad")] });
    expect(container.textContent).toContain("not booked on this departure");
    // Informs, never gates (the ADR's fourth refusal): no danger tone, and the
    // row's ordinary controls are untouched.
    expect(dangerToned(container)).toHaveLength(0);
  });
});

describe("asserting aboard over a missing mark is never the cheap direction", () => {
  // ADR 20260815-offline-can-unsay-a-missing-diver: "neither makes retracting a
  // mark harder than making one". That record left the live manifest out on the
  // grounds that it "already has the honest undo one tap away" — which stopped
  // being true the moment the exception control moved into the person's panel.
  it("takes the row's tap away once a diver is recorded not back", () => {
    renderList({ divers: [diver({ rollCall: notBackAt() })] });
    const row = screen.getByRole("listitem");
    expect(within(row).queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
  });

  it("costs the same two gestures in both directions, from the person's panel", () => {
    renderList({ divers: [diver({ rollCall: notBackAt() })] });
    const row = screen.getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: "Open details for Meera Iyer" }));
    const sheet = screen.getByRole("dialog");
    const backAboard = within(sheet).getByRole("button", { name: /^Mark back aboard/ });
    const retract = within(sheet).getByRole("button", { name: "Not back aboard" });
    expect(backAboard).toBeDefined();
    expect(retract).toBeDefined();
  });

  it("still says a diver is blocked at the dock, where readiness does gate boarding", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(dangerToned(container).length).toBeGreaterThan(0);
    // A blocked diver has no tap to offer: the act that clears them is ashore.
    expect(screen.queryByRole("button", { name: "Mark boarded" })).not.toBeInTheDocument();
  });
});
