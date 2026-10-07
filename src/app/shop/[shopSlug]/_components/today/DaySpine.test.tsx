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
}));

import type { FirstBooking } from "@/db/first-booking";
import type { DayTakings as DayTakingsReading } from "@/lib/closeout";
import { assembleEveningClose, type CloseoutDeparture } from "@/lib/closeout";
import { DaySpine, type EveningReading, type SpineDraft } from "./DaySpine";

afterEach(() => {
  cleanup();
});

const NOW = new Date("2026-08-27T11:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

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
  const booked = overrides.booked ?? 10;
  return {
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(-6),
    endsAt: hoursFromNow(-3),
    booked,
    // Nobody was marked absent, so the boat carried its whole roster — a case
    // about a no-show sets `sailed` lower (issue #1689).
    sailed: booked,
    capacity: 12,
    plannedDives: 2,
    // Two crew, both counted back at the closing checkpoint — the shape a
    // settled departure has once the day's counting is done (issue #1346).
    crew: [{ rollCall: { state: "boarded" } }, { rollCall: { state: "boarded" } }],
    openSeats: null,
    planChanges: [],
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
    takings: null,
    headCountCloses: new Map(),
    recapEditors: new Map(),
    canOpenLog: true,
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
  drafts?: SpineDraft[];
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
  it("names each row's boat itself, now that the rows are one list under the departures", () => {
    renderSpine({
      actions: [
        action({ id: "r1", subject: "Priya Sharma", departure: boat("t1") }),
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
    // The card links the departure once; each row says its boat by the label
    // the reader composed, so a row lifted out of the card still names it.
    expect(screen.getByRole("link", { name: /^Two-Tank Reef$/ })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/t1",
    );
    const needsYou = screen.getByText("Needs you").closest("div")?.parentElement as HTMLElement;
    // Both rows say their boat on a quiet line under their words.
    const labels = within(needsYou).getAllByText("Two-Tank Reef · 7:00 AM");
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label).toHaveClass("text-muted");
    expect(within(needsYou).getByText("3 divers still need rental sizes.")).toBeInTheDocument();
    expect(within(needsYou).getByText("Priya Sharma")).toBeInTheDocument();
  });

  /**
   * What the divers aboard came for, as one counted line (D12/#1172 with
   * D23/#1183, issue #1386). It rendered only inside the manifest's collapsed
   * buddy panel until now, so a shop could collect answers for weeks and meet
   * them only by opening a fold on a safety surface.
   *
   * The two cases that matter are the two ends: a station nobody answered on
   * must render *nothing* — not a heading over an empty list — and a station
   * with answers must name the counts and no diver.
   */
  it("renders no extra line on a station whose bookings carry no intent", () => {
    renderSpine({ departures: [departure({ intents: [] })] });
    expect(screen.queryByText(/Aboard today/)).toBeNull();
  });

  it("counts what the divers came for, naming numbers and nobody", () => {
    renderSpine({
      departures: [
        departure({
          intents: [
            { intent: "good_day", count: 4 },
            { intent: "easing_back", count: 2 },
          ],
        }),
      ],
    });
    const line = screen.getByText(/Aboard today/);
    expect(line).toHaveTextContent("4 out for a good day");
    expect(line).toHaveTextContent("2 getting comfortable again");
    // An aggregate, never a pairing: no diver is named by it.
    expect(line).not.toHaveTextContent("Keiko Tanaka");
    expect(line.textContent).not.toMatch(/Priya|Grace|Yara/);
  });

  it("says the site, hull, crew and price on the station's own line", () => {
    renderSpine();
    const line = screen.getByText(
      (_, element) =>
        element?.tagName === "P" &&
        element.textContent === "Molasses Reef · Mantis II · Keiko Tanaka · $95.00",
    );
    expect(line).toBeInTheDocument();
    // The crew's names are the desktop's: below `sm` the line is the site,
    // the hull and the price (phone text density pass).
    expect(within(line).getByText("Keiko Tanaka", { exact: false })).toHaveClass("max-sm:hidden");
    expect(within(line).getByText("Molasses Reef", { exact: false })).not.toHaveClass(
      "max-sm:hidden",
    );
  });

  it("says how many of the booked divers are ready, and the open spots beside it", () => {
    renderSpine({ departures: [departure({ blocked: 2 })] });
    expect(screen.getByText("8 of 10 ready")).toBeInTheDocument();
    expect(screen.getByText("2 blocked")).toBeInTheDocument();
    expect(screen.getByText("2 spots open")).toBeInTheDocument();
  });

  it("says nothing about blocked divers on a boat whose divers are all ready", () => {
    renderSpine();
    expect(screen.getByText("10 of 10 ready")).toBeInTheDocument();
    expect(screen.queryByText(/blocked/)).toBeNull();
  });

  it("says Full rather than nought spots open on a boat with no seats left", () => {
    renderSpine({ departures: [departure({ booked: 12 })] });
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.queryByText(/spots? open/)).toBeNull();
  });

  it("draws readiness as one bar the boat's capacity wide: ready, then blocked, then open", () => {
    const { container } = renderSpine({ departures: [departure({ blocked: 3 })] });
    const bar = container.querySelector("[data-readiness-bar]");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    const [ready, blocked] = [...(bar?.children ?? [])] as HTMLElement[];
    // 7 ready and 3 blocked of 12 seats; the rest of the bar is the open seats.
    expect(ready?.className).toContain("bg-success");
    expect(ready?.style.width).toBe(`${(7 / 12) * 100}%`);
    expect(blocked?.className).toContain("bg-danger");
    expect(blocked?.style.width).toBe("25%");
  });

  it("wears the departure's stage as a pill, and none when the reader has no phase", () => {
    renderSpine({ departures: [departure({ phase: "checkin" })] });
    expect(screen.getByText("Check-in")).toBeInTheDocument();
    cleanup();
    renderSpine({ departures: [departure({ phase: null })] });
    for (const word of ["Prep", "Check-in", "Aboard", "Back"]) {
      expect(screen.queryByText(word)).toBeNull();
    }
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

  /**
   * **The title's chevron stays with its last word** (pixel-craft class 2,
   * K-464). The link is `inline-flex`, so a title that wrapped became one
   * anonymous flex item and the chevron the next, centred beside the whole
   * block: at 390 it floated 45px right of the text, between the two lines.
   * The title is one run of text now, and its last word and the chevron are
   * one unbreakable unit at the end of it.
   */
  it("keeps the title's chevron with the title's last word", () => {
    renderSpine({ departures: [departure({ title: "Dawn Two-Tank — Molasses Reef" })] });
    const link = screen.getByRole("link", { name: "Dawn Two-Tank — Molasses Reef" });
    const chevron = link.querySelector("svg");
    const unit = chevron?.closest(".whitespace-nowrap");
    expect(unit).not.toBeNull();
    expect(link.contains(unit ?? null)).toBe(true);
    expect(unit?.textContent).toBe("Reef");
    // One run of text: the words before the unit sit in the same element as it.
    expect(unit?.parentElement?.textContent).toBe("Dawn Two-Tank — Molasses Reef");
    // Centred on the line it ends, not on the whole wrapped title.
    expect(chevron?.parentElement).toHaveClass("h-lh", "items-center", "align-top");

    cleanup();
    renderSpine({ departures: [departure({ title: "Snorkel" })] });
    const lone = screen.getByRole("link", { name: "Snorkel" });
    expect(lone.querySelector("svg")?.closest(".whitespace-nowrap")?.textContent).toBe("Snorkel");
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
          detail: "Waiver not signed. Not sent yet.",
          departure: boat("t1"),
        }),
      ],
    });
    const subject = screen.getByText("Priya Sharma");
    const detail = screen.getByText("Waiver not signed. Not sent yet.");
    // One `<p>` holds both halves; nothing stacks the sentence under the name.
    expect(subject.parentElement).toBe(detail.parentElement);
    expect(subject.parentElement?.tagName).toBe("P");
  });
});

/**
 * The one safety sentence the departure card keeps — not a job anyone taps
 * here, and it describes a checkpoint (issue #789). A blocked diver already
 * aboard (issue #791) is a `blocked_aboard` row in Needs you, not a sentence
 * here. Every case below is as much about the sentence *not* rendering.
 */
describe("a station's safety notes", () => {
  it("says nothing on the card about a blocked diver who is already aboard", () => {
    renderSpine({ departures: [departure({ booked: 4, boarded: 4, blocked: 1 })] });
    expect(screen.queryByText(/is aboard with/)).toBeNull();
    expect(screen.queryByText(/are aboard with/)).toBeNull();
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
  it("ranks a row with no departure in the same Needs you list as the boats' rows", () => {
    renderSpine({
      actions: [
        action({ id: "on-boat", kind: "waiver", subject: "Priya Sharma", departure: boat("t1") }),
        action({
          id: "chore",
          kind: "reviews_pending",
          subject: "1 review",
          detail: "One review is waiting on you.",
        }),
      ],
    });
    const needsYou = screen.getByText("Needs you").closest("div")?.parentElement as HTMLElement;
    const rows = within(needsYou).getAllByRole("listitem");
    // Warning before quiet, wherever each row is filed.
    expect(rows[0]).toHaveTextContent("Priya Sharma");
    expect(rows[1]).toHaveTextContent("One review is waiting on you.");
    expect(screen.queryByText("At the desk")).toBeNull();
  });

  it("renders no Needs you list on a day nothing needs anyone", () => {
    renderSpine();
    expect(screen.queryByText("Needs you")).toBeNull();
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

  /**
   * **Every desk row is drawn one way** (pixel-craft class 3, K-317). The
   * payments row had no glyph and no kind, and a draft's row a kind but no
   * glyph, each with a 14px grey sentence — so at 1280 the payments sentence
   * started at the glyph column (x 153) under a Setup row whose sentence
   * starts at 289, in smaller type, and read as that row's continuation.
   */
  it("gives the payments and draft rows the desk's anatomy: glyph, kind, reading-size sentence", () => {
    renderSpine({
      actions: [
        action({ id: "on-boat", departure: boat("t1") }),
        action({
          id: "chore",
          kind: "reviews_pending",
          subject: "1 review",
          detail: "One review is waiting on you.",
        }),
      ],
      showPaymentsRow: true,
      drafts: [{ form: "add_departure", href: "/shop/blue-mantis/schedule/board?add=1" }],
    });
    const sentence = (text: string) => screen.getByText(text).closest("p");
    const chore = sentence("One review is waiting on you.");
    const draft = sentence("A departure you started adding.");
    const payments = sentence(
      "Payments aren’t connected, so divers can book and pay at the counter.",
    );
    expect(chore).toHaveClass("text-base", "leading-snug");
    for (const [row, kind] of [
      [draft, "Unfinished"],
      [payments, "Setup"],
    ] as const) {
      expect(row?.className).toBe(chore?.className);
      const line = row?.closest("li");
      if (!line) throw new Error("the desk row rendered outside a list item");
      // The glyph leads the row, then the kind word, as on every station row.
      expect(line.firstElementChild?.querySelector("svg")).not.toBeNull();
      expect(within(line).getByText(kind)).toBeInTheDocument();
    }
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
    expect(screen.getByText("Today’s boats are all clear")).toBeInTheDocument();
  });

  it("stays quiet while a station still carries a blocking row", () => {
    renderSpine({
      actions: [
        action({ id: "blocked", kind: "waiver", departure: boat("t1") }),
        action({ id: "later", kind: "dive_prep", departure: boat("t9") }),
      ],
    });
    expect(screen.queryByText("Today’s boats are all clear")).toBeNull();
  });

  it("stays quiet while the desk still carries one", () => {
    renderSpine({
      actions: [
        action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
        action({ id: "stuck", kind: "stuck_payment_operation" }),
        action({ id: "later", kind: "waiver", departure: boat("t9") }),
      ],
    });
    expect(screen.queryByText("Today’s boats are all clear")).toBeNull();
  });

  it("never doubles up with the whole-week empty state", () => {
    renderSpine({ actions: [] });
    expect(screen.queryByText("Today’s boats are all clear")).toBeNull();
    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the schedule" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board",
    );
  });

  it("renders neither once there is real work anywhere", () => {
    renderSpine({ actions: [action({ id: "blocked", departure: boat("t1") })] });
    expect(screen.queryByText("Nothing is waiting on you")).toBeNull();
    expect(screen.queryByText("Today’s boats are all clear")).toBeNull();
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
    expect(screen.queryByText("Today’s boats are all clear")).toBeNull();
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

  /**
   * **A phone's pair of horizon rows is ruled like any ledger list** (pixel-craft
   * class 6, K-230): a rule above Tomorrow, between the two, and under This
   * week. With the week row present Tomorrow's own top rule was taken away, so
   * the pair had rules between and below and none above, unlike every list on
   * the page.
   */
  it("keeps Tomorrow's top rule on a phone when This week follows it", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({ id: "tomorrow", departure: boat("t2") }),
        action({ id: "friday", departure: boat("t9") }),
      ],
      tomorrow: [departure({ tripId: "t2", title: "Night Dive", startsAt: hoursFromNow(26) })],
    });
    const fold = container.querySelector("details");
    expect(fold?.className).not.toContain("border-t-0");
    expect(fold?.querySelector("summary")).toHaveClass("border-t");
    const week = screen.getByText("This week").closest("li");
    expect(week).toHaveClass("border-t", "last:border-b");
  });

  /**
   * **Hovering a horizon panel changes something you can see** (pixel-craft
   * class 7, K-261). From `sm` up the panels are `bg-surface-sunken`, and the
   * rows inside them hovered to `bg-surface-sunken` too — #ececf1 on #ececf1,
   * a hover that painted nothing. The panel's own edge steps instead, on both
   * doors alike; the rows keep their fills for the phone, where no panel is
   * painted under them.
   */
  it("answers a hover on either horizon door with the panel's edge, not a fill the panel hides", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({ id: "tomorrow", departure: boat("t2") }),
        action({ id: "friday", departure: boat("t9") }),
      ],
      tomorrow: [departure({ tripId: "t2", title: "Night Dive", startsAt: hoursFromNow(26) })],
    });
    const fold = container.querySelector("details");
    const weekPanel = screen.getByText("This week").closest("li")?.parentElement;
    const step = (element: Element | null | undefined) =>
      (element?.className ?? "")
        .split(/\s+/)
        .filter((name) => /has-\[.*:hover.*\]:inset-ring-border-strong$/.test(name));
    expect(step(fold)).toHaveLength(1);
    expect(step(weekPanel)).toEqual(step(fold));
    // Only where a pointer can hover. `hover:` carries Tailwind's
    // `@media (hover: hover)` gate and a `:hover` inside `has-[]` does not, so
    // on a touch tablet a tap that opened Tomorrow left the whole panel ringed
    // until the next tap somewhere else. The step names the gate itself.
    expect(step(fold)[0]).toMatch(/^sm:\[@media\(hover:hover\)\]:has-\[/);
    // Resting, the edge is there and clear, so the hover moves no pixel.
    expect(fold).toHaveClass("sm:inset-ring", "sm:inset-ring-transparent");
    expect(weekPanel).toHaveClass("sm:inset-ring", "sm:inset-ring-transparent");
    // No call site adds a sunken fill of its own inside the sunken panel.
    expect(fold?.className).not.toContain("[&>summary]:hover:bg-surface-sunken");
    const weekRow = screen.getByText("This week").closest("li");
    expect(weekRow?.className.split(/\s+/)).not.toContain("hover:bg-surface-sunken");
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
        spine={assembleDaySpine(
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
        )}
        shopSlug="blue-mantis"
        shopName="Blue Mantis"
        locale="en-US"
        timeZone="America/New_York"
        currency="usd"
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

    expect(screen.getByText("No divers were aboard.")).toBeInTheDocument();
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

  it("renders the open-seats debrief as one row, and nothing at all when the boat filled", () => {
    renderSpine({
      departures: [],
      evening: evening([
        closed({
          tripId: "t1",
          openSeats: {
            openSeats: 4,
            lastBookingDaysOut: 3,
            dealSent: false,
            comparable: null,
          },
        }),
      ]),
    });
    expect(screen.getByText("Unsold seats")).toBeInTheDocument();
    expect(
      screen.getByText(
        "4 seats went unsold: the last booking came in 3 days out and no last-minute deal went out.",
      ),
    ).toBeInTheDocument();
    // No trailing door: the station's own title already opens this departure,
    // and a second path to it from the same panel is what restraint deletes.
    expect(screen.getAllByRole("link", { name: "Two-Tank Reef" })).toHaveLength(1);

    cleanup();
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1" })]) });
    expect(screen.queryByText("Unsold seats")).toBeNull();
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
   * of the mark, so at 390 "head count closed by Sal Moretti" wrapped back
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
    expect(block).toContainElement(screen.getByText("head count closed by Sal Moretti"));
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
    const fold = screen.getByText("2 things for the desk").closest("details");
    if (!fold) throw new Error("the desk rows did not fold");
    expect(fold).not.toHaveAttribute("open");
    expect(within(fold).getByText("Sal Moretti", { exact: false })).toBeInTheDocument();
    expect(within(fold).getByText("1 review", { exact: false })).toBeInTheDocument();
    // Their own boat's row and a danger row on any boat stay in full.
    expect(within(fold).queryByText("Priya Sharma", { exact: false })).toBeNull();
    expect(within(fold).queryByText("Keiko Tanaka", { exact: false })).toBeNull();
    expect(screen.getByText("Priya Sharma", { exact: false })).toBeVisible();
  });

  it("folds nothing for a reader who crews none of today's boats", () => {
    renderSpine({
      departures: [departure({ tripId: "t1" })],
      crewedTripIds: [],
      actions: [action({ id: "o", subject: "Sal Moretti", departure: boat("t1") })],
    });
    expect(screen.queryByText(/for the desk/)).toBeNull();
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
    expect(screen.getByText(/10 divers and 2 crew out, 12 back by/)).toBeInTheDocument();
    expect(screen.getByText("head count closed by Keiko Tanaka")).toBeInTheDocument();
  });

  it("marks the day's homecoming once, and only when every count closed clean", () => {
    renderSpine({ departures: [], evening: evening([closed({ tripId: "t1", booked: 10 })]) });

    const line = screen.getAllByText("All boats are home: 10 divers and 2 crew out, 12 back.");
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
    expect(
      screen.getByText("Your first boat is home: 3 divers and 2 crew out, 5 back."),
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
    expect(container.textContent).not.toMatch(/Out on|Heading in|On the surface/);
    // The word this app refuses to say about a boat nobody has spoken for.
    expect(container.textContent).not.toMatch(/unknown/i);
  });

  it("carries the crew's word, the site and the time they said it", () => {
    withStage("underway");
    expect(screen.getByText(/Out on Molasses Reef since /)).toBeInTheDocument();
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
    expect(screen.getByText(/Out on the water since /)).toBeInTheDocument();
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
          detail: "Waiver not signed, not sent yet.",
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

  it("prints tips as their own sentence and never inside the figure", () => {
    renderSpine({
      departures: [],
      evening: evening([closed({ tripId: "t1" })], {
        takings: takings({ tipsCents: 8_500 }),
      }),
    });

    // $1,240 and $85, not $1,325: a tip is its own Stripe charge and the month
    // keeps the two apart for that reason.
    expect(screen.getByText("$1,240")).toBeInTheDocument();
    expect(screen.getByText("And $85 in tips.")).toBeInTheDocument();
    expect(screen.queryByText("$1,325")).toBeNull();
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
