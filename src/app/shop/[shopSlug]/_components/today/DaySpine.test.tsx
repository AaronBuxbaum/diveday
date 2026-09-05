// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assembleDaySpine,
  type FactOfScale,
  type SpineDeparture,
  type TodayAction,
} from "@/lib/today";

// The spine composes WaiverSendControl/ResendConfirmationControl/
// PaymentActionControl, each of which statically imports its own `"use server"`
// action file. Those import `requireStaffSession` -> better-auth, which fails
// to resolve under vitest's module graph — mocking them here is what makes the
// spine renderable in this environment at all.
vi.mock("@/app/actions/invoices", () => ({ resendInvoiceAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ resendConfirmationAction: vi.fn() }));
vi.mock("@/app/actions/waivers", () => ({ sendWaiversAction: vi.fn() }));
// The closing block binds the evening's own acts, which live in the home's
// sibling `actions.ts` — a `"use server"` module whose imports reach
// better-auth and the database. Same reason as the three above.
vi.mock("@/app/shop/[shopSlug]/actions", () => ({
  closeDayAction: vi.fn(),
  setLeftoverDecisionAction: vi.fn(),
}));

import type { FirstBooking } from "@/db/first-booking";
import { assembleEveningClose, type CloseoutDeparture } from "@/lib/closeout";
import { DaySpine, type EveningReading, type SpineInviteAction } from "./DaySpine";

afterEach(() => {
  cleanup();
});

const NOW = new Date("2026-08-27T11:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);
const inviteAction: SpineInviteAction = vi.fn().mockResolvedValue("sent");

function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Open roster",
    href: "/shop/blue-mantis/trips/t1",
    dueAt: null,
    ...overrides,
  };
}

function departure(overrides: Partial<SpineDeparture> = {}): SpineDeparture {
  return {
    tripId: "t1",
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(2),
    endsAt: hoursFromNow(5),
    siteName: "Molasses Reef",
    courseTitle: null,
    boatName: "Mantis II",
    priceCents: 9500,
    capacity: 12,
    booked: 10,
    boarded: 0,
    blocked: 0,
    crew: [{ fullName: "Keiko Tanaka" }],
    blockedAboardGroups: [],
    crewAccountedFor: true,
    crewReason: null,
    ...overrides,
  };
}

const boat = (tripId: string, label = "Two-Tank Reef · 7:00 AM") => ({ tripId, label });

/**
 * One of the day's departures as the closing state sees it — the shape
 * `assembleDayCloseout` hands `assembleEveningClose`. Built here rather than
 * run through the whole assembly so an evening case can state the one fact it
 * is about.
 */
function closed(overrides: Partial<CloseoutDeparture> & { tripId: string }): CloseoutDeparture {
  return {
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(-6),
    endsAt: hoursFromNow(-3),
    booked: 10,
    status: "all_home",
    gapReason: null,
    diveNumber: 0,
    uncounted: 0,
    recapShoutout: null,
    recapSentAt: null,
    recapAutoSendPaused: false,
    recapAutoSendAt: null,
    recapFailed: false,
    ended: true,
    photos: [],
    crewPhotos: [],
    ...overrides,
  };
}

function evening(
  departures: CloseoutDeparture[],
  overrides: Partial<Omit<EveningReading, "close">> = {},
): EveningReading {
  return {
    close: assembleEveningClose(departures, NOW),
    headCountCloses: new Map(),
    recapEditors: new Map(),
    canOpenLog: true,
    leftovers: [],
    latest: null,
    closeCount: 0,
    firstEver: false,
    ...overrides,
  };
}

function renderSpine({
  departures = [departure()],
  actions = [],
  tomorrow = [],
  ...props
}: {
  departures?: SpineDeparture[];
  actions?: TodayAction[];
  tomorrow?: SpineDeparture[];
  withheldCount?: number;
  showPaymentsRow?: boolean;
  crewedTripIds?: string[];
  sessions?: React.ReactNode;
  firstRun?: React.ReactNode;
  firstBooking?: FirstBooking | null;
  factOfScale?: FactOfScale | null;
  evening?: EveningReading;
} = {}) {
  return render(
    <DaySpine
      spine={assembleDaySpine({ departures, actions }, { departures: tomorrow, actions: [] })}
      shopSlug="blue-mantis"
      shopName="Blue Mantis"
      locale="en-US"
      timeZone="America/New_York"
      currency="usd"
      inviteAction={inviteAction}
      now={NOW}
      {...props}
    />,
  );
}

/**
 * **A departure's facts are said once.** This is principle 9 at page scale and
 * the reason the day spine exists: the board it replaced repeated one boat's
 * title on every queue row that hung off it.
 */
describe("a station owns its departure's facts", () => {
  it("renders the departure's title exactly once, and no row repeats it", () => {
    renderSpine({
      actions: [
        action({ id: "r1", subject: "Priya Sharma", departure: boat("t1") }),
        action({ id: "r2", subject: "Grace Mensah", departure: boat("t1") }),
        action({
          id: "r3",
          subject: "Two-Tank Reef",
          aboutDeparture: true,
          kind: "dive_prep",
          detail: "3 divers still need rental sizes.",
          departure: boat("t1"),
        }),
      ],
    });
    // Once, in the station header — never again beneath it, not even by the
    // row that is *about* the departure, which leads with its detail instead.
    expect(screen.getAllByText("Two-Tank Reef")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Two-Tank Reef/ })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t1",
    );
    expect(screen.getByText("3 divers still need rental sizes.")).toBeInTheDocument();
  });

  it("says the site, hull, crew and price on the station's own line", () => {
    renderSpine();
    expect(
      screen.getByText("Molasses Reef · Mantis II · Keiko Tanaka · $95.00"),
    ).toBeInTheDocument();
  });

  it("leads the head count as a figure with the open spots beneath it", () => {
    renderSpine();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("of 12")).toBeInTheDocument();
    expect(screen.getByText("2 spots open")).toBeInTheDocument();
  });

  it("says Full rather than nought spots open on a boat with no seats left", () => {
    renderSpine({ departures: [departure({ booked: 12 })] });
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.queryByText(/spots? open/)).toBeNull();
  });

  it("draws the head count as a dial whose water is the shallows, standing at booked-of-capacity", () => {
    const { container } = renderSpine();
    // Reef's one decorative fill token, and never a state: the figure over
    // the water and the words beside it carry the fact (ADR
    // 20260901-diveday-reimagined, decision 1 — "water fills that carry no
    // fact").
    const water = container.querySelector("[data-station-water]");
    expect(water).not.toBeNull();
    expect(water?.className).toContain("bg-shallows");
    expect(water?.getAttribute("aria-hidden")).toBe("true");
    expect((water as HTMLElement).style.transform).toBe("scaleY(0.83)");
    expect(container.querySelector(".bg-muted.opacity-30")).toBeNull();
  });

  it("gives the next boat's site mark the surface's one coral detail, and the rest none", () => {
    const { container } = renderSpine({
      departures: [
        departure({ tripId: "sailed", title: "Dawn Patrol", startsAt: hoursFromNow(-3) }),
        departure({ tripId: "next", title: "Two-Tank Reef", startsAt: hoursFromNow(2) }),
        departure({ tripId: "later", title: "Wreck Trip", startsAt: hoursFromNow(6) }),
      ],
    });
    // A boat that left more than the hour's buffer ago is not "next"; the
    // one after it is, and only it wears the warm detail.
    const marks = [...container.querySelectorAll("[data-site-mark]")];
    expect(marks).toHaveLength(3);
    const coral = marks.map((mark) => mark.querySelectorAll('[fill="var(--accent)"]').length);
    expect(coral).toEqual([0, 1, 0]);
  });

  it("swaps the site mark's wash and ink for a boat that leaves after dark", () => {
    // 23:30 UTC is 7:30 PM in Key Largo — the fiction's night dive.
    const { container } = renderSpine({
      departures: [departure({ startsAt: new Date("2026-08-27T23:30:00Z") })],
    });
    expect(container.querySelector("[data-site-mark]")?.className).toContain("bg-primary-hover");
  });

  it("badges the reader's own boat without moving it up the clock", () => {
    renderSpine({
      departures: [
        departure({ tripId: "morning", title: "Morning Reef", startsAt: hoursFromNow(1) }),
        departure({ tripId: "wreck", title: "Wreck Trip", startsAt: hoursFromNow(6) }),
      ],
      crewedTripIds: ["wreck"],
    });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    expect(headings[0]).toContain("Morning Reef");
    expect(headings[1]).toContain("Wreck Trip");
    expect(headings[1]).toContain("You’re crewing");
  });
});

/**
 * **The station is a panel** — ADR 20260904-reef-all-the-way-down, decision 1,
 * slice 16a. Reef drew each departure as a `SectionCard` with the site tile
 * leading; the first slices shipped the tokens into a three-column rail. The
 * rules here are the ones the canvas measured the gap against: the panel, the
 * tile inside it, the capacity inside the dial, and the log door at reading
 * weight — present on every live station, never at button weight.
 */
describe("the station is a panel (16a)", () => {
  it("renders each live station as a SectionCard on the bed, never as a rail", () => {
    const { container } = renderSpine({
      departures: [
        departure({ tripId: "a", title: "Morning Reef", startsAt: hoursFromNow(1) }),
        departure({ tripId: "b", title: "Wreck Trip", startsAt: hoursFromNow(6) }),
      ],
    });
    const stations = [...container.querySelectorAll("ol > li")];
    expect(stations).toHaveLength(2);
    for (const station of stations) {
      expect(station.className).toContain("rounded-panel");
      expect(station.className).toContain("shadow-bed");
    }
    // The rail is gone: no column grid, no drawn line for the tile to sit on.
    expect(container.querySelector('[class*="grid-cols-[112px_112px_1fr]"]')).toBeNull();
  });

  it("puts the site tile inside the panel, leading the header", () => {
    const { container } = renderSpine();
    const station = container.querySelector("ol > li");
    const mark = station?.querySelector("[data-site-mark]");
    expect(mark).not.toBeNull();
    // Leading: the first element child of the header row is the tile.
    expect(mark?.parentElement?.firstElementChild).toBe(mark);
  });

  it("keeps the capacity inside the dial and the open count beside it", () => {
    const { container } = renderSpine();
    const water = container.querySelector("[data-station-water]");
    const dial = water?.parentElement;
    if (!dial) throw new Error("no dial rendered");
    expect(within(dial as HTMLElement).getByText("10")).toBeInTheDocument();
    expect(within(dial as HTMLElement).getByText("of 12")).toBeInTheDocument();
    expect(within(dial as HTMLElement).queryByText("2 spots open")).toBeNull();
    expect(screen.getByText("2 spots open")).toBeInTheDocument();
  });

  it("offers the departure log on a live station as a quiet link, never a button", () => {
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      evening: evening([]),
    });
    const door = screen.getByRole("link", { name: "Generate log" });
    expect(door).toHaveAttribute("href", "/shop/blue-mantis/trips/t1/log");
    // `buttonClass()` always emits the control rung; the door is a text link.
    expect(door.className).not.toContain("rounded-lg");
    expect(door.className).toContain("text-primary");
  });

  it("renders a settled station as the same panel", () => {
    const { container } = renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })]),
    });
    const station = container.querySelector("ol > li");
    expect(station?.className).toContain("rounded-panel");
    expect(container.querySelector('[class*="grid-cols-[112px_112px_1fr]"]')).toBeNull();
  });

  it("says a row as one line: the person, then the sentence", () => {
    renderSpine({
      actions: [
        action({
          id: "r1",
          subject: "Priya Sharma",
          detail: "Waiver has not been sent.",
          departure: boat("t1"),
        }),
      ],
    });
    const subject = screen.getByText("Priya Sharma");
    const detail = screen.getByText("Waiver has not been sent.");
    // One `<p>` holds both halves; nothing stacks the sentence under the name.
    expect(subject.parentElement).toBe(detail.parentElement);
    expect(subject.parentElement?.tagName).toBe("P");
  });
});

/**
 * The two safety sentences the departure card carried and the station keeps —
 * neither is a job anyone taps here, and both describe a checkpoint (issues
 * #789, #791). Every case below is as much about the sentence *not* rendering.
 */
describe("a station's safety notes", () => {
  it("names a lone blocked diver who is already aboard, and why", () => {
    renderSpine({
      departures: [
        departure({
          booked: 4,
          boarded: 4,
          blocked: 1,
          blockedAboardGroups: [{ kind: "medical", names: ["Grace Mensah"] }],
        }),
      ],
    });
    expect(screen.getByText(/Grace Mensah is aboard with/)).toBeInTheDocument();
  });

  it("renders one line per kind, never one reason spread over a whole count", () => {
    renderSpine({
      departures: [
        departure({
          booked: 5,
          boarded: 5,
          blocked: 5,
          blockedAboardGroups: [
            { kind: "medical", names: ["Grace Mensah"] },
            { kind: "certification", names: ["Tomás Ferreira", "Ines Costa", "June Park", "Omar"] },
          ],
        }),
      ],
    });
    expect(screen.getByText(/Grace Mensah is aboard with/)).toBeInTheDocument();
    expect(screen.getByText(/4 divers are aboard with/)).toBeInTheDocument();
  });

  it("says the crew roll call is open on a full boat nobody has counted the crew on", () => {
    renderSpine({
      departures: [
        departure({
          booked: 6,
          boarded: 6,
          blocked: 0,
          crewAccountedFor: false,
          crewReason: "crew_awaiting",
        }),
      ],
    });
    expect(screen.getByText(/crew roll call is still open/)).toBeInTheDocument();
  });

  it("says nothing about the crew roll call when the boat has no crew rostered at all", () => {
    // That is a coverage gap the spine already raises as its own row; saying it
    // twice on one screen buys nothing.
    renderSpine({
      departures: [
        departure({
          booked: 6,
          boarded: 6,
          blocked: 0,
          crewAccountedFor: false,
          crewReason: "crew_none_assigned",
        }),
      ],
    });
    expect(screen.queryByText(/crew roll call is still open/)).toBeNull();
  });

  it("celebrates nothing on a boat that is fully aboard — the coral belongs to the day, not the boat", () => {
    // "Everyone's aboard" was a coral moment per departure; the ADR's coral
    // table gives the home exactly one morning moment, and this is not it.
    renderSpine({
      departures: [departure({ booked: 6, boarded: 6, blocked: 0 })],
    });
    expect(screen.queryByText(/Everyone’s aboard/)).toBeNull();
    expect(screen.queryByText(/clear to board/)).toBeNull();
  });
});

/** A `TodayAction` with no `tripId` belongs to nobody's boat. */
describe("the desk group", () => {
  it("files a row with no departure under 'At the desk'", () => {
    renderSpine({
      actions: [
        action({ id: "on-boat", subject: "Priya Sharma", departure: boat("t1") }),
        action({
          id: "chore",
          kind: "reviews_pending",
          subject: "1 review",
          detail: "One review is waiting on you.",
        }),
      ],
    });
    const desk = screen.getByText("At the desk").closest("div");
    expect(desk).not.toBeNull();
    expect(
      within(desk as HTMLElement).getByText("One review is waiting on you."),
    ).toBeInTheDocument();
    expect(within(desk as HTMLElement).queryByText("Priya Sharma")).toBeNull();
  });

  it("renders no desk group at all when nothing is bound to the desk", () => {
    renderSpine({ actions: [action({ id: "on-boat", departure: boat("t1") })] });
    expect(screen.queryByText("At the desk")).toBeNull();
  });

  it("carries the quiet payments row, pointing at settings, when the shop is asked to connect", () => {
    renderSpine({
      actions: [action({ id: "on-boat", departure: boat("t1") })],
      showPaymentsRow: true,
    });
    expect(
      screen.getByText("Payments aren’t connected, so divers can book and pay at the counter."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open payment settings" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings#stripe",
    );
  });

  it("renders no payments row once the shop can take payment", () => {
    renderSpine({ actions: [action({ id: "on-boat", departure: boat("t1") })] });
    expect(screen.queryByText(/Payments aren’t connected/)).toBeNull();
  });
});

/**
 * The two good-news moments (principles.md §3). These assertions moved here
 * from `TodayQueue.test.tsx` when the queue became the spine; the conditions
 * are restated in spine terms and nothing was dropped.
 */
describe("the good-news moments", () => {
  it("celebrates once today's stations carry nothing pressing but later work remains", () => {
    renderSpine({
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.getByText("Today's boats are all clear 🤙")).toBeInTheDocument();
  });

  it("keeps the 🤙 — the product's one word-mark gesture, inside the sentence", () => {
    renderSpine({
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.getByRole("status").textContent).toContain("🤙");
  });

  it("stays quiet while a station still carries a blocking row", () => {
    renderSpine({
      actions: [
        action({ id: "blocked", kind: "waiver", departure: boat("t1") }),
        action({ id: "later", kind: "dive_prep", departure: boat("t9") }),
      ],
    });
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
  });

  it("stays quiet while the desk still carries one", () => {
    renderSpine({
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "stuck", kind: "stuck_payment_operation" }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
  });

  it("never doubles up with the whole-week 🤙 state", () => {
    renderSpine({ actions: [] });
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the schedule" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board",
    );
  });

  it("renders neither once there is real work anywhere", () => {
    renderSpine({ actions: [action({ id: "blocked", departure: boat("t1") })] });
    expect(screen.queryByText("Nothing is waiting on you")).toBeNull();
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
  });

  it("puts the earned line above the first station, where the summary sentence ends", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    const line = screen.getByRole("status");
    const firstStation = container.querySelector("ol li");
    expect(firstStation).not.toBeNull();
    expect(
      line.compareDocumentPosition(firstStation as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/**
 * **Day zero is a state of this spine, never a wizard** — ADR
 * 20260827-first-light, decision 6. The setup ledger leads the same column of
 * work every other morning is, rather than replacing the page with a mode.
 */
describe("the first morning", () => {
  const ledger = <p data-testid="first-run">First morning</p>;

  it("leads the spine, above everything else on it", () => {
    // A station under it purely so there is something for the group to be
    // *above*: the shop this composition is for has no departures at all, and
    // what is being pinned here is the spine's own order.
    const { container } = renderSpine({ firstRun: ledger });
    const group = screen.getByTestId("first-run");
    const stations = container.querySelector("ol");
    expect(stations).not.toBeNull();
    expect(
      group.compareDocumentPosition(stations as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stands the queue's own good-news state down: this shop has no roster to praise", () => {
    // "Nothing is waiting on you" is a claim about a week of divers. A shop
    // that has never had a departure has none, and it read directly beneath
    // the step telling it to schedule its first trip (issue #711).
    renderSpine({ firstRun: ledger, departures: [], actions: [] });
    expect(screen.queryByText("Nothing is waiting on you")).toBeNull();
  });

  it("still renders the queue's good-news state for a shop past its first run", () => {
    renderSpine({ departures: [], actions: [] });
    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument();
  });
});

/**
 * **The shop's first booking ever, and then never again** — ADR
 * 20260827-first-light, decision 6, taking the coral budget's "the home, once
 * ever" row (20260827-clearwater-surface-language, decision 11).
 *
 * Whether the moment is *live* is `shopFirstBooking`'s question and is pinned
 * in `src/db/first-booking.test.ts`; what this file owns is the surface's own
 * rule — one coral element at a time, and which one wins when two are true.
 */
describe("the first booking ever", () => {
  const mark: FirstBooking = {
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
  };

  it("says the moment in words beside the coral, and puts the seat under it", () => {
    renderSpine({ firstBooking: mark, actions: [action({ id: "b", departure: boat("t1") })] });
    expect(screen.getByText("Your first booking")).toBeInTheDocument();
    expect(screen.getByText("Ravi Chandra")).toBeInTheDocument();
    expect(screen.getByText(/paid \$95/)).toBeInTheDocument();
    expect(screen.getByText("waiver signed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Two-Tank — Alligator Reef" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t9",
    );
  });

  it("renders nothing at all once the moment has passed", () => {
    renderSpine({ firstBooking: null, actions: [action({ id: "b", departure: boat("t1") })] });
    expect(screen.queryByText("Your first booking")).toBeNull();
  });

  it("outranks the morning all-clear: one happens once, the other on a good Tuesday", () => {
    renderSpine({
      firstBooking: mark,
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.getByText("Your first booking")).toBeInTheDocument();
    expect(screen.queryByText("Today's boats are all clear 🤙")).toBeNull();
  });

  it("yields to the evening: a boat that came home is the later moment", () => {
    renderSpine({
      firstBooking: mark,
      departures: [],
      evening: evening([closed({ tripId: "t1" })]),
    });
    expect(screen.getByText(/All boats are home/)).toBeInTheDocument();
    expect(screen.queryByText("Your first booking")).toBeNull();
  });
});

describe("the role lens", () => {
  it("keeps the withheld-work line under the summary sentence, above the first station", () => {
    const { container } = renderSpine({
      actions: [action({ id: "on-boat", departure: boat("t1") })],
      withheldCount: 3,
    });
    const line = screen.getByText("3 jobs for the front desk");
    const firstStation = container.querySelector("ol li");
    expect(
      line.compareDocumentPosition(firstStation as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no withheld line for a reader nothing was withheld from", () => {
    renderSpine({ actions: [action({ id: "on-boat", departure: boat("t1") })] });
    expect(screen.queryByText(/jobs? for the front desk/)).toBeNull();
  });

  it("renders the instructor's own group between the summary and the first station", () => {
    const { container } = renderSpine({
      actions: [action({ id: "on-boat", departure: boat("t1") })],
      sessions: <p data-testid="your-sessions">Your sessions</p>,
    });
    const sessions = screen.getByTestId("your-sessions");
    const firstStation = container.querySelector("ol li");
    expect(
      sessions.compareDocumentPosition(firstStation as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the two horizon rows", () => {
  it("collapses tomorrow behind the one disclosure spelling, with its counts on the label", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({ id: "tomorrow", departure: boat("t2") }),
      ],
      tomorrow: [departure({ tripId: "t2", title: "Night Dive", startsAt: hoursFromNow(26) })],
    });
    const fold = container.querySelector("details");
    expect(fold).not.toBeNull();
    expect(fold?.open).toBe(false);
    expect(screen.getByText(/1 departure · 1 job/)).toBeInTheDocument();
    // Folding hides; it never drops. Tomorrow's station is in the DOM, drawn by
    // the same renderer as today's, one native toggle away.
    expect(within(fold as HTMLElement).getByRole("link", { name: /Night Dive/ })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t2",
    );
  });

  it("uses the same row grammar for Tomorrow and This week", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({ id: "tomorrow", departure: boat("t2") }),
        action({ id: "friday", departure: boat("t9") }),
      ],
      tomorrow: [departure({ tripId: "t2", title: "Night Dive", startsAt: hoursFromNow(26) })],
    });

    // Two tideline panels side by side (the board's "Later, collapsed"): the
    // same sunken fill, the same panel radius, the same row height, no bed.
    const fold = container.querySelector("details");
    expect(fold).toHaveClass("sm:rounded-panel", "sm:bg-surface-sunken", "open:sm:col-span-2");
    expect(fold?.parentElement).toHaveClass("sm:grid-cols-2");
    const summary = container.querySelector("details summary");
    expect(summary).toHaveClass("min-h-14");
    expect(summary?.querySelector("h2")).toHaveClass("text-base", "font-semibold");
    // The caret is at the row's trailing edge, like the week link's chevron.
    expect(summary?.lastElementChild?.tagName).toBe("svg");

    const week = screen.getByText("This week").closest("li");
    expect(week).toHaveClass("min-h-14", "sm:rounded-panel");
    expect(week?.parentElement).toHaveClass("sm:rounded-panel", "sm:bg-surface-sunken");
    expect(fold?.className).not.toContain("shadow-bed");
    expect(screen.getByText("This week")).toHaveClass("text-base", "font-semibold");
  });

  it("renders no Tomorrow row on a day with nothing sailing tomorrow", () => {
    renderSpine({ actions: [action({ id: "today", departure: boat("t1") })] });
    expect(screen.queryByText(/^Tomorrow/)).toBeNull();
  });

  it("makes 'This week' a plain link to the board with nothing to expand", () => {
    renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({ id: "friday", departure: boat("t9") }),
      ],
    });
    const week = screen.getByText("This week").closest("li");
    expect(week).not.toBeNull();
    expect(week?.querySelector("details")).toBeNull();
    expect(within(week as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board",
    );
  });

  it("renders no 'This week' row when the rest of the week is clear", () => {
    renderSpine({ actions: [action({ id: "today", departure: boat("t1") })] });
    expect(screen.queryByText("This week")).toBeNull();
  });

  it("points neither horizon row at a queue view — there is no longer one", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({ id: "tomorrow", departure: boat("t2") }),
        action({ id: "friday", departure: boat("t9") }),
      ],
      tomorrow: [departure({ tripId: "t2", startsAt: hoursFromNow(26) })],
    });
    for (const link of container.querySelectorAll("a")) {
      expect(link.getAttribute("href")).not.toContain("view=");
    }
  });
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
    // one tap away, not from a button on the spine. The door appears twice —
    // once as the row, once lifted into the "First thing" panel above it —
    // and both point at the same checkpoint.
    const doors = screen.getAllByRole("link", { name: "Open roll call" });
    expect(doors).toHaveLength(2);
    for (const door of doors) {
      expect(door).toHaveAttribute(
        "href",
        "/shop/blue-mantis/trips/t1/manifest?checkpoint=after_dive_2",
      );
    }
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
        spine={assembleDaySpine(
          {
            departures: [departure()],
            actions: [
              action({
                ...missing,
                id: "blocker:booking-1:waiver_pending",
                detail: "Waiver is waiting for the diver’s signature.",
                actionLabel: "Nudge waiver",
              }),
            ],
          },
          { departures: [], actions: [] },
        )}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        locale="en-US"
        timeZone="America/New_York"
        currency="usd"
        inviteAction={inviteAction}
        now={NOW}
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
      withheldCount: 2,
    });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b(she|he|her|hers|his|him|they|them|their|theirs)\b/i);
  });
});

/**
 * **The evening reading** — ADR 20260827-clearwater-surface-language, decision
 * 4, and H-62, which removed `/close-out` in the same change that shipped
 * this.
 *
 * Two of these are the slice's named pins: the closing block never renders
 * while a departure is still out, and no acknowledgement gate stands on the
 * closing act. The rest hold the coral budget's one-element rule and the log
 * door's owner gate.
 */
describe("the evening reading", () => {
  it("never renders the closing block while a departure is still out", () => {
    // **The pin.** One boat home, one due back in an hour. Nothing on this
    // page may suggest the day is over — no leftovers group, no closing act.
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

    expect(screen.queryByRole("button", { name: "Close the day" })).toBeNull();
    expect(screen.queryByText("Still open — carries to tomorrow")).toBeNull();
    // The station itself is there, and says which state it is in — in words,
    // never in colour alone.
    expect(screen.getByText("Still out")).toBeInTheDocument();
  });

  it("renders the closing block once every departure of the day has settled", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" }), closed({ tripId: "t2", title: "Wreck Trip" })], {
        leftovers: [action({ id: "leftover-1", subject: "Lena Fischer" })],
      }),
    });

    expect(screen.getByRole("button", { name: "Close the day" })).toBeInTheDocument();
    expect(screen.getByText("Still open — carries to tomorrow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("gives a desk action one owner when close-out also carries it", () => {
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
      evening: evening([closed({ tripId: "t1" })], { leftovers: [units] }),
    });

    expect(screen.getAllByText("Confirm the shop units", { exact: true })).toHaveLength(1);
    expect(screen.queryByText("At the desk")).toBeNull();
    expect(screen.getByText("Still open — carries to tomorrow")).toBeInTheDocument();
  });

  it("puts no acknowledgement control on the closing act, at any leftover count", () => {
    // **The pin.** The surface this replaced made a staffer tick "I have seen
    // the open head count" before it would record the act — a confirm on
    // something reversible, re-asking a decision H-57 has the shop making per
    // row. There is no checkbox here at any count, and none when the day's
    // own head count is the thing still open.
    for (const leftovers of [
      [],
      [action({ id: "l1" })],
      [action({ id: "l1" }), action({ id: "l2" })],
    ]) {
      cleanup();
      renderSpine({
        departures: [],
        evening: evening(
          [
            closed({
              tripId: "t1",
              status: "unreconciled",
              gapReason: "missing_diver",
              diveNumber: 1,
              uncounted: 1,
            }),
          ],
          { leftovers },
        ),
      });
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Close the day" })).toBeInTheDocument();
    }
  });

  it("offers the departure log only to a reader who may generate one", () => {
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1" })]) });
    expect(screen.getByRole("link", { name: "Generate log" })).toBeInTheDocument();

    cleanup();
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], { canOpenLog: false }),
    });
    // Absent, never disabled — the gate is the render (AGENTS.md).
    expect(screen.queryByRole("link", { name: "Generate log" })).toBeNull();
  });

  it("offers it on a departure that has not come home, which is when it is wanted", () => {
    // ADR 20260804-incident-export-owner-gate's 2026-08-12 amendment, verbatim:
    // *offered on every departure row, not only the ones that are back, because
    // the moment a shop most needs a departure's recorded facts is while the
    // departure is still happening.* Moving the door onto the evening's station
    // in 6d dropped it from the live one, which put an owner whose boat is
    // overdue in the one place they could not reach the record of who is on it.
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      evening: evening([closed({ tripId: "t2", title: "Dawn Wall" })]),
    });
    const live = screen.getByRole("link", { name: "Two-Tank Reef" }).closest("li");
    if (!live) throw new Error("the live departure did not render a station");
    expect(within(live).getByRole("link", { name: "Generate log" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t1/log",
    );

    cleanup();
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      evening: evening([closed({ tripId: "t2", title: "Dawn Wall" })], { canOpenLog: false }),
    });
    expect(screen.queryByRole("link", { name: "Generate log" })).toBeNull();
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
    expect(screen.getByText(/10 of 10 back by/)).toBeInTheDocument();
    expect(screen.getByText("head count closed by Keiko Tanaka")).toBeInTheDocument();
  });

  it("marks the day's homecoming once, and only when every count closed clean", () => {
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1", booked: 10 })]) });

    const line = screen.getAllByText("All boats are home: 10 out, 10 back.");
    expect(line).toHaveLength(1);
    expect(line[0]).toHaveAttribute("role", "status");
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
    expect(screen.getByText("Your first boat is home: 3 out, 3 back.")).toBeInTheDocument();
    expect(screen.queryByText(/All boats are home/)).toBeNull();
  });

  it("never renders two coral elements: the recorded close takes the line's place", () => {
    // The coral table allows a surface exactly one moment at a time, and the
    // record of the close *is* the homecoming, kept. The line stands down for
    // it rather than sitting above it.
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1", booked: 10 })], {
        latest: {
          id: "close-1",
          shopDay: "2026-08-27",
          closedAt: hoursFromNow(-1),
          actorName: "Dana Reyes",
          outstanding: { departures: [], leftovers: [], adminTasks: [] },
        },
        closeCount: 1,
      }),
    });

    expect(screen.queryByText(/All boats are home/)).toBeNull();
    expect(screen.getByText(/Closed by Dana Reyes at/)).toBeInTheDocument();
    // The panel is coral, so it says its state in words too.
    expect(screen.getByText("Nothing was outstanding.")).toBeInTheDocument();
    // A record is not a lock: the act is still there, worded as a repeat.
    expect(screen.getByRole("button", { name: "Close the day again" })).toBeInTheDocument();
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
    expect(screen.getAllByText("Night Dive")).toHaveLength(1);
  });
});

/**
 * The row's glyph — the first of the anatomy's four parts (glyph, one word of
 * kind, one sentence, one fix). Reef's board draws it; it was the one part the
 * spine's rows did not carry until 2026-09-02.
 */
describe("the row glyph", () => {
  it("leads every row with the status family's shape for its tone, never a drawing", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "danger", kind: "medical_review", departure: boat("t1") }),
        action({ id: "warning", kind: "waiver", departure: boat("t1") }),
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
      ],
    });
    const rows = [...container.querySelectorAll("ol li ul li")];
    expect(rows).toHaveLength(3);
    const inks = rows.map((row) => row.querySelector("span > svg")?.getAttribute("class") ?? "");
    expect(inks[0]).toContain("text-danger");
    expect(inks[1]).toContain("text-warning-strong");
    expect(inks[2]).toContain("text-muted");
    // From the shipped status family: a drawing is never a status glyph.
    for (const row of rows) expect(row.querySelector("[data-site-mark]")).toBeNull();
  });
});

/**
 * The one obvious next action (H-62), lifted above the spine as the board's
 * "First thing" panel: the next boat's first danger-toned door, once.
 */
describe("the first thing", () => {
  it("lifts the next boat's first blocking door into one panel with its fix as the primary", () => {
    renderSpine({
      actions: [
        action({
          id: "medical",
          kind: "medical_review",
          subject: "Grace Mensah",
          detail: "Medical answers need a look before she boards.",
          actionLabel: "Verify it",
          href: "/shop/blue-mantis/divers/p1",
          departure: boat("t1"),
        }),
        action({ id: "waiver", kind: "waiver", departure: boat("t1") }),
      ],
    });
    const panel = screen.getByRole("region", { name: /^First thing · / });
    expect(within(panel).getByText("Grace Mensah")).toBeInTheDocument();
    expect(
      within(panel).getByText("Medical answers need a look before she boards."),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Verify it" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/p1",
    );
    // The row beneath still stands: the panel repeats it, it does not move it.
    expect(screen.getAllByRole("link", { name: "Verify it" })).toHaveLength(2);
  });

  it("renders nothing when the next boat's loudest row is only a warning, or performs its fix inline", () => {
    renderSpine({
      actions: [action({ id: "waiver", kind: "waiver", departure: boat("t1") })],
    });
    expect(screen.queryByText(/^First thing/)).toBeNull();
    cleanup();
    // A danger row that sends its own waiver keeps its control on the row.
    renderSpine({
      actions: [
        action({
          id: "medical",
          kind: "medical_review",
          departure: boat("t1"),
          waiver: { bookingIds: ["b1"] },
        }),
      ],
    });
    expect(screen.queryByText(/^First thing/)).toBeNull();
  });

  it("reads the next boat, not the first on the page", () => {
    renderSpine({
      departures: [
        departure({ tripId: "sailed", title: "Dawn Patrol", startsAt: hoursFromNow(-3) }),
        departure({ tripId: "t1", startsAt: hoursFromNow(2) }),
      ],
      actions: [
        action({
          id: "gone",
          kind: "medical_review",
          subject: "Left behind",
          departure: boat("sailed", "Dawn Patrol"),
        }),
        action({
          id: "next",
          kind: "identity",
          subject: "Nadia Petrov",
          departure: boat("t1"),
        }),
      ],
    });
    const panel = screen.getByRole("region", { name: /^First thing/ });
    expect(within(panel).getByText("Nadia Petrov")).toBeInTheDocument();
    expect(within(panel).queryByText("Left behind")).toBeNull();
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
    expect(container.textContent).not.toMatch(/Out on|Heading in|On the surface/);
    // The word this app refuses to say about a boat nobody has spoken for.
    expect(container.textContent).not.toMatch(/unknown/i);
  });

  it("carries the crew's word, the site and the time they said it", () => {
    withStage("underway");
    expect(screen.getByText(/Out on Molasses Reef · /)).toBeInTheDocument();
  });

  it("falls back to the siteless word on a departure with no plan", () => {
    renderSpine({
      departures: [
        {
          ...departure(),
          stage: { ...stationStage("underway"), siteName: null },
        },
      ],
      actions: [action({ id: "b", departure: boat("t1") })],
    });
    expect(screen.getByText(/Out on the water · /)).toBeInTheDocument();
  });
});

/** A crew's tap, at a fixed instant, for the chip cases above. */
function stationStage(stage: "boarding" | "underway" | "surface" | "heading_in" | "home") {
  return {
    stage,
    siteName: "Molasses Reef",
    recordedAt: new Date("2026-07-21T11:20:00.000Z"),
    recordedByName: "Keiko Tanaka",
  };
}
