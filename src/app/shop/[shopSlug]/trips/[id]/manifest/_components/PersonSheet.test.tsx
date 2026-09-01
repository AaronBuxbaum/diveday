// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type {
  RollCallCheckpoint,
  RollCallRecord,
  RollCallTrailEntry,
  TripManifest,
} from "@/lib/manifests";
import { PersonSheet } from "./PersonSheet";
import { rollCallRowState } from "./RollCallControls";

/**
 * **The rules slice 5b owes ADR 20260827-the-departure-is-two-working-surfaces**,
 * pinned as behaviour rather than as pixels:
 *
 * - **decision 3, the "no call buttons" half** — nothing in a person's sheet can
 *   place a call. Not a `tel:` or `sms:` href, not a dial control. The
 *   emergency contact is reference text and only reference text, because an
 *   accidental call on a path used less than once a year is strictly worse than
 *   a slow one.
 * - **decision 2** — the sheet is the "one tap away" tier and carries today's
 *   audit trail, so a crew member can read where this person has been counted
 *   without leaving the rail.
 * - **decision 4** — an alarm is earned by a recorded fact. A teammate nobody
 *   has called yet is quiet; only a recorded not-back wears the danger tone.
 *
 * Deliberately not a screenshot: a pixel snapshot fails on every legitimate
 * restyle and teaches the next reader to re-baseline without reading, which on
 * a safety surface is the worst habit a test can teach.
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
    emergencyContactPhone: "+1-305-555-0241",
    readiness: { status: "ready", blockers: [] },
    rentalFit: { state: "own_kit" },
    nitroxRequested: false,
    checkedIn: false,
    buddyTeam: null,
    buddyAlert: null,
    buddyStates: [],
    trail: [],
    ...overrides,
  } as TripManifest["divers"][number];
}

function record(overrides: Partial<RollCallRecord> = {}): RollCallRecord {
  return {
    state: "boarded",
    occurredAt: new Date("2026-09-11T10:51:00.000Z"),
    recordedByName: "Dana Reyes",
    ...overrides,
  } as RollCallRecord;
}

function renderSheet({
  subject = diver(),
  checkpoint = "after_dive_1",
  notes = [],
}: {
  subject?: TripManifest["divers"][number];
  checkpoint?: RollCallCheckpoint;
  notes?: Parameters<typeof PersonSheet>[0]["notes"];
} = {}) {
  const isDeparture = checkpoint === "departure";
  return render(
    <PersonSheet
      diver={subject}
      checkpoint={checkpoint}
      isDeparture={isDeparture}
      rowState={rollCallRowState(checkpoint, subject.rollCall)}
      ready={subject.readiness.status === "ready"}
      shopSlug="blue-mantis"
      tripId="00000000-0000-4000-8000-0000000000ff"
      locale="en-US"
      timezone="America/New_York"
      rosterNames={["Meera Iyer", "Chinwe Obi"]}
      sharedAdvisoryTexts={new Set()}
      notes={notes}
      capsuleKind={null}
      rollCallAction={vi.fn(async () => ({ ok: true }) as const)}
      addPrivateNoteAction={vi.fn(async () => undefined) as never}
      rollCallButtonCopy={{ errorRefusal: "Try again", blockedMessage: "Still blocked" }}
      t={t}
    />,
  );
}

describe("there are no call buttons on the boat (decision 3)", () => {
  it("renders the emergency contact as text, with no link that could dial it", () => {
    const { container } = renderSheet();

    // The number is present — burying it is not the rule, dialling it is.
    expect(screen.getByText(/\+1-305-555-0241/)).toBeTruthy();

    const dialable = [...container.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(
      (anchor) => /^(tel|sms|callto|facetime):/i.test(anchor.getAttribute("href") ?? ""),
    );
    expect(dialable).toEqual([]);
  });

  it("offers no control whose action is placing a call", () => {
    const { container } = renderSheet({
      subject: diver({
        rollCall: record({ state: "not_boarded" }),
        trail: [{ checkpoint: "departure", record: record() }],
      }),
    });

    // Every interactive element in the sheet, by its accessible words. None of
    // them may be a dial affordance — the emergency path here is reference to
    // read aloud, never a control to press.
    const controls = [
      ...container.querySelectorAll<HTMLElement>("button, a[href], [role='button']"),
    ];
    for (const control of controls) {
      expect(control.textContent ?? "").not.toMatch(/\bcall\b|\bdial\b|\bphone\b/i);
    }
  });
});

describe("the sheet carries today's trail (decision 2)", () => {
  it("lists each recorded result with the checkpoint, the time and who said it", () => {
    renderSheet({
      subject: diver({
        rollCall: record({
          state: "not_boarded",
          occurredAt: new Date("2026-09-11T12:29:00.000Z"),
          recordedByName: "Keiko Tanaka",
        }),
        trail: [
          { checkpoint: "departure", record: record() },
          {
            checkpoint: "after_dive_1",
            record: record({
              state: "not_boarded",
              occurredAt: new Date("2026-09-11T12:29:00.000Z"),
              recordedByName: "Keiko Tanaka",
            }),
          },
        ] satisfies RollCallTrailEntry[],
      }),
    });

    const today = screen.getByRole("list", { name: t("manifest.personSheet.todayHeading") });
    const entries = within(today).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.textContent).toContain("Before departure");
    expect(entries[0]?.textContent).toContain("Dana Reyes");
    expect(entries[1]?.textContent).toContain("After dive 1");
    expect(entries[1]?.textContent).toContain("Keiko Tanaka");
  });

  it("says nothing at all when nobody has recorded anything", () => {
    renderSheet({ checkpoint: "departure" });
    expect(screen.queryByRole("list", { name: t("manifest.personSheet.todayHeading") })).toBeNull();
  });

  it("keeps a carried-forward result out of the trail", () => {
    // Carrying forward is the rule speaking, not a person: it has no time and
    // no recorder, so it is the row's word ("Ashore since the dock") and never
    // a line in a list of what somebody said. The db assembly is what filters
    // it; this pins the sheet's half of the contract — an empty trail after a
    // dive renders no section rather than an empty one.
    renderSheet({
      subject: diver({ rollCall: record({ state: "not_boarded", implied: true }), trail: [] }),
    });
    expect(screen.queryByRole("list", { name: t("manifest.personSheet.todayHeading") })).toBeNull();
  });
});

describe("buddy states name the person and their own word (decision 2)", () => {
  it("lists each teammate with the state their own row wears", () => {
    renderSheet({
      subject: diver({
        buddyStates: [
          { kind: "diver", bookingId: "b-2", fullName: "Chinwe Obi", label: "boarded" },
          { kind: "crew", personId: "p-1", fullName: "Georg Fischer", label: "not_boarded" },
        ],
      }),
    });

    const team = screen.getByRole("list", { name: t("manifest.personSheet.buddyHeading") });
    const members = within(team).getAllByRole("listitem");
    expect(members.map((member) => member.textContent)).toEqual([
      "Chinwe ObiBoarded",
      "Georg FischerNot boarded",
    ]);
  });

  it("stays calm about a teammate nobody has called yet (decision 4)", () => {
    const { container } = renderSheet({
      subject: diver({
        buddyStates: [
          { kind: "diver", bookingId: "b-2", fullName: "Chinwe Obi", label: "awaiting" },
        ],
      }),
    });

    const team = screen.getByRole("list", { name: t("manifest.personSheet.buddyHeading") });
    expect(team.textContent).toContain("Chinwe Obi");
    // Nothing in the team section may paint the app's danger hue while the only
    // fact is that nobody has spoken.
    expect(
      [...container.querySelectorAll<HTMLElement>("[class]")].filter(
        (element) =>
          /(^|[\s:/])(text|bg|border|ring)-danger(\b|-)/.test(element.className) &&
          team.contains(element),
      ),
    ).toEqual([]);
  });

  it("names a teammate a human recorded as not back aboard", () => {
    renderSheet({
      subject: diver({
        buddyAlert: "separated_after_dive",
        buddyStates: [
          { kind: "diver", bookingId: "b-2", fullName: "Chinwe Obi", label: "not_back_aboard" },
        ],
      }),
    });

    const team = screen.getByRole("list", { name: t("manifest.personSheet.buddyHeading") });
    expect(team.textContent).toContain("Chinwe Obi");
    expect(team.textContent).toContain("Not back aboard");
  });

  it("renders no team section for a diver on no team", () => {
    renderSheet();
    expect(screen.queryByRole("list", { name: t("manifest.personSheet.buddyHeading") })).toBeNull();
  });
});
