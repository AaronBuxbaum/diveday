// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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

/**
 * Whether an element is out of sight on the screen a crew reads at rest —
 * either inside a collapsed person panel, or inside one of the print-only
 * blocks that keep paper carrying every fact the screen tucks away.
 *
 * Both are the point rather than a loophole: decision 4 is a rule about **what
 * the screen shows before anybody has said anything**, and the printed manifest
 * is explicitly exempt from every hiding rule on this page.
 */
function hiddenAtRest(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.classList.contains("hidden")) return true;
    const parent = node.parentElement;
    if (parent instanceof HTMLDetailsElement && !parent.open && node.tagName !== "SUMMARY") {
      return true;
    }
  }
  return false;
}

/** Every element the screen paints in the app's danger hue at rest. */
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
    const details = row.querySelector("details");
    const exception = exceptionControl(row, "Mark not back aboard");
    // The claim that somebody did not come back exists on the row, and reaching
    // it costs a tap on the person's own name first: it is inside the
    // disclosure, and the disclosure is closed.
    expect(exception).toBeDefined();
    expect(details?.open).toBe(false);
    expect(details?.contains(exception ?? null)).toBe(true);
    expect(hiddenAtRest(exception as HTMLElement)).toBe(true);
    // …and it is not the summary, which is what a tap on the row lands on.
    expect(row.querySelector("summary")?.contains(exception ?? null)).toBe(false);
  });

  it("keeps the dock's wording behind the same two steps", () => {
    renderList({ divers: [diver()], checkpoint: "departure" });
    const row = screen.getByRole("listitem");
    const exception = exceptionControl(row, "Mark not boarded");
    expect(exception).toBeDefined();
    expect(hiddenAtRest(exception as HTMLElement)).toBe(true);
  });

  it("offers it once the person's own panel is open", () => {
    renderList({ divers: [diver()] });
    const row = screen.getByRole("listitem");
    // The disclosure is the tap on the person — the same one that reveals
    // their contact, medical and notes.
    const details = row.querySelector("details");
    details?.setAttribute("open", "");
    expect(hiddenAtRest(exceptionControl(row, "Mark not back aboard") as HTMLElement)).toBe(false);
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
    const backAboard = exceptionControl(row, "Mark back aboard");
    const retract = exceptionControl(row, "Not back aboard");
    expect(backAboard).toBeDefined();
    expect(retract).toBeDefined();
    expect(hiddenAtRest(backAboard as HTMLElement)).toBe(true);
    expect(hiddenAtRest(retract as HTMLElement)).toBe(true);
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
