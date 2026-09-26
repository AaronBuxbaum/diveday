// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { emptyMedicalAnswers, flaggedMedicalPrompts, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { PAPER_WAIVER_IDLE } from "@/lib/paper-waiver-form";
import { rendersFlush } from "@/test/button-flush";
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
/** The paper-waiver door is a `useActionState` reducer (issue #1674). */
const noRefusal = async () => PAPER_WAIVER_IDLE;

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
  paymentsConnected = false,
}: {
  roster: RosterEntry[];
  readiness: ReadinessByBooking;
  waivers: WaiverByBooking;
  rentalFit?: RentalFitByBooking;
  compact?: boolean;
  addDiverGroup?: ReactNode;
  paymentsConnected?: boolean;
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
      paymentsConnected={paymentsConnected}
      cancellationDeadline={null}
      markWaiverInPersonAction={noRefusal}
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

  /**
   * The add-diver group sits between its band and the card's bottom edge at
   * one inset (pixel-craft class 5, K-164). Its wrapper was `pt-3 pb-5`, and
   * the search row's own `mt-4` made the top 28px against 20px below on every
   * trip capture; `AddDiverSection` now brings no margin, so the wrapper owns
   * both sides.
   */
  it("insets the add-diver group equally under its band and above the card's edge", () => {
    renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      addDiverGroup: <p data-testid="add-diver-form">Find a returning diver</p>,
    });

    const wrapper = screen.getByTestId("add-diver-form").parentElement;
    expect(wrapper).toHaveClass("py-5");
    expect(wrapper?.className).not.toMatch(/(^|\s)(pt|pb)-/);
  });

  /**
   * A cleared seat with no notes and no arrival has nothing to put at the end
   * of its name line, and the pixel probe found the trailing slot rendered
   * anyway: an empty `div` that still took the line's 12px gap on every such
   * row of ten trip captures, and on a phone wrapped to a line of its own
   * whose 4px row gap put the name 2px above the row's centre.
   */
  it("leaves no empty slot at the end of a name line with nothing to show", () => {
    const { container } = renderRoster(fixtures);

    const clearedLine = container.querySelector(`#booking-${ready.booking.id} > div`);
    expect(clearedLine).not.toBeNull();
    expect(clearedLine?.querySelectorAll(":scope > :empty")).toHaveLength(0);
    expect(clearedLine?.children).toHaveLength(1);

    // A seat with a state word still gets the slot, pushed to the line's end.
    const blockedLine = container.querySelector(`#booking-${blocked.booking.id} > div`);
    expect(blockedLine?.children).toHaveLength(2);
    expect(blockedLine?.lastElementChild).toHaveClass("ms-auto");
    expect(blockedLine?.lastElementChild).toHaveTextContent("Blocked");
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

/**
 * **A missing emergency contact's line hovers** (K-501). The whole line is the
 * disclosure that opens the form, and it declared `hover:bg-warning-tint` on a
 * `bg-warning-tint` rest: the state atlas measured `#fdefdf` both ways, 0px
 * changed, so the pointer never said the line would open.
 */
describe("the missing emergency contact line", () => {
  it("hovers a step past its resting fill", () => {
    const { container } = renderRoster({
      ...fixtures,
      roster: [entry("e", "Noor Haddad", { emergencyContactName: "", emergencyContactPhone: "" })],
      readiness: new Map([["e", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["e", signedWaiver]]) as WaiverByBooking,
    });

    const summary = container.querySelector('[class~="group/missing-contact"] > summary');
    expect(summary).not.toBeNull();
    const tokens = [...(summary?.classList ?? [])];
    const rest = tokens.filter((token) => token.startsWith("bg-"));
    const hover = tokens.filter((token) => token.startsWith("hover:bg-"));
    expect(rest).toEqual(["bg-warning-tint"]);
    expect(hover).toHaveLength(1);
    expect(hover[0]).not.toBe("hover:bg-warning-tint");
    expect(hover[0]).not.toMatch(/^hover:bg-warning-tint\//);
  });
});

/**
 * The seat's foot row put its controls on the panel's text column with a hand
 * `-mx-3`, which left whichever came first 4px from the card's
 * `overflow-hidden` on a phone, so both drew an inset ring
 * (`trip-guests-identity-open` at 390). Now the first control is `flush`: a
 * link's box is its label, a ghost's box reaches 8px past it, and either way
 * the app's own ring fits inside the clip (K-06). jsdom has no layout, so
 * this asks which control is flush; `button.test.ts` refuses the row bleed.
 */
describe("the seat's foot row sits on the text column through flush", () => {
  it("flushes Create order, the first control, and leaves Remove booking its padding", () => {
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: true });

    const remove = screen.getByRole("button", { name: "Remove booking" });
    const order = screen.getByRole("link", { name: "Create order" });
    expect(rendersFlush(order, "link", "sm")).toBe(true);
    expect(rendersFlush(remove, "danger-ghost", "sm")).toBe(false);
    for (const control of [order, remove]) {
      expect(control).not.toHaveClass("focus-visible:focus-ring-inset");
    }
  });

  it("flushes Remove booking when it is the only control on the row", () => {
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: false });

    const remove = screen.getByRole("button", { name: "Remove booking" });
    expect(screen.queryByRole("link", { name: "Create order" })).toBeNull();
    expect(rendersFlush(remove, "danger-ghost", "sm")).toBe(true);
    expect(remove).not.toHaveClass("focus-visible:focus-ring-inset");
  });
});

/**
 * Pixel-craft geometry the audit measured on the roster
 * (docs/design/pixel-craft.md). jsdom has no layout, so each case pins the
 * class arithmetic that puts the pixels where they belong; the pixel probe
 * re-measures the rendered rows.
 */
describe("the roster's row geometry", () => {
  /**
   * K-157: the mark was pinned at `top-2.5`, the row's top padding when the
   * `li` was `py-2.5`. The `li` went to `py-1` and the 44px name line moved up
   * 6px; the mark stayed, 6px under the name and the "Blocked" pill on every
   * row. The mark's top is the `li`'s own padding, so the two 44px boxes share
   * one band.
   */
  it("pins each row's mark to the name line's band, at the row's own top padding", () => {
    const { container } = renderRoster(fixtures);

    for (const seat of fixtures.roster) {
      const row = container.querySelector(`#booking-${seat.booking.id}`);
      expect(row).toHaveClass("py-1");
      const mark = row?.querySelector("summary[aria-label]");
      expect(mark).toHaveClass("absolute", "top-1", "size-11");
      expect(mark).not.toHaveClass("top-2.5");
    }
  });

  /** A row that opens on a mark, then its words: the mark stands on the words' first line. */
  function expectMarkOnFirstLine(row: Element | null) {
    expect(row).toHaveClass("flex", "items-baseline");
    const column = row?.firstElementChild;
    expect(column).toHaveClass("shrink-0");
    expect(column?.firstElementChild).toHaveClass("h-lh", "items-center");
    expect(column?.querySelector("svg")).not.toBeNull();
  }

  /**
   * K-494: a bare 16px mark in a stretched `flex gap-2` row stood at the top
   * of the words' 20px line, 2.5–3px above its centre, on every blocker and
   * warning line. Each mark is now the row's `StatusMarkColumn`, a block one
   * line of the row's text tall with the mark centred in it.
   */
  it("stands each blocker's and warning's mark on the first line of its words", () => {
    const rusty = entry("r", "Olga Rust");
    renderRoster({
      roster: [
        blocked,
        { ...rusty, booking: { ...rusty.booking, lastDivedBand: "over_five_years" } },
      ] as RosterEntry[],
      readiness: new Map([
        ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
        ["r", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["a", signedWaiver],
        ["r", signedWaiver],
      ]) as WaiverByBooking,
    });

    const blocker = screen.getByText("No certification is on file for this trip.");
    expectMarkOnFirstLine(blocker.closest("li"));
    const warning = screen.getByText(/^Last dived/);
    expectMarkOnFirstLine(warning.closest("p"));
  });

  /**
   * K-181: the band aligns its title on the first baseline of the facts
   * beside it. Each fact line was `items-start` with a bare mark first, so
   * its baseline was the mark's foot and "STILL TO CLEAR · 3" sat 5px under
   * the sentence. The line is `items-baseline` now, its mark a column with a
   * line of its own, so the fact's words set the baseline the title meets.
   */
  it("lines the band's title up with its first fact's words, not the fact's mark", () => {
    const roster = [blocked, entry("c", "Mina Patel"), entry("d", "Owen Reed")];
    const blocker = [{ code: "certification_missing", params: undefined }];
    renderRoster({
      roster,
      readiness: new Map(
        roster.map((seat) => [seat.booking.id, readinessRow("blocked", blocker)]),
      ) as ReadinessByBooking,
      waivers: new Map(roster.map((seat) => [seat.booking.id, signedWaiver])) as WaiverByBooking,
    });

    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).toHaveClass("items-baseline");
    const fact = within(band as HTMLElement).getByText(/3 divers: No certification/);
    expectMarkOnFirstLine(fact.closest("p"));
    expect(fact.closest("p")).not.toHaveClass("items-start");
  });

  /**
   * K-267: the facts' column right-aligned each line (`sm:items-end`), so
   * the red marks in front of them stepped left line by line (x 888, 827,
   * 741 on minimum-seats). The column stays at the band's end, placed there
   * by the band's `justify-between`; its lines start on one edge.
   */
  it("starts every shared fact on one edge, so their marks form a column", () => {
    const roster = [blocked, entry("c", "Mina Patel"), entry("d", "Owen Reed")];
    const blocker = [{ code: "certification_missing", params: undefined }];
    renderRoster({
      roster,
      readiness: new Map(
        roster.map((seat) => [seat.booking.id, readinessRow("blocked", blocker)]),
      ) as ReadinessByBooking,
      waivers: new Map(roster.map((seat) => [seat.booking.id, signedWaiver])) as WaiverByBooking,
    });

    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).toHaveClass("justify-between");
    const facts = within(band as HTMLElement)
      .getByText(/3 divers: No certification/)
      .closest("p")?.parentElement;
    expect(facts).toHaveClass("sm:items-start");
    expect(facts).not.toHaveClass("sm:items-end");
  });
});
