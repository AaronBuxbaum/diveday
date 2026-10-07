// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/button";
import type { SameNameHeldSeat } from "@/db/bookings";
import { emptyMedicalAnswers, flaggedMedicalPrompts, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { PAPER_WAIVER_IDLE } from "@/lib/paper-waiver-form";
import { rendersFlush } from "@/test/button-flush";
import { type RosterArrival, RosterSection } from "./RosterSection";
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
    identityBookedAs?: string;
    identityMatchedBy?: "shared_email" | "picked_name";
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
      identityBookedAs: over.identityBookedAs ?? null,
      identityMatchedBy: over.identityMatchedBy ?? null,
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

/** A blocked seat whose site also runs deeper than its card, which a boat can share. */
function deepRow() {
  return {
    ...readinessRow("blocked", [{ code: "certification_missing", params: undefined }]),
    depthAdvisory: {
      status: "exceeds",
      limitDepth: 18,
      siteDepth: 30,
      unit: "meters",
      basis: "certification",
      level: "open_water",
    },
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
  canManageOrders = true,
  requiresPayment = false,
  arrival,
  sameNameHeldSeats,
  splitAsksDateOfBirth,
}: {
  roster: RosterEntry[];
  readiness: ReadinessByBooking;
  waivers: WaiverByBooking;
  rentalFit?: RentalFitByBooking;
  compact?: boolean;
  addDiverGroup?: ReactNode;
  paymentsConnected?: boolean;
  canManageOrders?: boolean;
  requiresPayment?: boolean;
  arrival?: RosterArrival;
  sameNameHeldSeats?: ReadonlyMap<string, ReadonlyArray<SameNameHeldSeat>>;
  splitAsksDateOfBirth?: boolean;
}) {
  return render(
    <RosterSection
      trip={{
        shopSlug: "blue-mantis",
        shopTimezone: "America/New_York",
        locale: "en-US",
        tripId: "trip-1",
        booked: roster.length,
        capacity: 12,
        tripDate: "2026-08-28",
        requiresPayment,
        paymentsConnected,
        cancellationDeadline: null,
        mayWriteOffPayment: false,
        canManageOrders,
        splitAsksDateOfBirth,
        compact,
      }}
      rows={{
        roster,
        readinessByBooking: readiness,
        waiverByBooking: waivers,
        rentalFitByBooking: rentalFit ?? (new Map() as RentalFitByBooking),
        nitroxByBooking: new Map() as NitroxByBooking,
        notesByBooking: new Map(),
        sameNameHeldSeats,
      }}
      actions={{
        markWaiverInPersonAction: noRefusal,
        markPaymentAction: noop,
        removeBookingAction: noop,
        confirmIdentityAction: noop,
        splitIdentityAction: noop,
        addNoteAction: noop,
        deleteNoteAction: noop,
        saveEmergencyContactAction: noop,
      }}
      slots={{ addDiverGroup, arrival }}
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

  it("keeps a blocked seat's sentence in the open, ahead of the cleared rows", () => {
    const { container } = renderRoster(fixtures);

    // The blocker sentence renders without any tap, under the name...
    expect(screen.getByText("No certification is on file for this trip.")).toBeVisible();
    // ...and said once: the row's panel holds the fix, not the sentence again.
    expect(screen.getAllByText("No certification is on file for this trip.")).toHaveLength(1);
    expect(container.querySelector(`#booking-${blocked.booking.id} details`)).not.toHaveAttribute(
      "open",
    );
    // Its one fix waits behind the row, pointing at the record that clears it.
    expect(
      screen.getByRole("link", { name: /Review certifications/, hidden: true }),
    ).toHaveAttribute("href", `/shop/blue-mantis/divers/${blocked.person.id}#cards`);

    // And the groups order the page's answer: open work above cleared seats.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf("Still to clear · 1")).toBeLessThan(headings.indexOf("Ready · 1"));
  });

  /**
   * **A blocker is said on its own diver, however many share it** (Aaron,
   * 2026-10-05). "1 blocker shared with other divers, listed above" named
   * neither the problem nor the fix, and there is no batched action for a
   * blocker that a shared line could stand for.
   */
  it("keeps critical names readable and says a shared blocker on every row it stops", () => {
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
    expect(within(band as HTMLElement).queryByText(/3 divers:/)).toBeNull();
    expect(screen.getAllByText(/No certification/)).toHaveLength(3);
    expect(screen.queryByText(/shared with other divers/)).toBeNull();
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

  // The matched person's own blockers are facts about them, not the person at
  // the counter (dive-domain review 2026-10-05): a held row says only its
  // identity question and its payment.
  it("says none of the matched person's own blockers under a held seat", () => {
    renderRoster({
      roster: [matched],
      readiness: new Map([
        [
          "u",
          readinessRow("blocked", [
            { code: "identity_unconfirmed", params: undefined },
            { code: "medical_review", params: undefined },
            { code: "payment_due", params: undefined },
          ]),
        ],
      ]) as ReadinessByBooking,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });
    expect(
      screen.queryByText("A medical answer needs a doctor’s sign-off before this diver dives."),
    ).toBeNull();
    expect(screen.getAllByText("Payment is outstanding for this trip.").length).toBeGreaterThan(0);
    // The medical hold on the matched person's release is theirs: no status
    // block, no follow-up line, only that other holds may still apply.
    expect(screen.getAllByText("Other holds may still apply.").length).toBeGreaterThan(0);
  });

  it("withholds on the booking's own flag when readiness could not be read", () => {
    // Fails closed: the read raised no identity blocker, but the booking
    // still says it is held (security review 2026-10-06).
    const heldRow = entry("u", "Marisol Vega", {
      dateOfBirth: "2012-05-04",
      emergencyContactName: "Pilar Vega",
      emergencyContactPhone: "+34 600 111 222",
    });
    (heldRow.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
      "2026-10-01T12:00:00Z",
    );
    renderRoster({
      roster: [heldRow],
      readiness: new Map([
        ["u", readinessRow("blocked", [{ code: "readiness_unavailable", params: undefined }])],
      ]) as ReadinessByBooking,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });
    expect(screen.queryByText(/Pilar Vega/)).toBeNull();
    expect(screen.queryByText(flaggedPrompt)).toBeNull();
  });

  it("measures no depth advisory against the matched person, alone or shared with the boat", () => {
    // `junior_age` would say the matched person is a minor, and a ceiling or
    // `no_card` what card they hold (security re-review, issue #1690). Two
    // confirmed seats share the same sentence, so the held seat must neither
    // wear the capsule nor be counted into the shared line.
    const juniorDeep = {
      ...readinessRow("blocked", [{ code: "identity_unconfirmed", params: undefined }]),
      depthAdvisory: {
        status: "exceeds",
        limitDepth: 12,
        siteDepth: 30,
        unit: "meters",
        basis: "junior_age",
        level: "open_water",
      },
    } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;
    renderRoster({
      roster: [matched],
      readiness: new Map([["u", juniorDeep]]) as ReadinessByBooking,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
    });
    expect(screen.queryByText(/allowed at their age/)).toBeNull();
    expect(screen.queryByText("Depth advisory")).toBeNull();
  });

  it("leaves a held seat out of a shared depth advisory's count", () => {
    const seats = [entry("a", "Asha Osei"), entry("b", "Rene Marsh"), matched];
    const heldDeep = {
      ...deepRow(),
      readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
    } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;
    const { container } = renderRoster({
      roster: seats,
      readiness: new Map([
        ["a", deepRow()],
        ["b", deepRow()],
        ["u", heldDeep],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["a", signedWaiver],
        ["b", signedWaiver],
        ["u", heldWaiver],
      ]) as WaiverByBooking,
    });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b3 divers\b/);
  });

  it("prints none of the matched person's medical answers, age, emergency contact or sizes", () => {
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
    // Said, never silently blank — an empty panel reads as a diver with no
    // contact and no sizes, which is a wrong fact rather than an absent one.
    expect(
      screen.getByText("Medical and gear details stay hidden until you confirm who this is."),
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

    expect(screen.getByText(/Might be someone else/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Marisol Vega" })).toBeVisible();
    // Both answers stand in the open, outside the row's fold (Aaron,
    // 2026-10-05: the old row offered one answer, behind the mark).
    const same = screen.getByRole("button", { name: "Same person as Marisol Vega" });
    expect(same).toBeVisible();
    expect(same.closest("details")).toBeNull();
    expect(screen.getByText("Different person")).toBeVisible();
  });

  /**
   * **"Different person" asks who the new diver is** (issue #2081): a date of
   * birth or a "They're 18 or older" tick (H-100), the date itself on a course
   * with a minimum age, and an optional email or
   * phone. Every box but the name starts empty: nothing of the matched
   * record's is offered as the new diver's.
   */
  describe("the split form", () => {
    const heldSeat = () =>
      entry("u", "Marisol Vega", {
        identityBookedAs: "Lucia Vega",
        identityMatchedBy: "shared_email",
      });

    it("asks for a date of birth or an 18-or-older tick, and the date itself on a course with a minimum age", () => {
      const { unmount } = renderRoster({
        roster: [heldSeat()],
        readiness: unconfirmed,
        waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
        rentalFit,
      });
      const optionalDate = document.querySelector<HTMLInputElement>('input[name="dateOfBirth"]');
      expect(optionalDate).not.toBeNull();
      expect(optionalDate?.required).toBe(false);
      // H-100: the other answer, one tap for an adult; the writer refuses neither.
      const tick = document.querySelector<HTMLInputElement>('input[name="adultAttested"]');
      expect(tick?.type).toBe("checkbox");
      expect(tick?.checked).toBe(false);
      expect(screen.getByLabelText("They’re 18 or older")).toBe(tick);
      unmount();

      renderRoster({
        roster: [heldSeat()],
        readiness: unconfirmed,
        waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
        rentalFit,
        splitAsksDateOfBirth: true,
      });
      const requiredDate = document.querySelector<HTMLInputElement>('input[name="dateOfBirth"]');
      expect(requiredDate?.required).toBe(true);
      // A course measures a date, so no tick stands in for one there.
      expect(document.querySelector('input[name="adultAttested"]')).toBeNull();
      // A future date is refused by the browser before the round trip.
      expect(requiredDate?.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("offers an empty email and phone, never the matched record's", () => {
      renderRoster({
        roster: [heldSeat()],
        readiness: unconfirmed,
        waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
        rentalFit,
      });
      const form = document.querySelector<HTMLInputElement>('input[name="email"]')?.form;
      expect(form?.querySelector<HTMLInputElement>('input[name="email"]')?.value).toBe("");
      expect(form?.querySelector<HTMLInputElement>('input[name="phone"]')?.value).toBe("");
      expect(form?.querySelector<HTMLInputElement>('input[name="dateOfBirth"]')?.value).toBe("");
    });

    it("offers to move other held seats under that name only when there are some", () => {
      const { unmount } = renderRoster({
        roster: [heldSeat()],
        readiness: unconfirmed,
        waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
        rentalFit,
      });
      expect(document.querySelector('input[name="sameNameSeatIds"]')).toBeNull();
      unmount();

      const others: SameNameHeldSeat[] = [
        {
          bookingId: "s1",
          tripId: "t1",
          tripTitle: "Reef Morning",
          startsAt: new Date("2026-10-10T12:00:00Z"),
          asksDateOfBirth: false,
        },
        {
          bookingId: "s2",
          tripId: "t2",
          tripTitle: "Wreck Afternoon",
          startsAt: new Date("2026-10-11T18:00:00Z"),
          asksDateOfBirth: false,
        },
      ];
      renderRoster({
        roster: [heldSeat()],
        readiness: unconfirmed,
        waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
        rentalFit,
        sameNameHeldSeats: new Map([["u", others]]),
      });
      // Named by departure rather than counted, and unticked: two strangers
      // can share a name, and only the staffer can tell.
      const box = screen.getByRole<HTMLInputElement>("checkbox", {
        // `\s`: a date keeps its units whole with U+00A0 (`keepUnitsWhole`).
        // The time as well, so a same-day morning and afternoon run differ.
        name: /^Also move the held seats booked as Lucia Vega on Reef Morning \(Sat, Oct\s10, 8:00\sAM\sEDT\) and Wreck Afternoon \(Sun, Oct\s11, 2:00\sPM\sEDT\)$/,
        hidden: true,
      });
      expect(box).not.toBeChecked();
      expect(box.value).toBe("s1,s2");
      expect(document.querySelector<HTMLInputElement>('input[name="dateOfBirth"]')?.required).toBe(
        false,
      );
    });

    it("asks for a date of birth when a seat it would move is on an age-gated course", () => {
      renderRoster({
        roster: [heldSeat()],
        readiness: unconfirmed,
        waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
        rentalFit,
        sameNameHeldSeats: new Map([
          [
            "u",
            [
              {
                bookingId: "s1",
                tripId: "t1",
                tripTitle: "Junior Open Water",
                startsAt: new Date("2026-10-10T12:00:00Z"),
                asksDateOfBirth: true,
              },
            ],
          ],
        ]),
      });
      expect(document.querySelector<HTMLInputElement>('input[name="dateOfBirth"]')?.required).toBe(
        true,
      );
    });
  });

  it("names both people when it knows the name the seat was booked under", () => {
    renderRoster({
      roster: [
        entry("u", "Marisol Vega", {
          identityBookedAs: "Lucia Vega",
          identityMatchedBy: "shared_email",
        }),
      ],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(
      screen.getByText("Booked as Lucia Vega with Marisol Vega’s email. Confirm who this is."),
    ).toBeVisible();
    // "Different person" offers the booked-as name for the new record.
    expect(
      screen.getByRole("textbox", { name: "Name for their own record", hidden: true }),
    ).toHaveValue("Lucia Vega");
  });

  // Aaron, 2026-10-06: the question needs something to compare, and a way to
  // ask. The record's own email and phone stand beside it, tappable, outside
  // the fold; nothing else of the record's comes out.
  it("shows the record's email and phone beside the question, as links", () => {
    renderRoster({
      roster: [
        {
          ...matched,
          person: { ...matched.person, phone: "+13055550114" },
        } as RosterEntry,
      ],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    const contact = screen.getByTestId("identity-contact");
    expect(contact).toBeVisible();
    expect(contact.closest("details")).toBeNull();
    expect(contact).toHaveTextContent("On file for Marisol Vega:");
    expect(screen.getByRole("link", { name: "u@example.com" })).toHaveAttribute(
      "href",
      "mailto:u@example.com",
    );
    const phone = screen
      .getAllByRole("link")
      .find((link) => link.getAttribute("href")?.startsWith("tel:"));
    expect(phone).toHaveAttribute("href", "tel:+13055550114");
    expect(screen.queryByText(/Pilar Vega/)).toBeNull();
  });

  it("says so when the record has no email or phone to ask", () => {
    renderRoster({
      roster: [{ ...matched, person: { ...matched.person, email: null } } as RosterEntry],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.getByTestId("identity-contact")).toHaveTextContent(
      "No email or phone on file for Marisol Vega.",
    );
  });

  // While arrivals are open the screen faces the queue (dive-domain review
  // 2026-10-05), so the record's email and phone wait behind the row's mark.
  it("keeps the record's contact behind the fold while the desk is open", () => {
    renderRoster({
      roster: [matched],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
      arrival: { controls: new Map(), below: new Map(), boarded: new Set() },
    });

    expect(screen.getByTestId("identity-contact").closest("details")).not.toBeNull();
  });

  it("asks nothing of a confirmed seat", () => {
    renderRoster({
      roster: [matched],
      readiness: confirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.queryByTestId("identity-contact")).toBeNull();
  });

  // A medical hold is cleared by a doctor in writing, never by a word on the
  // boat (issue #2065): the sentence names who clears it.
  it("says a medical hold needs a doctor's sign-off", () => {
    renderRoster({
      roster: [matched],
      readiness: confirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(
      screen.getAllByText("A medical answer needs a doctor’s sign-off before this diver dives.")
        .length,
    ).toBeGreaterThan(0);
  });

  // The row's Blocked reason says a doctor must sign off (Aaron,
  // 2026-10-06: no separate alert panel); the answer itself waits in the fold
  // and on the signed record.
  it("keeps the flagged medical answer in the row's fold", () => {
    renderRoster({
      roster: [matched],
      readiness: confirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.getByText(flaggedPrompt).closest("details")).not.toBeNull();
  });

  it("keeps the identity sentence outside the row's fold", () => {
    renderRoster({
      roster: [matched],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.getByText(/Might be someone else/).closest("details")).toBeNull();
  });

  it("renders the same facts as soon as the row is confirmed", () => {
    renderRoster({
      roster: [matched],
      readiness: confirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.getByText(flaggedPrompt)).toBeInTheDocument();
    expect(screen.getByText("Minor · age 14")).toBeVisible();
    // The last three live in the row's collapsed reference panel, which jsdom
    // reports as hidden — being in the document is the whole claim.
    expect(screen.getByText(/Age 14/)).toBeInTheDocument();
    expect(screen.getByText(/Pilar Vega/)).toBeInTheDocument();
    expect(screen.getByText(/5 mm \/ M/)).toBeInTheDocument();
    expect(
      screen.queryByText("Medical and gear details stay hidden until you confirm who this is."),
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
describe("a diver in a drysuit with no drysuit card", () => {
  const diver = entry("d", "Ines Kowalski");
  const drysuitFit = (rentsDrysuit: boolean, divesDry = rentsDrysuit) =>
    new Map([
      [
        "d",
        {
          rentsDrysuit,
          divesDry,
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
        "In a drysuit with no drysuit certification on file. This is not a block: check what they hold, or plan an orientation before the first dive.",
      ),
    ).toBeInTheDocument();
    // The advisory is not a blocker, so the seat is still cleared.
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("names it for a diver in their own suit, who rents none from us (H-78)", () => {
    // Most drysuit divers own the suit. The advisory used to ask whether the
    // shop was renting one, which left silent exactly the divers it is about
    // (issue #1752).
    renderRoster({
      roster: [diver],
      readiness: withCards([]),
      waivers,
      rentalFit: drysuitFit(false, true),
    });

    expect(screen.getByText(/^In a drysuit with no drysuit certification on file/)).toBeVisible();
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

  it("says nothing about a diver who is not in one", () => {
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
 * **A missing emergency contact is said once, under the name** (owner,
 * 2026-10-05). The sentence is one of the row's reason lines; the form waits
 * behind the row under its own "Add emergency contact".
 */
describe("the missing emergency contact line", () => {
  it("states the gap under the name and keeps the form behind the row", () => {
    renderRoster({
      ...fixtures,
      roster: [entry("e", "Noor Haddad", { emergencyContactName: "", emergencyContactPhone: "" })],
      readiness: new Map([["e", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["e", signedWaiver]]) as WaiverByBooking,
    });

    expect(screen.getByText("Emergency contact · Not on file")).toBeVisible();
    expect(screen.getAllByText("Emergency contact · Not on file")).toHaveLength(1);
    expect(screen.getByText("Add emergency contact")).not.toBeVisible();
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

  it("withholds Create order from a reader who may not raise an invoice (issue #1925)", () => {
    // Payments connected, so the only thing hiding the link is the permission:
    // `orders/new` would bounce this reader to the Orders index.
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: true, canManageOrders: false });

    expect(screen.queryByRole("link", { name: "Create order" })).toBeNull();
    const remove = screen.getByRole("button", { name: "Remove booking" });
    expect(rendersFlush(remove, "danger-ghost", "sm")).toBe(true);
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
    expectMarkOnFirstLine(warning.closest("li"));
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
    renderRoster({
      roster,
      readiness: new Map(roster.map((seat) => [seat.booking.id, deepRow()])) as ReadinessByBooking,
      waivers: new Map(roster.map((seat) => [seat.booking.id, signedWaiver])) as WaiverByBooking,
    });

    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).toHaveClass("items-baseline");
    const fact = within(band as HTMLElement).getByText(/3 divers: Reaches 30/);
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
    renderRoster({
      roster,
      readiness: new Map(roster.map((seat) => [seat.booking.id, deepRow()])) as ReadinessByBooking,
      waivers: new Map(roster.map((seat) => [seat.booking.id, signedWaiver])) as WaiverByBooking,
    });

    const band = screen.getByRole("heading", { name: "Still to clear · 3" }).parentElement;
    expect(band).toHaveClass("justify-between");
    const facts = within(band as HTMLElement)
      .getByText(/3 divers: Reaches 30/)
      .closest("p")?.parentElement;
    expect(facts).toHaveClass("sm:items-start");
    expect(facts).not.toHaveClass("sm:items-end");
  });

  /**
   * K-278 and K-364, the name line's trailing capsules. From `sm` they sit at
   * the line's end, against the mark, and the verdict is the last of them, so
   * "Blocked" meets the chevron whether or not a "Depth advisory" chip rides
   * with it (it was first, and jumped 136px when the chip was there). On a
   * phone the capsules wrap under the name and start on its column, verdict
   * first, like the name's own wrap (they right-aligned to the mark's edge, 6px
   * off the name, on no shared edge).
   */
  it("ends the capsules on the verdict from sm, and starts a phone's wrapped capsules on the name's column", () => {
    const { container } = renderRoster(fixtures);

    const verdict = within(
      container.querySelector(`#booking-${blocked.booking.id}`) as HTMLElement,
    ).getByText("Blocked");
    expect(verdict).toHaveClass("sm:order-last");
    const capsules = verdict.parentElement;
    expect(capsules?.firstElementChild).toBe(verdict);
    expect(capsules).toHaveClass("ms-auto", "justify-end", "max-sm:ms-0", "max-sm:justify-start");
  });

  /**
   * K-174: the roster drew its waiver send as a hand-rolled pill (fully
   * round, 16px inset, no `pressable`, no disabled state) while the diver
   * record draws the same act as the app's `sm` button. Both are the one
   * button now; an expired link's send wears `danger`.
   */
  it("draws the waiver's send as the app's own sm button, as the diver record does", () => {
    const unsent = entry("n", "Nadia Petrov");
    const lapsed = entry("x", "Xavier Lind");
    const blocker = [{ code: "certification_missing", params: undefined }];
    renderRoster({
      roster: [unsent, lapsed],
      readiness: new Map([
        ["n", readinessRow("blocked", blocker)],
        ["x", readinessRow("blocked", blocker)],
      ]) as ReadinessByBooking,
      waivers: new Map([
        [
          "x",
          {
            waiver: {
              id: "w-x",
              status: "sent",
              completedAt: null,
              signatureMethod: null,
              expiresAt: new Date("2020-01-01T00:00:00Z"),
              medicalAnswers: null,
            },
          },
        ],
      ]) as unknown as WaiverByBooking,
    });

    const send = screen.getByRole("button", { name: "Send waiver" });
    const resend = screen.getByRole("button", { name: "Link expired" });
    expect(send.className).toBe(buttonClass({ variant: "secondary", size: "sm" }));
    expect(resend.className).toBe(buttonClass({ variant: "danger", size: "sm" }));
    for (const control of [send, resend]) expect(control).not.toHaveClass("rounded-full");
  });

  /**
   * K-352: the notes row is the last thing in a row with open work, and its
   * body had no padding of its own below the form, so the bordered "Add
   * private note" button ended 4px above the row's rule: the `li`'s `py-1`,
   * which was sized for the 44px summary's own air. The body keeps 8px, so
   * the button clears the rule by the form's own 12px step.
   */
  it("keeps the notes in their own band of the seat's panel, ruled off from the facts", () => {
    const { container } = renderRoster(fixtures);

    const row = container.querySelector(`#booking-${blocked.booking.id}`);
    const notes = within(row as HTMLElement)
      .getByText("Add a private note")
      .closest("details");
    expect(notes?.lastElementChild).toHaveClass("mt-2");
    expect(notes?.parentElement).toHaveClass("border-t", "border-border");
  });

  /**
   * K-551: "Review certifications →" is 14px of text in a 44px box, and the
   * next line's `mt-3` stacked on the box's unseen 12px below it: 45px from
   * the link's ink to the note row's, where the row's other steps are 24–26.
   * The link gives that unseen half back (`-mb-3`, with `align-bottom` so its
   * line's strut keeps none of it, as `buttonClass`'s `outdent` does), and the
   * target stays whole.
   */
  it("gives back the unseen lower half of the certification link's target", () => {
    renderRoster(fixtures);

    const link = screen.getByRole("link", { name: /Review certifications/ });
    expect(link).toHaveClass("min-h-11", "-mb-3", "align-bottom");
  });

  /**
   * K-354: every group band opens with a hairline except "ADD A DIVER". The
   * band draws `border-t … first:border-t-0`, and the add-diver band sat
   * first inside the `#add-diver` wrapper, so `first:` stripped its rule
   * though it is the card's last group. The group's rule is drawn by the
   * element that is the card's child: the band, or the box holding it.
   */
  it("opens the add-diver group with the same rule as every other group", () => {
    const { container } = renderRoster({
      ...fixtures,
      addDiverGroup: <p>Find a returning diver</p>,
    });

    const addDiver = container.querySelector("#add-diver");
    const ready = screen.getByRole("heading", { name: "Ready · 1" }).parentElement;
    // Siblings in the card, each drawing the rule between groups.
    expect(addDiver?.parentElement).toBe(ready?.parentElement);
    for (const group of [addDiver, ready]) {
      expect(group).toHaveClass("border-t", "first:border-t-0");
    }
    // The band inside the add-diver box draws none of its own.
    const band = within(addDiver as HTMLElement).getByRole("heading", {
      name: "Add a diver",
    }).parentElement;
    expect(band).not.toBe(addDiver);
    expect(band).not.toHaveClass("border-t");
  });
});

/**
 * **On the departure page the roster is spaced by the page** (K-262). It hung
 * `mt-5` there, one of five different steps between the page's sections; the
 * page's one `space-y-10` spaces it now. A roster outside that stack keeps its
 * own step.
 */
describe("the roster's place on the departure page", () => {
  it("carries no top margin of its own when compact", () => {
    const { container } = renderRoster({
      roster: [],
      readiness: new Map() as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      compact: true,
    });
    const roster = container.querySelector("#roster");
    expect(roster).not.toBeNull();
    expect(roster?.className).not.toMatch(/(^|\s)mt-/);
  });
});

/**
 * **Every seat is one line, and the line says why** (owner, 2026-10-05;
 * dive-domain review the same day). The fixes fold behind the row; the facts a
 * crew must read before boarding never do, and a row filed under "Still to
 * clear" always says what keeps it there.
 */
describe("the one-line row", () => {
  it("says each blocker under the name, outside the fold", () => {
    renderRoster({
      roster: [entry("g", "Gus Lin", { dateOfBirth: "2013-01-01" })],
      readiness: new Map([
        [
          "g",
          readinessRow("blocked", [
            { code: "guardian_signature_missing", params: undefined },
            { code: "certification_missing", params: undefined },
          ]),
        ],
      ]) as ReadinessByBooking,
      waivers: new Map([["g", signedWaiver]]) as WaiverByBooking,
    });

    const cert = screen.getByText("No certification is on file for this trip.");
    expect(cert).toBeVisible();
    expect(cert.closest("details")).toBeNull();
    const row = cert.closest('li[id^="booking-"]') as HTMLElement;
    const lines = within(row).getAllByRole("listitem");
    // The guardian sentence and the cert sentence, both in the open.
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.closest("details")).toBeNull();
  });

  it("names the unsent waiver and the unpaid seat when no blocker does", () => {
    renderRoster({
      roster: [entry("w", "Wen Ito")],
      readiness: new Map([
        ["w", { ...readinessRow("ready"), paymentStatus: "unpaid" }],
      ]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      requiresPayment: true,
    });

    expect(screen.getByRole("heading", { name: "Still to clear · 1" })).toBeVisible();
    expect(screen.getByText("Waiver not signed yet")).toBeVisible();
    expect(screen.getByText("Not paid yet")).toBeVisible();
  });

  it("states no waiver reason for a held seat: that waiver is the matched diver's", () => {
    const held = entry("w", "Wen Ito");
    (held.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
      "2026-10-01T12:00:00Z",
    );
    renderRoster({
      roster: [held],
      readiness: new Map([["w", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
    });
    expect(screen.queryByText("Waiver not signed yet")).toBeNull();
  });
});

/**
 * **A new release can clear a diver a physician refused, and the row says so**
 * (Aaron, 2026-10-07, issue #2158: "allow a waiver without, but show a warning
 * that a previous waiver had a physician say no (with link)").
 */
describe("an earlier physician refusal under a cleared release", () => {
  const refusedRow = (status: "ready" | "blocked" = "ready") =>
    ({
      ...readinessRow(status),
      overriddenRefusal: { recordId: "w-refused", at: new Date("2026-08-01T15:00:00Z") },
    }) as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;

  it("warns in the open on a Ready row, with a link to the refused record", () => {
    renderRoster({
      ...fixtures,
      roster: [entry("r", "Noor Haddad")],
      readiness: new Map([["r", refusedRow()]]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
    });

    const line = screen.getByText(/A physician did not clear this diver on/);
    expect(line).toBeVisible();
    expect(line.textContent).toMatch(/Aug\s1 \(earlier waiver\)/);
    const link = within(line.closest("li") as HTMLElement).getByRole("link", {
      name: "View signed record",
    });
    expect(link).toHaveAttribute("href", "/shop/blue-mantis/divers/p-r/waivers/w-refused");
  });

  it("says nothing on a held seat: the refusal is the matched person's history", () => {
    const held = entry("r", "Noor Haddad", { identityBookedAs: "Noor H." });
    (held.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
      "2026-08-20T15:00:00Z",
    );
    renderRoster({
      ...fixtures,
      roster: [held],
      readiness: new Map([["r", refusedRow("blocked")]]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
    });
    expect(screen.queryByText(/A physician did not clear this diver on/)).toBeNull();
  });
});
