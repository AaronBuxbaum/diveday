// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyMedicalAnswers, flaggedMedicalPrompts, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { RosterSection } from "./RosterSection";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

afterEach(cleanup);

/**
 * The rules slice 5d ships on (ADR
 * 20260827-the-departure-is-two-working-surfaces): the roster is **one
 * grouped ledger** whose group bands own the state word and the count, a
 * cleared seat is a name and a drawn mark with no per-row state word, open
 * work keeps its sentence and its fix in the open, and the filter chips are
 * gone because the groups are the filter. Pinned as rules, never pixels —
 * a restyle may move everything here except what these assert.
 */

const noop = () => {};

function entry(
  id: string,
  fullName: string,
  over: {
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    dateOfBirth?: string;
    reEntryAsk?: "deck_word" | "easy_first_dive" | "refresher_course";
  } = {},
): RosterEntry {
  return {
    booking: {
      id,
      status: "booked",
      diveIntent: null,
      reEntryAsk: over.reEntryAsk ?? null,
      lastDivedBand: null,
      hotelPickupLocation: null,
      pickupTime: null,
    } as unknown as RosterEntry["booking"],
    person: {
      id: `p-${id}`,
      fullName,
      email: `${id}@example.com`,
      dateOfBirth: over.dateOfBirth ?? null,
      emergencyContactName: over.emergencyContactName ?? "Ada Contact",
      emergencyContactPhone: over.emergencyContactPhone ?? "+1 555 0100",
    } as unknown as RosterEntry["person"],
  };
}

const signedWaiver = {
  waiver: {
    id: "w-1",
    status: "completed",
    completedAt: new Date("2026-08-20T15:00:00Z"),
    signatureMethod: "digital",
    expiresAt: new Date("2027-08-20T15:00:00Z"),
    medicalAnswers: null,
  },
} as unknown as WaiverByBooking extends Map<string, infer V> ? V : never;

function readinessRow(status: "ready" | "blocked", blockers: unknown[] = []) {
  return {
    readiness: { status, blockers },
    paymentStatus: "paid",
    paymentProvider: null,
    depthAdvisory: null,
  } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;
}

function renderRoster({
  roster,
  readiness,
  waivers,
  rentalFit,
  compact = false,
  addDiverGroup,
}: {
  roster: RosterEntry[];
  readiness: ReadinessByBooking;
  waivers: WaiverByBooking;
  rentalFit?: RentalFitByBooking;
  compact?: boolean;
  addDiverGroup?: ReactNode;
}) {
  return render(
    <RosterSection
      shopSlug="blue-mantis"
      shopTimezone="America/New_York"
      locale="en-US"
      tripId="trip-1"
      booked={roster.length}
      capacity={12}
      roster={roster}
      readinessByBooking={readiness}
      waiverByBooking={waivers}
      rentalFitByBooking={rentalFit ?? (new Map() as RentalFitByBooking)}
      nitroxByBooking={new Map() as NitroxByBooking}
      requiresPayment={false}
      paymentsConnected={false}
      cancellationDeadline={null}
      markWaiverInPersonAction={noop}
      markPaymentAction={noop}
      mayWriteOffPayment={false}
      removeBookingAction={noop}
      confirmIdentityAction={noop}
      notesByBooking={new Map()}
      addNoteAction={noop}
      deleteNoteAction={noop}
      saveEmergencyContactAction={noop}
      depthUnit="meters"
      tripDate="2026-08-28"
      compact={compact}
      addDiverGroup={addDiverGroup}
    />,
  );
}

const blocked = entry("a", "Asha Osei");
const ready = entry("b", "Rene Marsh");
const fixtures = {
  roster: [blocked, ready],
  readiness: new Map([
    ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
    ["b", readinessRow("ready")],
  ]) as ReadinessByBooking,
  waivers: new Map([
    ["a", signedWaiver],
    ["b", signedWaiver],
  ]) as WaiverByBooking,
};

describe("the guests ledger (slice 5d)", () => {
  it("files every seat under a group band that owns the state word and the count", () => {
    renderRoster(fixtures);

    // The band is a real heading, once per group — the word plus the tally.
    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ready · 1" })).toBeVisible();
  });

  it("never repeats the group's state word down its rows: a cleared seat is a name and a drawn mark", () => {
    const { container } = renderRoster(fixtures);

    // "Ready" appears exactly once on the surface — the group band. The old
    // roster printed it (with a 🌊) beside all seven cleared rows, which is
    // the repetition principle 9 forbids and this ledger removes.
    const readyWords = screen.getAllByText(/^Ready/);
    expect(readyWords).toHaveLength(1);

    // The cleared seat's mark is drawn SVG (decision 5) — no emoji anywhere
    // on the ledger, in any state.
    const row = container.querySelector(`#booking-${ready.booking.id}`);
    expect(row).not.toBeNull();
    expect(row?.querySelector("summary svg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/[\u{1F30A}\u{1F382}\u{2705}\u{26A0}\u{274C}]/u);
  });

  it("keeps a blocked seat's sentence and its fix in the open, ahead of the cleared rows", () => {
    renderRoster(fixtures);

    // The blocker sentence renders without any tap...
    expect(screen.getByText("No certification is on file for this trip.")).toBeVisible();
    // ...with its one fix beside it, pointing at the record that clears it.
    expect(screen.getByRole("link", { name: /Review certifications/ })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/divers/${blocked.person.id}#cards`,
    );

    // And the groups order the page's answer: open work above cleared seats.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf("Still to clear · 1")).toBeLessThan(headings.indexOf("Ready · 1"));
  });

  it("keeps critical names readable and shared blockers on their group band", () => {
    const secondBlocked = entry("c", "Mina Patel");
    const thirdBlocked = entry("d", "Owen Reed");
    const roster = [blocked, secondBlocked, thirdBlocked];
    const readiness = new Map([
      ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ["c", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ["d", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
    ]) as ReadinessByBooking;
    const { container } = renderRoster({
      roster,
      readiness,
      waivers: new Map([
        ["a", signedWaiver],
        ["c", signedWaiver],
        ["d", signedWaiver],
      ]) as WaiverByBooking,
      compact: true,
    });

    expect(screen.getByRole("link", { name: "Asha Osei" })).toHaveClass(
      "text-base",
      "font-semibold",
    );
    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).not.toBeNull();
    expect(within(band as HTMLElement).getByText(/3 divers: No certification/)).toBeVisible();
    expect(container.querySelector("#roster > div.mt-5")).toBeNull();
  });

  it("keeps a diver's re-entry ask in the open, and off the cleared group", () => {
    // The ask is the one line on this row the diver wrote, and a request the
    // crew has not answered is still to clear — the same rule the free-text
    // preference note carried before D12 replaced it (ADR
    // 20260904-reef-all-the-way-down, D18). It reads as a fact beside a name:
    // no warning colour, no mark that means careful.
    renderRoster({
      roster: [entry("c", "Yara Halabi", { reEntryAsk: "deck_word" })],
      readiness: new Map([["c", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["c", signedWaiver]]) as WaiverByBooking,
    });

    const note = screen.getByText("Asked for a word with the divemaster.");
    expect(note).toBeVisible();
    expect(note.className).not.toMatch(/text-(danger|warning)/);
    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /^Ready ·/ })).toBeNull();
  });

  it("offers no filter chips: the groups are the filter", () => {
    renderRoster(fixtures);

    expect(screen.queryByRole("navigation", { name: /filter/i })).toBeNull();
  });

  it("makes add diver the terminal ledger group, including on an empty roster", () => {
    const { container } = renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      addDiverGroup: <p data-testid="add-diver-form">Find a returning diver</p>,
    });

    const addDiver = container.querySelector("#add-diver");
    expect(addDiver).not.toBeNull();
    expect(
      within(addDiver as HTMLElement).getByRole("heading", { name: "Add a diver" }),
    ).toBeVisible();
    expect(within(addDiver as HTMLElement).getByTestId("add-diver-form")).toBeVisible();
    expect(screen.queryByText("No one on this boat yet")).toBeNull();
  });
});

/**
 * H-13's flag gates **disclosure** as well as boarding (security review
 * 2026-09-11). A seat attached to an existing person on a guess — a reused
 * email under a different name, or a name tapped off the counter's trigram
 * prompt (issue #1556) — used to render that person's whole record under a
 * name nobody had verified. The row still says what the *seat* is; the
 * *person's* particulars wait for the confirmation.
 */
describe("an unconfirmed identity withholds the matched person's record", () => {
  const flaggedAnswers = (() => {
    const answers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    answers.responses.q3 = true;
    return answers;
  })();
  const flaggedPrompt = flaggedMedicalPrompts(flaggedAnswers)[0] as string;

  const heldWaiver = {
    waiver: {
      id: "w-hold",
      status: "medical_review",
      completedAt: null,
      medicalClearedAt: null,
      medicalClearanceDeclinedAt: null,
      signatureMethod: "digital",
      expiresAt: new Date("2027-08-20T15:00:00Z"),
      medicalAnswers: flaggedAnswers,
    },
  } as unknown as WaiverByBooking extends Map<string, infer V> ? V : never;

  const matched = entry("u", "Marisol Vega", {
    dateOfBirth: "2012-05-04",
    emergencyContactName: "Pilar Vega",
    emergencyContactPhone: "+34 600 111 222",
  });
  const rentalFit = new Map([
    [
      "u",
      {
        rentsWetsuit: true,
        wetsuitSize: "5 mm / M",
        bootSize: "42",
        rentsBcd: false,
        rentsRegulator: false,
        rentsMaskFins: false,
        rentsWeights: false,
        rentsDiveComputer: false,
        rentsGopro: false,
        rentsDrysuit: false,
        rentsHoodGloves: false,
        rentsTorch: false,
        rentsSmb: false,
        bcdSize: null,
        finSize: null,
        weightPreference: null,
        needsStaffFitAt: null,
        needsStaffFitNote: null,
      },
    ],
  ]) as unknown as RentalFitByBooking;

  const unconfirmed = new Map([
    ["u", readinessRow("blocked", [{ code: "identity_unconfirmed", params: undefined }])],
  ]) as ReadinessByBooking;
  const confirmed = new Map([
    ["u", readinessRow("blocked", [{ code: "medical_review", params: undefined }])],
  ]) as ReadinessByBooking;

  it("prints none of the matched person's medical answers, age, contact or sizes", () => {
    renderRoster({
      roster: [matched],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.queryByText(flaggedPrompt)).toBeNull();
    expect(screen.queryByText(/Age 14/)).toBeNull();
    expect(screen.queryByText(/Minor/)).toBeNull();
    expect(screen.queryByText(/Pilar Vega/)).toBeNull();
    expect(screen.queryByDisplayValue("Pilar Vega")).toBeNull();
    expect(screen.queryByText(/5 mm \/ M/)).toBeNull();
    expect(screen.queryByText("u@example.com")).toBeNull();
    // Said, never silently blank — an empty panel reads as a diver with no
    // contact and no sizes, which is a wrong fact rather than an absent one.
    expect(
      screen.getByText(
        "Contact, medical and gear details stay hidden until you confirm who this is.",
      ),
      // `toBeInTheDocument`, not `toBeVisible`: the reference panel is a
      // collapsed `<details>`, which jsdom reports as hidden.
    ).toBeInTheDocument();
  });

  it("still says what the seat is, and offers the one control that clears it", () => {
    // Withholding the person is not withholding the seat: a row nobody can
    // board has to say so, and the way through stays on the row.
    renderRoster({
      roster: [matched],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.getByText(/Identity unconfirmed/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Marisol Vega" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm this is Marisol Vega" })).toBeVisible();
  });

  it("renders the same facts as soon as the row is confirmed", () => {
    renderRoster({
      roster: [matched],
      readiness: confirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.getByText(flaggedPrompt)).toBeVisible();
    expect(screen.getByText("Minor · age 14")).toBeVisible();
    // The last three live in the row's collapsed reference panel, which jsdom
    // reports as hidden — being in the document is the whole claim.
    expect(screen.getByText(/Age 14/)).toBeInTheDocument();
    expect(screen.getByText(/Pilar Vega/)).toBeInTheDocument();
    expect(screen.getByText(/5 mm \/ M/)).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Contact, medical and gear details stay hidden until you confirm who this is.",
      ),
    ).toBeNull();
  });
});

/**
 * A drysuit is the one rental that changes how a diver ascends, and DiveDay
 * already records who holds the specialty — so the roster says when the suit
 * and the card have come apart (`dive-domain-expert` review, 2026-09-12).
 * Never a gate: the sentence is warning tone beside the depth advisory, and
 * `src/lib/drysuit-card.test.ts` pins that readiness cannot see it.
 */
describe("a drysuit going out with no drysuit card", () => {
  const diver = entry("d", "Ines Kowalski");
  const drysuitFit = (rentsDrysuit: boolean) =>
    new Map([
      [
        "d",
        {
          rentsDrysuit,
          drysuitSize: rentsDrysuit ? "ML" : null,
          rentsBcd: false,
          rentsRegulator: false,
          rentsWetsuit: false,
          rentsMaskFins: false,
          rentsWeights: false,
          rentsDiveComputer: false,
          rentsGopro: false,
          rentsHoodGloves: false,
          rentsTorch: false,
          rentsSmb: false,
          bcdSize: null,
          wetsuitSize: null,
          bootSize: null,
          finSize: null,
          weightPreference: null,
          needsStaffFitAt: null,
          needsStaffFitNote: null,
        },
      ],
    ]) as unknown as RentalFitByBooking;

  const withCards = (cards: unknown[]) =>
    new Map([
      [
        "d",
        {
          ...readinessRow("ready"),
          specialtyCertifications: cards,
        } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never,
      ],
    ]) as ReadinessByBooking;

  const waivers = new Map([["d", signedWaiver]]) as WaiverByBooking;

  it("names the gap, and says in the sentence that nothing is blocked", () => {
    renderRoster({
      roster: [diver],
      readiness: withCards([]),
      waivers,
      rentalFit: drysuitFit(true),
    });

    expect(
      screen.getByText(
        "Renting a drysuit with no drysuit certification on file. This is not a block: check what they hold, or plan an orientation before the first dive.",
      ),
    ).toBeInTheDocument();
    // The advisory is not a blocker, so the seat is still cleared.
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("says nothing when the diver holds the card", () => {
    renderRoster({
      roster: [diver],
      readiness: withCards([
        { specialty: "drysuit", status: "verified", importedAt: null, reviewedAt: null },
      ]),
      waivers,
      rentalFit: drysuitFit(true),
    });

    expect(screen.queryByText(/drysuit certification/)).toBeNull();
  });

  it("says nothing about a diver who is not renting one", () => {
    renderRoster({
      roster: [diver],
      readiness: withCards([]),
      waivers,
      rentalFit: drysuitFit(false),
    });

    expect(screen.queryByText(/drysuit certification/)).toBeNull();
  });
});
