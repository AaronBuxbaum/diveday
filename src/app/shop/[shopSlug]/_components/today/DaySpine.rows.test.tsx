// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleDaySpine, type FactOfScale } from "@/lib/today";

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

import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StatusMark } from "@/components/ui/StatusMark";
import type { DayTakings as DayTakingsReading } from "@/lib/closeout";
import { DaySpine } from "./DaySpine";
import {
  action,
  boat,
  closed,
  departure,
  evening,
  hoursFromNow,
  NOW,
  renderSpine,
  stationStage,
} from "./day-spine-test-fixtures";

afterEach(() => {
  cleanup();
});

/**
 * Roll-call rows, carried over from `TodayQueue.test.tsx`: the loudest thing
 * this app can say, and the two kinds that must never share a word or a tone.
 */
describe("roll-call rows (DOM-H3)", () => {
  it("words the row as a roll call in the danger tone and points at the open checkpoint", () => {
    const { container } = renderSpine({
      actions: [
        action({
          id: "roll-call:t1:after_dive_2",
          kind: "roll_call_unfinished",
          urgency: "imminent",
          subject: "Two-Tank Reef",
          aboutDeparture: true,
          detail: "This boat is back and the dive 2 roll call was never finished…",
          actionLabel: "Open roll call",
          href: "/shop/blue-mantis/trips/t1/manifest?checkpoint=after_dive_2",
          departure: boat("t1"),
        }),
      ],
    });

    expect(screen.getByText("Roll call").className).toContain("text-danger");
    // Never an in-place control: closing a head count happens on the manifest,
    // one tap away, not from a button on the spine.
    expect(screen.getByRole("link", { name: "Open roll call" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t1/manifest?checkpoint=after_dive_2",
    );
    expect(container.querySelector("form")).toBeNull();
  });

  it("gives a diver who did not come back its own word, and the dock count a quieter one", () => {
    renderSpine({
      actions: [
        action({ id: "m", kind: "roll_call_missing_diver", departure: boat("t1") }),
        action({ id: "d", kind: "roll_call_departure_open", departure: boat("t1") }),
        action({ id: "n", kind: "roll_call_not_started", departure: boat("t1") }),
      ],
    });
    expect(screen.getByText("Missing diver").className).toContain("text-danger");
    expect(screen.getByText("Dock count").className).toContain("text-warning");
    expect(screen.getByText("No roll call").className).toContain("text-warning");
  });
});

describe("payment rows", () => {
  it("renders the inline payment control only once a booking is known to be invoiced", () => {
    renderSpine({
      actions: [
        action({
          id: "paid-row",
          kind: "payment",
          actionLabel: "Take payment",
          departure: boat("t1"),
          payment: {
            bookingId: "booking-1",
            orderId: "order-1",
            hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_1/in_1",
          },
        }),
      ],
    });
    expect(screen.getByRole("button", { name: "Copy payment link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend invoice" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Take payment" })).toBeNull();
  });

  it("falls back to plain roster navigation when the booking was never invoiced — never a dead button", () => {
    renderSpine({
      actions: [
        action({
          id: "counter-row",
          kind: "payment",
          actionLabel: "Take payment",
          href: "/shop/blue-mantis/trips/t1#booking-2",
          departure: boat("t1"),
          payment: { bookingId: "booking-2" },
        }),
      ],
    });
    expect(screen.getByRole("link", { name: "Take payment" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t1#booking-2",
    );
    expect(screen.queryByRole("button", { name: "Copy payment link" })).toBeNull();
  });
});

/**
 * **A tap's outcome survives its own fix landing.**
 *
 * Every performing control on this page holds `useActionState` — the waiver
 * send's private fallback link, the invoice resend's result, the wait-list
 * invite's. The server action revalidates the home, which re-renders these
 * rows with fresh evidence, and the row a staffer just tapped comes back
 * carrying a *different blocker code* (a waiver goes missing → pending). Keyed
 * on `TodayAction.id`, which spells that code, React would treat it as a new
 * row and throw the outcome away with the old one — silently, and exactly on
 * the shop with no email configured, where the outcome *is* the link.
 */
describe("a row that performs keeps its place", () => {
  it("keeps the same control mounted when the fix lands and the blocker code moves on", () => {
    const missing = action({
      id: "blocker:booking-1:waiver_missing",
      kind: "waiver",
      subject: "Priya Sharma",
      detail: "Priya Sharma hasn’t been sent hers.",
      actionLabel: "Send waiver",
      departure: boat("t1"),
      waiver: { bookingIds: ["booking-1"] },
    });
    const { rerender } = renderSpine({ actions: [missing] });
    const before = screen.getByRole("button", { name: "Send waiver" });

    // The same booking, one state later: what the server hands back after the
    // send lands.
    rerender(
      <DaySpine
        context={{
          spine: assembleDaySpine(
            {
              departures: [departure()],
              actions: [
                action({
                  ...missing,
                  id: "blocker:booking-1:waiver_pending",
                  detail: "Waiver not signed. Link sent.",
                  actionLabel: "Nudge waiver",
                }),
              ],
            },
            { departures: [], actions: [] },
          ),
          shopSlug: "blue-mantis",
          mailShopName: "Blue Mantis",
          locale: "en-US",
          timeZone: "America/New_York",
          currency: "usd",
          now: NOW,
        }}
      />,
    );

    // The *same DOM node*, relabelled — not a new one. A remount would have
    // replaced it, and taken the tap's outcome with it.
    expect(screen.getByRole("button", { name: "Nudge waiver" })).toBe(before);
  });

  it("still tells two rows apart when neither performs anything", () => {
    renderSpine({
      actions: [
        action({ id: "blocker:booking-1:certification", kind: "certification", subject: "Grace" }),
        action({
          id: "blocker:booking-1:emergency_contact",
          kind: "emergency_contact",
          subject: "Nadia",
        }),
      ],
    });
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Nadia")).toBeInTheDocument();
  });
});

/**
 * The copy rules the ADR rides on this slice. A status sentence that says
 * "she" or "his" about a diver is wrong twice over — the app does not know,
 * and the name is shorter than the pronoun (SPEC 6c).
 */
describe("the words on the spine", () => {
  it("uses no third-person pronoun in a status sentence or an action label", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "on-boat", subject: "Priya Sharma", departure: boat("t1") }),
        action({ id: "chore", kind: "reviews_pending" }),
      ],
      showPaymentsRow: true,
    });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b(she|he|her|hers|his|him|they|them|their|theirs)\b/i);
  });
});

/**
 * The row's glyph — the first of the anatomy's four parts (glyph, one word of
 * kind, one sentence, one fix). Reef's board draws it; it was the one part the
 * spine's rows did not carry until 2026-09-02.
 */
describe("the row glyph", () => {
  it("leads a wrong row with the status family's shape and a quiet row with its category drawing", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "danger", kind: "medical_review", departure: boat("t1") }),
        action({ id: "warning", kind: "waiver", departure: boat("t1") }),
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
      ],
    });
    const rows = [...container.querySelectorAll("ol ~ * li, ul > li")].filter((row) =>
      row.querySelector("span > svg"),
    );
    expect(rows).toHaveLength(3);
    const inks = rows.map((row) => row.querySelector("span > svg")?.getAttribute("class") ?? "");
    expect(inks[0]).toContain("text-danger");
    expect(inks[1]).toContain("text-warning-strong");
    expect(inks[2]).toContain("text-muted");
    // From the shipped status family: a drawing is never a status glyph.
    for (const row of rows) expect(row.querySelector("[data-site-mark]")).toBeNull();
    // UX review 2026-10-10, item 6: the quiet row's mark is the gear drawing,
    // not the hollow ring that read as a checkbox.
    const gear = render(<DiveDayIcon name="gear" />).container.querySelector("svg");
    const ring = render(<StatusMark variant="pending" />).container.querySelector("svg");
    const quiet = rows[2]?.querySelector("span > svg");
    expect(quiet?.innerHTML).toBe(gear?.innerHTML);
    expect(quiet?.innerHTML).not.toBe(ring?.innerHTML);
  });
});

/**
 * **Good news never wears the warning colour** (UX review 2026-10-10, item 3).
 * The all-clear line wore the coral accent, which reads amber in boat mode; it
 * now wears success, and it never shows while a boat still has someone blocked.
 */
describe("the all-clear line's tone", () => {
  it("wears success, never the accent or warning", () => {
    renderSpine({
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    const line = screen.getByText("Today’s boats are all clear").closest("[role=status]");
    expect(line?.className).toContain("bg-success-tint");
    expect(line?.className).not.toMatch(/accent|warning|primary-tint/);
  });

  it("stays quiet while the day still counts someone blocked", () => {
    renderSpine({
      blocked: 1,
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.queryByText("Today’s boats are all clear")).toBeNull();
  });
});

/**
 * **One fact of scale, on the day it is true** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 3, slice 16b.
 *
 * The test that matters most is the first one: on the overwhelming majority of
 * days this renders nothing, and a moment that leaks into an ordinary morning
 * is the failure the whole coral budget exists to prevent.
 */
describe("one fact of scale (slice 16b)", () => {
  const hundredth: FactOfScale = {
    kind: "divers",
    count: 400,
    diverName: "Ben Okafor",
    departureAt: new Date("2026-07-21T11:00:00.000Z"),
    seasonStart: { month: 5, day: 1 },
  };

  it("says nothing on a day that is not the day", () => {
    renderSpine({ factOfScale: null, actions: [action({ id: "b", departure: boat("t1") })] });
    expect(screen.queryByText(/diver of the season/)).toBeNull();
    expect(screen.queryByText(/First boat of the season/)).toBeNull();
  });

  it("names the diver, the departure and the count, with the season it counts from", () => {
    renderSpine({ factOfScale: hundredth, actions: [action({ id: "b", departure: boat("t1") })] });
    expect(
      screen.getByText("Ben Okafor boards the 7:00 AM as your 400th diver of the season."),
    ).toBeInTheDocument();
    expect(screen.getByText("Since May 1")).toBeInTheDocument();
  });

  it("says the season's first boat without a count", () => {
    renderSpine({
      factOfScale: { kind: "first_boat", seasonStart: { month: 5, day: 1 } },
      actions: [action({ id: "b", departure: boat("t1") })],
    });
    expect(screen.getByText("First boat of the season.")).toBeInTheDocument();
    expect(screen.queryByText(/diver of the season/)).toBeNull();
  });

  it("outranks the morning all-clear, which happens on a good Tuesday", () => {
    renderSpine({
      factOfScale: hundredth,
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.getByText(/400th diver of the season/)).toBeInTheDocument();
    expect(screen.queryByText(/boats are all clear/)).toBeNull();
  });

  it("stands down for the shop's first booking ever, which happens once", () => {
    renderSpine({
      factOfScale: hundredth,
      firstBooking: {
        bookingId: "b1",
        tripId: "t9",
        tripTitle: "Two-Tank — Alligator Reef",
        startsAt: hoursFromNow(96),
        diverName: "Ravi Chandra",
        priceCents: 9500,
        currency: "usd",
        paymentStatus: "paid",
        paymentAmountCents: 9500,
        paymentCurrency: "usd",
        waiverSigned: true,
      },
      actions: [action({ id: "b", departure: boat("t1") })],
    });
    expect(screen.getByText("Your first booking")).toBeInTheDocument();
    expect(screen.queryByText(/400th diver of the season/)).toBeNull();
  });

  it("sits above a morning with a blocker on it, because a count is not a compliment", () => {
    renderSpine({
      factOfScale: hundredth,
      actions: [action({ id: "blocked", kind: "certification", departure: boat("t1") })],
    });
    expect(screen.getByText(/400th diver of the season/)).toBeInTheDocument();
  });
});

/**
 * **A moment line is pulled up only toward a sentence** (pixel-craft class 4,
 * K-319). The `-mt-4` tucks a line under the header's "Next up" sentence,
 * which the page prints only on a day with no station left on the spine. The
 * season's fact and the morning all-clear render over today's stations, so
 * there is no sentence above them and the pull aimed at the sky band's edge:
 * 16px under it, then 40px to the first station, where every other first
 * block sits the header's 32px under the band.
 */
describe("where a moment line sits (K-319)", () => {
  it("leaves the season's fact the header's own distance under the band", () => {
    renderSpine({
      factOfScale: { kind: "first_boat", seasonStart: { month: 5, day: 1 } },
      actions: [action({ id: "b", departure: boat("t1") })],
    });
    expect(screen.getByRole("status")).not.toHaveClass("-mt-4");
  });

  it("leaves the morning all-clear there too: it needs today's stations, so no sentence is above it", () => {
    renderSpine({
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.getByRole("status")).not.toHaveClass("-mt-4");
  });

  it("still tucks the all-home line under the sentence an evening's header ends on", () => {
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1" })]) });
    expect(screen.getByRole("status")).toHaveClass("-mt-4");
  });
});

/**
 * **The boat says where it is** — ADR 20260904-reef-all-the-way-down, decision
 * 2, Budget rule 4, slice 16c.
 */
describe("the stage chip (slice 16c)", () => {
  const withStage = (stage: Parameters<typeof stationStage>[0]) =>
    renderSpine({
      departures: [{ ...departure(), stage: stationStage(stage) }],
      actions: [action({ id: "b", departure: boat("t1") })],
    });

  it("says nothing on a departure whose crew has said nothing", () => {
    const { container } = renderSpine({
      departures: [{ ...departure(), stage: null }],
      actions: [action({ id: "b", departure: boat("t1") })],
    });
    expect(container.textContent).not.toMatch(/Boarding|Underway|Surface|Heading in|Home/);
    // The word this app refuses to say about a boat nobody has spoken for.
    expect(container.textContent).not.toMatch(/unknown/i);
  });

  it("says the manifest strip's own word, then the site and the time they said it", () => {
    withStage("underway");
    expect(screen.getByText("Underway")).toBeInTheDocument();
    expect(screen.getByText(/^Molasses Reef · since /)).toBeInTheDocument();
  });

  it("names no site at the dock, and none on a departure with no plan", () => {
    withStage("boarding");
    expect(screen.getByText("Boarding")).toBeInTheDocument();
    expect(screen.getByText(/^since /)).toBeInTheDocument();
    cleanup();
    renderSpine({
      departures: [
        {
          ...departure(),
          stage: { ...stationStage("underway"), siteName: null },
        },
      ],
      actions: [action({ id: "b", departure: boat("t1") })],
    });
    expect(screen.getByText(/^since /)).toBeInTheDocument();
  });
});

/**
 * **The door** — ADR 20260911-clear-the-deck §1, the floor's first row: *a
 * row's own tap is its only door; a trailing verb, where one exists, is the fix
 * and nothing else.*
 *
 * The home used to end nine rows in "Open crew ›", "Open prep list ›", "Open
 * guests ›" and six more, each beside the chevron `LedgerRow` already draws for
 * any row carrying an `href` — nine verbs for nine taps the row itself answers,
 * on a screen the owner's own read called "way too many buttons". These two
 * tests are what keeps them from coming back one surface at a time.
 *
 * The destination is still *spoken*: it is the stretched overlay's
 * `aria-label`, which is why each case below looks the row up by that name and
 * then proves the same words are nowhere on screen.
 */
describe("a row that is only a door", () => {
  /** One of each shape the spine draws: on a station, and at the desk. */
  const doorRows = [
    action({
      id: "crew",
      kind: "uncrewed_departure",
      subject: "Two-Tank Reef",
      aboutDeparture: true,
      detail: "8 divers are booked and nobody is assigned to supervise this departure.",
      actionLabel: "Open crew",
      href: "/shop/blue-mantis/trips/t1#crew",
      departure: boat("t1"),
    }),
    action({
      id: "prep",
      kind: "dive_prep",
      subject: "Two-Tank Reef",
      aboutDeparture: true,
      detail: "3 divers still need rental sizes.",
      actionLabel: "Open prep list",
      href: "/shop/blue-mantis/trips/t1#packing-list",
      departure: boat("t1"),
    }),
    action({
      id: "inbox:unanswered",
      kind: "unanswered_messages",
      subject: "3 messages are waiting on an answer",
      // The desk's counting rows are their subject alone.
      detail: "",
      actionLabel: "Open inbox",
      href: "/shop/blue-mantis/inbox",
    }),
  ];

  it("never renders a second link inside a row that is itself a link", () => {
    // The guard the ADR names. `LedgerRow`'s stretched overlay is the row's
    // one `<a>`; anything else inside it is a target a finger cannot aim at,
    // sitting on top of the one it can.
    const { container } = renderSpine({ actions: doorRows });
    const overlays = container.querySelectorAll("a.absolute");
    expect(overlays.length).toBe(doorRows.length);
    for (const overlay of overlays) {
      const row = overlay.parentElement;
      expect(row).not.toBeNull();
      expect(row?.querySelectorAll("a")).toHaveLength(1);
      expect(row?.querySelectorAll("button")).toHaveLength(0);
    }
  });

  it("ends in its chevron, never in the destination as a word", () => {
    renderSpine({ actions: doorRows });
    for (const row of doorRows) {
      // Spoken, so a reader tabbing through still hears where the row goes…
      expect(screen.getByRole("link", { name: row.actionLabel })).toHaveAttribute("href", row.href);
      // …and never drawn, because the row and its chevron already said it.
      expect(screen.queryByText(row.actionLabel)).toBeNull();
    }
  });

  it("keeps the verb where the verb is the fix", () => {
    // The other half of the rule: a tap with a consequence keeps a real
    // control, and its words stay on screen.
    renderSpine({
      actions: [
        action({
          id: "blocker:b1:waiver_not_sent",
          kind: "waiver",
          subject: "Priya Sharma",
          detail: "Waiver not signed, not sent yet",
          actionLabel: "Send waiver",
          href: "/shop/blue-mantis/trips/t1",
          waiver: { bookingIds: ["b1"] },
          departure: boat("t1"),
        }),
      ],
    });
    expect(screen.getByRole("button", { name: "Send waiver" })).toBeInTheDocument();
  });
});

/**
 * **What today made** — the evening's one money reading (issue #1930; ADR
 * 20260919-one-idea, decision I · Tide: "money is what the day made").
 */
describe("what today made", () => {
  const takings = (over: Partial<DayTakingsReading> = {}): DayTakingsReading => ({
    revenueCents: 124_000,
    tipsCents: 0,
    importedRecordCount: 0,
    boatTips: [],
    ...over,
  });

  it("reads the day's takings once every departure has settled", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], { takings: takings() }),
    });

    const heading = screen.getByRole("heading", { name: "What today made" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("$1,240")).toBeInTheDocument();
  });

  it("says nothing at all when the reader may not read it", () => {
    // A captain at the end of a Saturday. Absent, never "you may not see this":
    // a withheld-figure notice tells the crew a number exists and is being
    // kept from them, which is worse than the silence it replaces. The page
    // resolves `canPersonViewShopReports` and hands down null.
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], { takings: null }),
    });

    expect(screen.queryByRole("heading", { name: "What today made" })).toBeNull();
    // Paired with a positive query, so this cannot pass on an evening that
    // never rendered at all.
    expect(screen.getByText("All home")).toBeInTheDocument();
  });

  it("holds the figure back while a boat is still out", () => {
    // "What today made" is past tense, and a day with a boat on the water has
    // not made it yet.
    renderSpine({
      departures: [],
      evening: evening(
        [
          closed({ tripId: "home" }),
          closed({
            tripId: "out",
            title: "Night Dive",
            status: "still_out",
            startsAt: hoursFromNow(-2),
            endsAt: hoursFromNow(1),
            ended: false,
          }),
        ],
        { takings: takings() },
      ),
    });

    expect(screen.queryByRole("heading", { name: "What today made" })).toBeNull();
    expect(screen.getByText("Still out")).toBeInTheDocument();
  });

  it("prints tips as their own line and never inside the figure", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], {
        takings: takings({ tipsCents: 8_500 }),
      }),
    });

    // $1,240 and $85, not $1,325: a tip is its own Stripe charge and the month
    // keeps the two apart for that reason.
    expect(screen.getByText("$1,240")).toBeInTheDocument();
    expect(screen.getByText("And $85 in tips")).toBeInTheDocument();
    expect(screen.queryByText("$1,325")).toBeNull();
  });

  it("splits the day's tips by boat when more than one boat was tipped", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], {
        takings: takings({
          tipsCents: 14_000,
          boatTips: [
            { tripId: "t1", startsAt: hoursFromNow(-8), label: "Manta", cents: 8_000 },
            { tripId: "t2", startsAt: hoursFromNow(-4), label: "Wreck run", cents: 6_000 },
          ],
        }),
      }),
    });

    expect(screen.getByText("And $140 in tips")).toBeInTheDocument();
    expect(screen.getByText(/Manta: \$80/)).toBeInTheDocument();
    expect(screen.getByText(/Wreck run: \$60/)).toBeInTheDocument();
  });

  it("names the boat when only one boat was tipped (issue #2469)", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], {
        takings: takings({
          tipsCents: 8_000,
          boatTips: [{ tripId: "t1", startsAt: hoursFromNow(-8), label: "Manta", cents: 8_000 }],
        }),
      }),
    });

    expect(screen.getByText("And $80 in tips on Manta")).toBeInTheDocument();
    expect(screen.queryByText("And $80 in tips")).toBeNull();
    expect(screen.queryByText(/Manta:/)).toBeNull();
  });

  it("says nothing about tips a day did not get", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], { takings: takings() }),
    });

    expect(screen.getByText("$1,240")).toBeInTheDocument();
    expect(screen.queryByText(/in tips/)).toBeNull();
  });

  it("names money inside the figure that Stripe never confirmed", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], {
        takings: takings({ importedRecordCount: 3 }),
      }),
    });

    expect(
      screen.getByText("Includes 3 imported records Stripe has not confirmed."),
    ).toBeInTheDocument();
  });
});

/** What the divers left on the reader's boats this week (UX review 2026-10-11, item 18). */
describe("the crew's tips line", () => {
  it("tells a crew member their share of the week's tips", () => {
    renderSpine({ crew: { tipsCents: 14_000, month: null } });
    expect(screen.getByText("Your share of tips this week: $140.")).toBeInTheDocument();
  });

  it("says nothing on a week with no tips", () => {
    renderSpine({ crew: { tipsCents: 0, month: null } });
    expect(screen.queryByText(/share of tips this week/)).toBeNull();
  });
});

/** Tomorrow from tonight (fifth-loop ideas, item 2): the evening says what tomorrow needs. */
describe("tomorrow from tonight", () => {
  const tomorrow = { departures: 2, tanks: { total: 42, air: 36, nitrox: 6 }, rentalPieces: 29 };

  it("adds tomorrow's boats together once the day is closing", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], { takings: null }, tomorrow),
    });
    expect(screen.getByRole("heading", { name: "Tomorrow from tonight" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Print tomorrow" })).toHaveAttribute(
      "href",
      expect.stringContaining("/print?day=tomorrow"),
    );
  });

  it("waits while a boat is still out", () => {
    renderSpine({
      departures: [],
      evening: evening(
        [
          closed({
            tripId: "out",
            status: "still_out",
            startsAt: hoursFromNow(-2),
            endsAt: hoursFromNow(1),
            ended: false,
          }),
        ],
        { takings: null },
        tomorrow,
      ),
    });
    expect(screen.queryByRole("heading", { name: "Tomorrow from tonight" })).toBeNull();
    expect(screen.getByText("Still out")).toBeInTheDocument();
  });
});

/**
 * **Each diver once, a long boat folded** (UX delight sheet 2026-10-22, item
 * 4): naming every diver may not bury the boat, and folding may not drop one.
 */
describe("a boat with many divers to name", () => {
  const names = ["Ana", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hal"];
  const rows = names.map((name, index) =>
    action({
      // Boat work: a readiness blocker never folds (`foldBoatRows`).
      id: `prep:t1:p${index}`,
      kind: "dive_prep",
      subject: `${name} Diver`,
      detail: "rental size, emergency contact",
      departure: { tripId: "t1", label: "Two-Tank Reef · 1:00 PM" },
      diver: { personId: `p${index}`, items: ["rental size", "emergency contact"] },
      dueAt: hoursFromNow(2),
    }),
  );

  it("shows its first rows and folds the rest behind and N more, every diver still on the page", () => {
    const { container } = renderSpine({ actions: rows });
    const fold = screen.getByText("and 3 more");
    expect(fold.closest("summary")).not.toBeNull();
    expect(fold.closest("details")?.hasAttribute("open")).toBe(false);
    for (const name of names) expect(screen.getByText(`${name} Diver`)).toBeTruthy();
    // The folded rows sit inside the fold, the first five above it.
    const folded = fold.closest("details");
    expect(folded?.textContent).toContain("Fay Diver");
    expect(folded?.textContent).not.toContain("Ana Diver");
    expect(container.textContent).toContain("rental size, emergency contact");
  });

  it("shows a boat of six whole, since and 1 more would cost the row it hides", () => {
    renderSpine({ actions: rows.slice(0, 6) });
    expect(screen.queryByText(/and \d+ more/)).toBeNull();
  });
});

/**
 * **The boat's waiver batch says what it sends** (layer 3 auditor review, B1):
 * a row about the departure renders its detail and not its subject, so the
 * sentence lives in the detail, and the row acts on divers already counted.
 */
describe("the boat's one-tap waiver row", () => {
  const departureRef = { tripId: "t1", label: "Two-Tank Reef · 1:00 PM" };
  const names = ["Ana", "Ben", "Cara"];
  const divers = names.map((name, index) =>
    action({
      id: `blocker:b${index}:waiver_not_sent`,
      subject: `${name} Diver`,
      detail: "Waiver not signed, not sent yet",
      departure: departureRef,
      diver: { personId: `p${index}`, items: ["waiver"], readiness: true },
      waiver: { bookingIds: [`b${index}`] },
      actionLabel: "Send waiver",
      dueAt: hoursFromNow(2),
    }),
  );
  const batch = action({
    id: "waivers:t1:waiver_not_sent",
    subject: "Two-Tank Reef · 1:00 PM",
    detail: "3 waivers not signed, not sent yet",
    departure: departureRef,
    aboutDeparture: true,
    batch: true,
    actionLabel: "Send waivers",
    waiver: { bookingIds: ["b0", "b1", "b2"] },
    dueAt: hoursFromNow(2),
  });

  it("renders its sentence beside its one button", () => {
    renderSpine({ actions: [batch, ...divers] });
    expect(screen.getByText("3 waivers not signed, not sent yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send waivers" })).toBeTruthy();
  });

  it("is not counted again in Needs you's number", () => {
    renderSpine({ actions: [batch, ...divers] });
    expect(screen.getAllByText(/^3 things/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^4 things/)).toBeNull();
  });
});
