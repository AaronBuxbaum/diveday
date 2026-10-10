// @vitest-environment jsdom

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SameNameHeldSeat } from "@/db/bookings";
import { emptyMedicalAnswers, flaggedMedicalPrompts, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { deepRow, entry, readinessRow, renderRoster, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, RentalFitByBooking, RosterEntry, WaiverByBooking } from "./types";

afterEach(cleanup);

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
        rentsHood: false,
        rentsGloves: false,
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

    expect(screen.getByText(/Matched to this record on a guess/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Marisol Vega" })).toBeVisible();
    // Both answers stand in the open, outside the row's fold (Aaron,
    // 2026-10-05: the old row offered one answer, behind the mark).
    const same = screen.getByRole("button", { name: "Same person as Marisol Vega" });
    expect(same).toBeVisible();
    expect(same.closest("details")).toBeNull();
    expect(screen.getByText("Different person")).toBeVisible();
  });

  /**
   * **The armed "Same person" carries the fact it turns on** (issue #1789,
   * H-79): the matched diver's last dive day here, the same line the
   * name-match prompt showed the staffer when the seat was taken. Said every
   * time, including "none": this is one question about one person.
   */
  describe("the armed confirm's last dive day", () => {
    const renderHeld = (lastDiveDay: Date | null) =>
      renderRoster({
        roster: [matched],
        readiness: unconfirmed,
        waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
        rentalFit,
        heldSeatLastDiveDay: new Map([["u", lastDiveDay]]),
      });
    const arm = () =>
      fireEvent.click(screen.getByRole("button", { name: "Same person as Marisol Vega" }));

    it("names the matched diver's last dive day here, once armed", () => {
      renderHeld(new Date("2026-08-26T15:00:00Z"));
      // Not on the row itself: the fact belongs to the deliberate question.
      expect(screen.queryByText(/Last dive day here/)).toBeNull();

      arm();

      const armed = screen.getByRole("alert");
      expect(within(armed).getByText("Last dive day here: Wed, Aug 26")).toBeInTheDocument();
      expect(within(armed).queryByText("No dive days here yet")).toBeNull();
    });

    it("says there is none for a diver this shop has never had on a boat", () => {
      renderHeld(null);

      arm();

      const armed = screen.getByRole("alert");
      expect(within(armed).getByText("No dive days here yet")).toBeInTheDocument();
      expect(within(armed).queryByText(/Last dive day here/)).toBeNull();
    });
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

  // Issue #2124: `sendDueReminders` holds a held seat's readiness reminders
  // until staff confirm who it is, so the row says so beside the way to ask.
  it("says the held seat's reminders wait on the confirm", () => {
    renderRoster({
      roster: [matched],
      readiness: unconfirmed,
      waivers: new Map([["u", heldWaiver]]) as WaiverByBooking,
      rentalFit,
    });

    expect(screen.getByTestId("identity-contact")).toHaveTextContent(
      "Reminders and the waiver wait until you confirm who this is.",
    );
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

    expect(screen.getByText(/Matched to this record on a guess/).closest("details")).toBeNull();
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
