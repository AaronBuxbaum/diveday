// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckInQueueRow } from "@/db/check-in";
import { staffTranslator } from "@/i18n/staff-messages";
import type { NoShowClaim } from "@/lib/no-show";
import { CounterQueueRow, type CounterWaiverNotice } from "./CounterQueueRow";
import type { NoShowSalvageCopy } from "./NoShowScript";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const t = staffTranslator("en-US");

function row(overrides: Partial<CheckInQueueRow> = {}): CheckInQueueRow {
  return {
    bookingId: "booking-1",
    personId: "person-1",
    selfReported: false,
    personName: "Nadia Petrov",
    email: "nadia@example.com",
    dateOfBirth: null,
    giftGiverName: null,
    tripId: "trip-1",
    tripTitle: "Two-Tank Reef — Molasses & French",
    startsAt: new Date("2026-08-27T11:00:00.000Z"),
    endsAt: new Date("2026-08-27T14:30:00.000Z"),
    bookingStatus: "booked",
    readiness: { status: "ready", blockers: [] },
    boarded: false,
    missingEmergencyContact: false,
    firstVisit: false,
    ...overrides,
  };
}

function renderRow(
  overrides: Partial<CheckInQueueRow> = {},
  showEmail = false,
  showFirstVisit = true,
  waiverNotice?: CounterWaiverNotice,
  noShow: { claim?: NoShowClaim | null; salvage?: NoShowSalvageCopy } = {},
) {
  return render(
    <CounterQueueRow
      row={row(overrides)}
      shopSlug="blue-mantis"
      today="2026-08-27"
      showEmail={showEmail}
      showFirstVisit={showFirstVisit}
      checkInAction={vi.fn().mockResolvedValue({ ok: true })}
      undoAction={vi.fn().mockResolvedValue({ ok: true })}
      waiverAction={vi.fn().mockResolvedValue(undefined)}
      waiverNotice={waiverNotice}
      noShowClaim={noShow.claim ?? null}
      markNoShowAction={vi.fn().mockResolvedValue(undefined)}
      undoNoShowAction={vi.fn().mockResolvedValue(undefined)}
      salvage={noShow.salvage}
      t={t}
    />,
  );
}

/** A row whose paper release is the thing still owed — where the control lives. */
const owesWaiver = {
  readiness: { status: "blocked", blockers: [{ code: "waiver_not_sent" }] },
} satisfies Partial<CheckInQueueRow>;

const refusal = (bookingId: string): CounterWaiverNotice => ({
  form: "waiver",
  tone: "danger",
  text: "That paper waiver could not be recorded.",
  bookingId,
});

describe("a blocked row", () => {
  /**
   * The pin the counter's whole gate rests on: readiness decides who may
   * board, so a blocked row offers the fix and never the tap. Offering both
   * would be offering an act the server is about to refuse, in front of the
   * diver it is about.
   */
  it("exposes its one fix and never a check-in control", () => {
    renderRow({
      readiness: { status: "blocked", blockers: [{ code: "waiver_not_sent" }] },
    });
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Waiver has not been sent.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Check in / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Undo check-in / })).not.toBeInTheDocument();
  });

  /**
   * A diver who came through the counter and has been blocked since — a refund
   * landing, a card corrected — is not a receipt. The row says both facts in
   * the vocabulary the surface already speaks: the drawn mark for the arrival
   * that happened, the badge and the reasons for the gate that has closed. No
   * undo: un-checking somebody does not clear a blocker, and the rule that a
   * blocked row carries no check-in control does not bend for this case.
   */
  it("says a checked-in diver has gone blocked, without offering the tap back", () => {
    renderRow({
      bookingStatus: "checked_in",
      readiness: { status: "blocked", blockers: [{ code: "payment_due" }] },
    });
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Checked in")).toBeInTheDocument();
    expect(screen.getByText("Payment is outstanding for this trip.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Undo check-in / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Check in / })).not.toBeInTheDocument();
  });

  it("keeps the diver's record as a door and shows every reason it has", () => {
    renderRow({
      readiness: {
        status: "blocked",
        blockers: [{ code: "waiver_not_sent" }, { code: "payment_due" }],
      },
    });
    expect(screen.getByRole("link", { name: "Nadia Petrov" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1",
    );
    expect(screen.getByText("Payment is outstanding for this trip.")).toBeInTheDocument();
  });
});

describe("an unblocked row", () => {
  it("is one tap, named for the diver", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "Check in Nadia Petrov" })).toBeInTheDocument();
  });

  it("wears the drawn check and the state in words once settled", () => {
    const { container } = renderRow({ bookingStatus: "checked_in" });
    expect(screen.getByRole("button", { name: "Undo check-in for Nadia Petrov" })).toBeVisible();
    expect(screen.getByText("Checked in")).toBeInTheDocument();
    // Drawn, never an emoji — the mark is an SVG the shared component draws.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/[☑✅\uD83C-\uDBFF]/u);
  });

  /**
   * **A settled row still says who this is.** It carried the bare name for one
   * release, which dropped the Boarded badge from the case that actually
   * happens — boarding is recorded at the rail *after* counter check-in, so
   * `boarded && checked_in` is the ordinary path (task 149) — along with the
   * contact gap and the first visit. At the rail that also left the undo
   * sitting on a row that no longer said the diver was aboard, which is the one
   * fact a crew member correcting a mis-tap needs.
   */
  it("keeps the badges and the quiet facts once the row has settled", () => {
    renderRow({
      bookingStatus: "checked_in",
      boarded: true,
      missingEmergencyContact: true,
      firstVisit: true,
    });
    const undo = screen.getByRole("button", { name: "Undo check-in for Nadia Petrov" });
    expect(undo).toHaveTextContent("Boarded");
    expect(undo).toHaveTextContent("No emergency contact");
    expect(undo).toHaveTextContent("First visit");
  });
});

describe("the quiet facts a row carries", () => {
  it("says a missing emergency contact in a neutral badge, never as a blocker", () => {
    renderRow({ missingEmergencyContact: true });
    expect(screen.getByText("No emergency contact")).toBeInTheDocument();
    // Still checkable: this informs, it never gates.
    expect(screen.getByRole("button", { name: "Check in Nadia Petrov" })).toBeInTheDocument();
  });

  it("renders no contact badge when the record has one", () => {
    renderRow();
    expect(screen.queryByText("No emergency contact")).not.toBeInTheDocument();
  });

  it("says a first visit as muted text after the name, never as a badge", () => {
    renderRow({ firstVisit: true });
    const firstVisit = screen.getByText("First visit");
    expect(firstVisit).toBeInTheDocument();
    // A badge is a pill; this is a line of quiet meta. The distinction is the
    // point — boxing it would put a welcome at the volume of "Blocked".
    expect(firstVisit.className).not.toMatch(/rounded-full/);
    expect(firstVisit.className).toMatch(/text-muted/);
  });

  it("renders nothing for a diver who has been before", () => {
    renderRow({ firstVisit: false });
    expect(screen.queryByText("First visit")).not.toBeInTheDocument();
  });

  /**
   * **A word every name carries marks nobody.** On a shop's first season every
   * diver in the queue is a first visit, so the line rendered under all nine
   * names at once — a row taller each, at exactly the queue length where this
   * surface's promise is a name and one tap. The page judges it over the whole
   * visible queue (`firstVisitMarksAnException`) and the row obeys.
   */
  it("renders nothing when a first visit would not single anybody out", () => {
    renderRow({ firstVisit: true }, false, false);
    expect(screen.queryByText("First visit")).not.toBeInTheDocument();
    // The row is otherwise untouched — this is a word dropped, not a state.
    expect(screen.getByRole("button", { name: "Check in Nadia Petrov" })).toBeInTheDocument();
  });

  it("carries a first visit on a blocked row too", () => {
    renderRow({
      firstVisit: true,
      readiness: { status: "blocked", blockers: [{ code: "waiver_not_sent" }] },
    });
    expect(screen.getByText("First visit")).toBeInTheDocument();
  });

  it("prints an email only where two visible divers share a name", () => {
    renderRow({}, false);
    expect(screen.queryByText(/nadia@example\.com/)).not.toBeInTheDocument();
    cleanup();
    renderRow({}, true);
    expect(screen.getByText(/nadia@example\.com/)).toBeInTheDocument();
  });
});

/**
 * **The counter can hold three families at once**, which is what makes an
 * anonymous banner at the top of the page useless here: it says what went
 * wrong and nothing about who it went wrong for, while the collapsed form it
 * is about has just shut underneath it (issue 1574).
 *
 * The roster and the diver record both route a refusal to the form that
 * produced it (`noticeForForm`, `src/lib/staff-notices.ts`); these pin that
 * the counter now does too, and — the half that actually costs a staffer time
 * — that it lands on the *right* row.
 */
describe("a refused paper waiver", () => {
  it("says so on the row it names, and re-opens that row's form", () => {
    renderRow(owesWaiver, false, true, refusal("booking-1"));

    expect(screen.getByText("That paper waiver could not be recorded.")).toBeInTheDocument();
    // Open, not merely present: the staffer has to correct what the message
    // names, and the attestation checkbox only exists in the open form.
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("leaves the other families at the desk alone", () => {
    renderRow(owesWaiver, false, true, refusal("booking-2"));

    expect(screen.queryByText("That paper waiver could not be recorded.")).not.toBeInTheDocument();
    // And this row's form stays shut, so one diver's problem does not reopen
    // the form on every other row in the queue.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("leaves a row alone when nothing was refused at all", () => {
    renderRow(owesWaiver);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  /**
   * **The coupling the page depends on, pinned here.** A settled seat returns
   * early as a compact receipt with no blocker block and no `extra` slot, so it
   * can show no notice at all — which is why `page.tsx` stands the banner down
   * only for a row that is *not* `isSettledAtCounter`.
   *
   * Found by looking, not by reasoning: pointed at a checked-in, cleared
   * booking the first version suppressed the banner and rendered nothing on the
   * row, so the refusal was said nowhere on the page. If someone later gives
   * the settled row an `extra`, this test goes green-for-the-wrong-reason and
   * the page's guard becomes needlessly strict — read it before changing that
   * early return.
   */
  it("says nothing on a settled seat, which has nowhere to say it", () => {
    renderRow(
      { bookingStatus: "checked_in", readiness: { status: "ready", blockers: [] } },
      false,
      true,
      refusal("booking-1"),
    );

    expect(screen.queryByText("That paper waiver could not be recorded.")).not.toBeInTheDocument();
  });
});

describe("the no-show script", () => {
  /**
   * The door is drawn from the gate, never from the row alone: `noShowGate`
   * (`src/lib/no-show.ts`) opens it when the boat leaves without the diver and
   * shuts it when the arrivals window does, and the page is the layer that
   * holds both. Offering "Not here?" over a diver who is not due for two hours
   * is an invitation to a mistake on a shared desk tablet.
   */
  it("is not offered on a waiting row the gate has not opened", () => {
    renderRow();
    expect(screen.queryByText("Not here?")).not.toBeInTheDocument();
    expect(screen.queryByText("Did not dive?")).not.toBeInTheDocument();
  });

  it("is offered under the tap once the gate opens, leaving the tap alone", () => {
    renderRow({}, false, true, undefined, { claim: "frees_seat" });
    expect(screen.getByText("Not here?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check in Nadia Petrov" })).toBeInTheDocument();
  });

  /**
   * **The louder door, for the tap nobody comes back to undo**
   * (dive-domain-expert review, 2026-09-11). Once the boat has gone the same
   * tap stops being about a seat — there is no seat to sell — and becomes a
   * statement that this person did not dive, which costs them their recap,
   * their review, their tip and the day itself. The diver is at sea or gone
   * home and will never tell the desk it was a mis-tap, so the words have to
   * say what is being written before it is written.
   */
  it("asks the other question once the boat has gone, and says what it costs", () => {
    renderRow({}, false, true, undefined, { claim: "did_not_dive" });
    expect(screen.getByText("Did not dive?")).toBeInTheDocument();
    expect(screen.queryByText("Not here?")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "The boat has gone, so this records that they did not dive. They get no recap and the day will not count for them. You can put them back.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark that Nadia Petrov did not dive" }),
    ).toBeInTheDocument();
  });

  /**
   * **The word on screen is the plain one.** A released seat is "Not here" —
   * never archived, never deactivated, never "released" (ADR
   * 20260820-every-delete-is-soft).
   */
  it("wears the plain word and an undo once the seat is released", () => {
    renderRow({ bookingStatus: "no_show" });
    expect(screen.getByText("Not here")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Put Nadia Petrov back on this boat’s list" }),
    ).toBeInTheDocument();
    // And no check-in tap: the counter is finished with this seat.
    expect(screen.queryByRole("button", { name: "Check in Nadia Petrov" })).not.toBeInTheDocument();
  });

  it("renders the salvage under the released row", () => {
    renderRow({ bookingStatus: "no_show" }, false, true, undefined, {
      salvage: {
        line: "2 divers are waiting for this seat",
        links: [{ href: "/shop/blue-mantis/trips/trip-1/guests", label: "Open the wait list" }],
        money: {
          line: "Marking someone not here does not charge or refund anything.",
          href: "/shop/blue-mantis/orders?personId=person-1",
          label: "Open their orders",
        },
      },
    });
    expect(screen.getByText("2 divers are waiting for this seat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the wait list" })).toBeInTheDocument();
  });

  /** A released seat is not a settled one, so it never wears the drawn check. */
  it("does not wear the settled check", () => {
    renderRow({ bookingStatus: "no_show" });
    expect(screen.queryByText("Checked in")).not.toBeInTheDocument();
  });
});
