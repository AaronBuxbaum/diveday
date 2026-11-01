// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_KIND_META, type TodayActionKind } from "@/lib/today";

// The spine composes WaiverSendControl/ResendConfirmationControl/
// PaymentActionControl, each of which statically imports its own `"use server"`
// action file. Those import `requireStaffSession` -> better-auth, which fails
// to resolve under vitest's module graph — mocking them here is what makes the
// spine renderable in this environment at all.
vi.mock("@/app/actions/invoices", () => ({ resendInvoiceAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ resendConfirmationAction: vi.fn() }));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: vi.fn(),
  undoHeldSendAction: vi.fn(),
  releaseHeldSendAction: vi.fn(),
}));
// The rental-fit row binds its keep action, which lives in the home's sibling
// `actions.ts` — a `"use server"` module whose imports reach better-auth and
// the database. Same reason as the three above.
vi.mock("@/app/shop/[shopSlug]/actions", () => ({
  keepRentalFitAction: vi.fn(),
  acknowledgeCrewAwayAction: vi.fn(),
  helpRequestAction: vi.fn(),
}));
// The agency check's host (H-20261008-cert-check-extension) wraps the spine and repaints through the
// router when a "Check all" ends; no app router is mounted here.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  action,
  boat,
  closed,
  departure,
  evening,
  hoursFromNow,
  renderSpine,
} from "./day-spine-test-fixtures";

afterEach(() => {
  cleanup();
});

/**
 * **The evening reading** — ADR 20260827-clearwater-surface-language, decision
 * 4, and H-20260827-close-out-remain-own, which removed `/close-out` in the same change that shipped
 * this.
 *
 * There is nothing to press to end the day: it is over when the boats are
 * home. These hold how a station reads once it settles, the coral budget's
 * one-element rule, and the log door's owner gate.
 */
describe("the evening reading", () => {
  it("says a station still out in words while another has come home", () => {
    // One boat home, one due back in an hour.
    renderSpine({
      departures: [],
      evening: evening([
        closed({ tripId: "home" }),
        closed({
          tripId: "out",
          title: "Night Dive",
          status: "still_out",
          startsAt: hoursFromNow(-2),
          endsAt: hoursFromNow(1),
          ended: false,
        }),
      ]),
    });

    // The station itself is there, and says which state it is in — in words,
    // never in colour alone.
    expect(screen.getByText("Still out")).toBeInTheDocument();
  });

  it("shows the demo's prior dusk roll call in its own finished group", () => {
    const previousDusk = closed({
      tripId: "demo-dusk",
      title: "Dusk Reef",
      startsAt: new Date("2026-08-26T22:30:00.000Z"),
      endsAt: new Date("2026-08-27T02:00:00.000Z"),
      booked: 11,
      sailed: 11,
    });
    const previousDuskStation = evening([previousDusk]).close.stations[0];
    if (!previousDuskStation) throw new Error("expected the finished dusk station");
    const eveningReading = evening([]);
    eveningReading.close.carryover = previousDuskStation;
    eveningReading.headCountCloses = new Map([
      ["demo-dusk", { closedAt: previousDuskStation.endsAt, closedBy: "Mara" }],
    ]);
    renderSpine({
      departures: [],
      evening: eveningReading,
    });

    const group = screen.getByRole("heading", { name: "Last roll call · yesterday" }).parentElement;
    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByText("Dusk Reef")).toBeInTheDocument();
    expect(within(group as HTMLElement).getByText("All home")).toBeInTheDocument();
    expect(group?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-08-26T22:30:00.000Z");
  });

  it("keeps a desk action in Needs you once every departure has settled", () => {
    const units = action({
      id: "units:unconfirmed",
      kind: "units_unconfirmed",
      subject: "Confirm the shop units",
      detail: "Currency and depth still need confirmation.",
      actionLabel: "Check units",
      href: "/shop/blue-mantis/settings#units",
    });

    renderSpine({
      departures: [],
      actions: [units],
      evening: evening([closed({ tripId: "t1" })]),
    });

    const needsYou = screen.getByText("Needs you").closest("div")?.parentElement as HTMLElement;
    expect(
      within(needsYou).getByText("Confirm the shop units", { exact: true }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Confirm the shop units", { exact: true })).toHaveLength(1);
    expect(screen.queryByText("At the desk")).toBeNull();
  });

  it("keeps a settled station's diver-only sentence when the crew were never counted", () => {
    // **The other half of #1346.** The moment is withheld, but the station
    // does not invent a crew count either: it says exactly what the records
    // support, which is how many divers came back.
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1", booked: 10, crew: [{}, {}] })]),
    });

    expect(screen.getByText("10 of 10 back")).toBeInTheDocument();
    expect(screen.queryByText(/All boats are home/)).toBeNull();
  });

  it("says nobody was aboard rather than counting a boat that carried no divers back", () => {
    // **Issue #1689's review, finding 7.** The numbers sentence is gated on
    // who sailed, never on the roster — a one-seat boat whose only diver was
    // marked absent printed "0 of 0 back", which reads as a head count of an
    // empty boat somebody closed. The per-status wording is the honest answer,
    // and it is the one sentence this key is ever asked for.
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1", booked: 1, sailed: 0 })]),
    });

    expect(screen.getByText("Nobody was aboard.")).toBeInTheDocument();
    expect(screen.queryByText("0 of 0 back")).toBeNull();
  });

  it("says the plan changed as its own sentence on its own line, and nothing when it did not", () => {
    // **Its own line, and a capital letter.** It used to ride the status line
    // as a lower-case fragment, which on a station whose status detail is a
    // full sentence read as one run-on: "No roll call was run… the plan
    // changed: dive 2 moved to Benwood". The framing is said once, by the
    // sentence, with the clauses inside it (principle 9).
    renderSpine({
      departures: [],
      evening: evening([
        closed({
          tripId: "t1",
          planChanges: [{ diveNumber: 2, siteName: "Benwood", reasonCode: "current" }],
        }),
      ]),
    });
    expect(
      screen.getByText("The plan changed: dive 2 moved to Benwood, current."),
    ).toBeInTheDocument();

    cleanup();
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1" })]) });
    expect(screen.queryByText(/plan changed/)).toBeNull();
  });

  it("carries no unsold-seats post-mortem on a settled station", () => {
    // It moved to the departure's Details tab (UX review 2026-10-10, item 31):
    // the day spine is where the desk looks for what needs doing.
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1", booked: 8 })]) });
    expect(screen.queryByText("Unsold seats")).toBeNull();
    expect(screen.queryByText(/went unsold/)).toBeNull();
  });

  it("gives the rental-fit row a control that saves", () => {
    renderSpine({
      departures: [],
      actions: [
        action({
          id: "rental-fit:r1",
          kind: "rental_fit_confirm",
          subject: "Hugo Marsh",
          detail: "Hugo Marsh’s BCD went out as L. Keep that as the fit next time?",
          actionLabel: "Open diver record",
          href: "/shop/blue-mantis/divers/p1",
          rentalFit: { reservationId: "r1" },
        }),
      ],
      evening: evening([closed({ tripId: "t1" })]),
    });

    // A submitting control, never a link: the size is already known, so
    // pointing at the diver's record to retype it would be the surface asking
    // a question it can answer.
    expect(screen.getByRole("button", { name: "Keep it" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open diver record" })).toBeNull();
  });

  /**
   * **A settled station's facts hang beside its mark** (pixel-craft class 3,
   * K-593). The status, the count and who closed it were three flex siblings
   * of the mark, so at 390 "last roll call closed by Sal Moretti" wrapped back
   * under the check glyph (x 38) rather than under "All home" (x 65). They
   * are one text block beside the mark now; every word of them still renders.
   */
  it("hangs a settled station's count and who closed it beside its mark", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1", booked: 8 })], {
        headCountCloses: new Map([["t1", { closedAt: hoursFromNow(-3), closedBy: "Sal Moretti" }]]),
      }),
    });
    const label = screen.getByText("All home");
    const block = label.parentElement;
    expect(block?.querySelector("svg")).toBeNull();
    expect(block).toContainElement(screen.getByText(/, 10 back by /));
    expect(block).toContainElement(screen.getByText("last roll call closed by Sal Moretti"));
    expect(block?.parentElement?.querySelector("svg path")).not.toBeNull();
  });

  it("hangs an open head count's sentence the same way, in its tone, beside the open mark", () => {
    // The failure path of the same line: a boat whose count did not close
    // keeps its word, its per-reason sentence and its danger ink, beside the
    // hollow mark rather than the tick.
    renderSpine({
      departures: [],
      evening: evening([
        closed({
          tripId: "t1",
          status: "unreconciled",
          gapReason: "missing_diver",
          diveNumber: 1,
          uncounted: 1,
        }),
      ]),
    });
    const label = screen.getByText("Unreconciled");
    const block = label.parentElement;
    const sentence = block?.querySelector(".text-danger");
    expect(sentence?.textContent).toBeTruthy();
    expect(block?.querySelector("svg")).toBeNull();
    const row = block?.parentElement;
    expect(row?.querySelector("svg circle")).not.toBeNull();
    expect(row?.querySelector("svg path")).toBeNull();
  });

  /**
   * The rest of the states that are not "All home" share that line: a boat
   * still out and an open dock count in warning ink, a boat that never left in
   * muted ink. Each keeps its word and its sentence beside the hollow mark, and
   * none of them names who closed a head count nobody closed.
   */
  it.each([
    {
      word: "Still out",
      ink: "text-warning-strong",
      station: {
        status: "still_out",
        startsAt: hoursFromNow(-2),
        endsAt: hoursFromNow(1),
        ended: false,
      },
    },
    {
      word: "Dock count open",
      ink: "text-warning-strong",
      station: { status: "count_open", gapReason: "no_roll_call" },
    },
    {
      word: "Not departed",
      ink: "text-muted",
      station: {
        status: "not_departed",
        startsAt: hoursFromNow(6),
        endsAt: hoursFromNow(9),
        ended: false,
      },
    },
  ] as const)(
    "hangs a $word station's sentence beside the hollow mark, in its tone",
    ({ word, ink, station }) => {
      renderSpine({
        departures: [],
        evening: evening([closed({ tripId: "t1", ...station })], {
          headCountCloses: new Map([
            ["t1", { closedAt: hoursFromNow(-3), closedBy: "Sal Moretti" }],
          ]),
        }),
      });
      const block = screen.getByText(word).parentElement;
      expect(block?.querySelector(`.${ink}`)?.textContent).toBeTruthy();
      expect(block?.querySelector("svg")).toBeNull();
      const row = block?.parentElement;
      expect(row?.querySelector("svg circle")).not.toBeNull();
      expect(row?.querySelector("svg path")).toBeNull();
      expect(screen.queryByText(/closed by/)).toBeNull();
    },
  );

  it("offers the departure log only to a reader who may generate one", () => {
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1" })]) });
    expect(screen.getByRole("link", { name: "Departure log" })).toBeInTheDocument();

    cleanup();
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], { canOpenLog: false }),
    });
    // Absent, never disabled — the gate is the render (AGENTS.md).
    expect(screen.queryByRole("link", { name: "Departure log" })).toBeNull();
  });

  it("says how many rows the Needs you list holds, beside its heading", () => {
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      actions: [
        action({ id: "a", departure: boat("t1") }),
        action({ id: "b", departure: boat("t1") }),
      ],
    });
    const heading = screen.getByRole("heading", { name: "Needs you" });
    expect(heading.parentElement).toHaveTextContent("2 things");
  });

  /**
   * **The two counts explain each other** (#2413). The sentence under the date
   * counts what is due before the next boat; the list counts everything. Read
   * side by side, "1 thing … before the 1:00 PM" over "2 things" looked like a
   * contradiction, so the list says how many of its rows are the boat's.
   */
  it("names how many of its rows are due before the next boat when that is not all of them", () => {
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      actions: [
        action({ id: "a", departure: boat("t1") }),
        action({ id: "b", departure: undefined }),
      ],
    });
    const heading = screen.getByRole("heading", { name: "Needs you" });
    expect(heading.parentElement).toHaveTextContent(/2 things · 1 before the 9:00\sAM/);
  });

  it("leads a crew reader with their own boat's rows and folds the desk's into one line", () => {
    // UX audit 2026-10-07, item 7: a captain's "what now" is the boat they
    // crew, not the front desk's queue.
    renderSpine({
      departures: [
        departure({ tripId: "mine", title: "Dawn Two-Tank" }),
        departure({ tripId: "other", title: "Wreck Trip", startsAt: hoursFromNow(3) }),
      ],
      crewedTripIds: ["mine"],
      actions: [
        action({ id: "m", kind: "waiver", subject: "Priya Sharma", departure: boat("mine") }),
        action({ id: "o", kind: "waiver", subject: "Sal Moretti", departure: boat("other") }),
        action({
          id: "d",
          kind: "blocked_aboard",
          subject: "Keiko Tanaka",
          departure: boat("other"),
        }),
        action({ id: "r", kind: "reviews_pending", subject: "1 review", urgency: "later" }),
      ],
    });
    const fold = screen.getByText("2 more for other boats and the desk").closest("details");
    if (!fold) throw new Error("the desk rows did not fold");
    expect(fold).not.toHaveAttribute("open");
    expect(within(fold).getByText("Sal Moretti", { exact: false })).toBeInTheDocument();
    expect(within(fold).getByText("1 review", { exact: false })).toBeInTheDocument();
    // Their own boat's row and a danger row on any boat stay in full.
    expect(within(fold).queryByText("Priya Sharma", { exact: false })).toBeNull();
    expect(within(fold).queryByText("Keiko Tanaka", { exact: false })).toBeNull();
    expect(screen.getByText("Priya Sharma", { exact: false })).toBeVisible();
  });

  const dangerKinds = (Object.keys(ACTION_KIND_META) as TodayActionKind[]).filter(
    (kind) => ACTION_KIND_META[kind].tone === "danger",
  );

  it("has danger-tone kinds to keep open, so the next case is not vacuous", () => {
    expect(dangerKinds.length).toBeGreaterThan(0);
  });

  it.each(dangerKinds)("never folds a %s row about another boat for a crew reader", (kind) => {
    renderSpine({
      departures: [
        departure({ tripId: "mine", title: "Dawn Two-Tank" }),
        departure({ tripId: "other", title: "Wreck Trip", startsAt: hoursFromNow(3) }),
      ],
      crewedTripIds: ["mine"],
      actions: [
        action({ id: "o", kind: "waiver", subject: "Sal Moretti", departure: boat("other") }),
        action({ id: "d", kind, subject: "Keiko Tanaka", departure: boat("other") }),
      ],
    });
    const fold = screen.getByText("1 more for other boats and the desk").closest("details");
    if (!fold) throw new Error("the other boat's rows did not fold");
    expect(within(fold).queryAllByText("Keiko Tanaka", { exact: false })).toEqual([]);
    for (const shown of screen.getAllByText("Keiko Tanaka", { exact: false })) {
      expect(shown.closest("details")).toBeNull();
    }
  });

  it("keeps the reader's own credential row open while the desk's fold", () => {
    renderSpine({
      departures: [departure({ tripId: "mine", title: "Dawn Two-Tank" })],
      crewedTripIds: ["mine"],
      readerPersonId: "me",
      actions: [
        action({
          id: "staff-credential:me",
          kind: "staff_credential_due",
          staffPersonId: "me",
          subject: "Sal Moretti",
          urgency: "later",
        }),
        action({
          id: "staff-credential:them",
          kind: "staff_credential_due",
          staffPersonId: "them",
          subject: "Keiko Tanaka",
          urgency: "later",
        }),
      ],
    });
    const fold = screen.getByText("1 more for other boats and the desk").closest("details");
    if (!fold) throw new Error("the other staffer's row did not fold");
    expect(within(fold).getByText("Keiko Tanaka", { exact: false })).toBeInTheDocument();
    expect(within(fold).queryByText("Sal Moretti", { exact: false })).toBeNull();
    expect(screen.getByText("Sal Moretti", { exact: false })).toBeVisible();
  });

  it("folds nothing for a reader who crews none of today's boats", () => {
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      crewedTripIds: [],
      actions: [action({ id: "o", subject: "Sal Moretti", departure: boat("t1") })],
    });
    expect(screen.queryByText(/for other boats and the desk/)).toBeNull();
  });

  it("keeps the log off a live departure's card, which is the day's briefing", () => {
    // ADR 20260804-incident-export-owner-gate, amendment 2026-10-07: a live
    // departure's log is one tap away on its Details tab, which is where an
    // owner whose boat is overdue goes for it; the card stays a briefing.
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      evening: evening([closed({ tripId: "t2", title: "Dawn Wall" })]),
    });
    const live = screen.getByRole("link", { name: "Two-Tank Reef" }).closest("li");
    if (!live) throw new Error("the live departure did not render a station");
    expect(within(live).queryByRole("link", { name: "Departure log" })).toBeNull();
    expect(screen.getByRole("link", { name: "Departure log" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t2/log",
    );
  });

  it("says how the head count ended, once, on the station that owns it", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1", booked: 10 })], {
        headCountCloses: new Map([
          ["t1", { closedAt: hoursFromNow(-3), closedBy: "Keiko Tanaka" }],
        ]),
      }),
    });

    expect(screen.getByText("All home")).toBeInTheDocument();
    expect(screen.getByText(/10 passengers and 2 crew out, 12 back by/)).toBeInTheDocument();
    expect(screen.getByText("last roll call closed by Keiko Tanaka")).toBeInTheDocument();
  });

  it("marks the day's homecoming once, and only when every count closed clean", () => {
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1", booked: 10 })]) });

    const line = screen.getAllByText("All boats are home: 10 passengers and 2 crew out, 12 back.");
    expect(line).toHaveLength(1);
    expect(line[0]).toHaveAttribute("role", "status");
    // The all-clear in the success wash the gear "All home" band uses, never
    // coral or amber ink (visual review A07).
    expect(line[0]).toHaveClass("bg-success-tint", "text-success-strong");
    expect(line[0].className).not.toMatch(/accent|warning/);
  });

  it("keeps the accent unspent when a diver did not come back", () => {
    renderSpine({
      departures: [],
      evening: evening([
        closed({
          tripId: "t1",
          booked: 10,
          status: "unreconciled",
          gapReason: "missing_diver",
          diveNumber: 2,
          uncounted: 1,
        }),
      ]),
    });

    expect(screen.queryByText(/All boats are home/)).toBeNull();
    expect(screen.queryByText(/Your first boat is home/)).toBeNull();
  });

  it("words the moment as a first, once ever, and never again after that day", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1", booked: 3 })], { firstEver: true }),
    });
    expect(
      screen.getByText("Your first boat is home: 3 passengers and 2 crew out, 5 back."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/All boats are home/)).toBeNull();
  });

  it("holds a settled station's place in clock order among the boats still ahead", () => {
    // The spine's own stations are read forward and a settled one is read
    // back; merged, the column of times still reads top to bottom.
    renderSpine({
      departures: [departure({ tripId: "later", title: "Night Dive", startsAt: hoursFromNow(6) })],
      evening: evening([
        closed({ tripId: "dawn", title: "Dawn Two-Tank" }),
        closed({
          tripId: "later",
          title: "Night Dive",
          status: "not_departed",
          startsAt: hoursFromNow(6),
          endsAt: hoursFromNow(9),
          ended: false,
        }),
      ]),
    });

    const titles = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(["Dawn Two-Tank", "Night Dive"]);
    // The live station won the trip it shares with the closing list — one
    // departure is one station, never two.
    expect(document.body.textContent?.split("Night Dive")).toHaveLength(2);
  });
});

/**
 * **The empty queue names no season** (issue #2661). It used to append a
 * June-to-August-is-summer sentence for every shop, which is the wrong season
 * for a southern-hemisphere or tropical shop. The body is the empty-body copy alone.
 */
describe("the empty queue", () => {
  const EMPTY_BODY =
    "Every diver booked in the next week has their waiver, certifications, and payment in order.";

  for (const timeZone of ["Pacific/Auckland", "America/New_York"]) {
    it(`says only that the week is in order, with no season, in ${timeZone}`, () => {
      renderSpine({ departures: [], actions: [], timeZone });
      expect(screen.getByText(EMPTY_BODY)).toBeTruthy();
      expect(screen.queryByText(/surface interval/i)).toBeNull();
    });
  }
});
