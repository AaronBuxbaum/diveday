// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
// The agency check's host (H-105) wraps the spine and repaints through the
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
  stationStage,
} from "./day-spine-test-fixtures";

afterEach(() => {
  cleanup();
});

/**
 * **A departure's facts are said once.** This is principle 9 at page scale and
 * the reason the day spine exists: the board it replaced repeated one boat's
 * title on every queue row that hung off it.
 */
describe("a station owns its departure's facts", () => {
  it("names the boat once over its rows, linked to the departure (fifth loop, item 11)", () => {
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
    // One heading for the boat, a link to it; the rows under it do not repeat it.
    const heading = within(needsYou).getByRole("heading", {
      level: 3,
      name: "Two-Tank Reef · 7:00 AM",
    });
    expect(within(heading).getByRole("link")).toHaveAttribute("href", "/shop/blue-mantis/trips/t1");
    expect(within(needsYou).getAllByText("Two-Tank Reef · 7:00 AM")).toHaveLength(1);
    expect(within(needsYou).getByText("3 divers still need rental sizes")).toBeInTheDocument();
    expect(within(needsYou).getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("puts the rows bound to no boat under the desk's own heading", () => {
    renderSpine({
      actions: [
        action({ id: "r1", subject: "Priya Sharma", departure: boat("t1") }),
        action({
          id: "m",
          kind: "unanswered_messages",
          subject: "3 messages",
          departure: undefined,
        }),
      ],
    });
    const desk = screen.getByRole("heading", { level: 3, name: "The desk" });
    const group = desk.parentElement as HTMLElement;
    expect(within(group).getByText("3 messages")).toBeInTheDocument();
    expect(within(group).queryByText("Priya Sharma")).toBeNull();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
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
    expect(screen.queryByText(/On the list today/)).toBeNull();
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
    const line = screen.getByText(/On the list today/);
    expect(line).toHaveTextContent("4 out for a good day");
    expect(line).toHaveTextContent("2 getting comfortable again");
    // An aggregate, never a pairing: no diver is named by it.
    expect(line).not.toHaveTextContent("Keiko Tanaka");
    expect(line.textContent).not.toMatch(/Priya|Grace|Yara/);
  });

  // Third review, item 9: one range form across the app. A same-day boat
  // reads "7:00 AM – 10:30 AM" like the trip header; "until" stays for a boat
  // that comes home the next day.
  it("prints a same-day boat's return with the en dash, and an overnight one with until", () => {
    const { unmount } = renderSpine({
      departures: [
        departure({
          startsAt: new Date("2026-10-13T11:00:00Z"),
          endsAt: new Date("2026-10-13T14:30:00Z"),
        }),
      ],
    });
    expect(screen.getByText("– 10:30 AM")).toBeInTheDocument();
    unmount();
    renderSpine({
      departures: [
        departure({
          startsAt: new Date("2026-10-14T03:30:00Z"),
          endsAt: new Date("2026-10-14T07:00:00Z"),
        }),
      ],
    });
    expect(screen.getByText("until 3:00 AM")).toBeInTheDocument();
  });

  it("says the site, hull, crew and price on the station's own line", () => {
    renderSpine();
    const line = screen.getByText(
      (_, element) =>
        element?.tagName === "P" &&
        element.textContent === "Molasses Reef · Mantis II · Keiko Tanaka · $95",
    );
    expect(line).toBeInTheDocument();
    // The crew's names are the desktop's: below `sm` the line is the site,
    // the hull and the price (phone text density pass).
    expect(within(line).getByText("Keiko Tanaka", { exact: false })).toHaveClass("max-sm:hidden");
    expect(within(line).getByText("Molasses Reef", { exact: false })).not.toHaveClass(
      "max-sm:hidden",
    );
  });

  it("says how many of the booked divers are ready, and the open seats beside it", () => {
    renderSpine({ departures: [departure({ blocked: 2 })] });
    expect(screen.getByText("8 of 10 ready")).toBeInTheDocument();
    expect(screen.getByText("2 blocked")).toBeInTheDocument();
    expect(screen.getByText("2 seats open")).toBeInTheDocument();
  });

  it("says nothing about blocked divers on a boat whose divers are all ready", () => {
    renderSpine();
    expect(screen.getByText("10 of 10 ready")).toBeInTheDocument();
    expect(screen.queryByText(/blocked/)).toBeNull();
  });

  /** H-107, #2388: the seats on sale, which the booking transaction sells up to. */
  it("counts open seats and the bar against the boat's certificate, not the stated seats", () => {
    const { container } = renderSpine({
      departures: [departure({ capacity: 14, sellableCapacity: 11, booked: 10 })],
    });
    expect(screen.getByText("1 seat open")).toBeInTheDocument();
    const [, ready] = [
      ...(container.querySelector("[data-readiness-bar]")?.children ?? []),
    ] as HTMLElement[];
    expect(ready?.style.transform).toBe(`scaleX(${Math.round((10 / 11) * 1e4) / 1e4})`);
  });

  /** #2395: a practice departure says so where the day is read. */
  it("marks a rehearsal departure as one beside its title", () => {
    renderSpine({ departures: [departure({ rehearsal: true })] });
    const title = screen.getByRole("heading", { level: 3 });
    expect(within(title).getByText("Rehearsal")).toBeInTheDocument();
    cleanup();
    renderSpine();
    expect(screen.queryByText("Rehearsal")).toBeNull();
  });

  it("says Full rather than nought seats open on a boat with no seats left", () => {
    renderSpine({ departures: [departure({ booked: 12 })] });
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.queryByText(/seats? open/)).toBeNull();
  });

  it("draws readiness as one bar the boat's capacity wide: ready, then blocked, then open", () => {
    const { container } = renderSpine({ departures: [departure({ blocked: 3 })] });
    const bar = container.querySelector("[data-readiness-bar]");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    // `ReadinessBar` (#2100): `ProgressBar`'s layers, widest first, each scaled
    // to its cumulative share. 7 ready and 3 blocked of 12 seats; the rest of
    // the bar is the open seats.
    expect(bar).toHaveClass("h-2");
    const [blocked, ready] = [...(bar?.children ?? [])] as HTMLElement[];
    expect(ready?.className).toContain("bg-success");
    expect(ready?.style.transform).toBe(`scaleX(${Math.round((7 / 12) * 1e4) / 1e4})`);
    expect(blocked?.className).toContain("bg-danger");
    expect(blocked?.style.transform).toBe(`scaleX(${Math.round((10 / 12) * 1e4) / 1e4})`);
  });

  it("wears the crew's stage as a pill, and no clock word when nobody has said", () => {
    renderSpine({ departures: [departure({ stage: stationStage("boarding") })] });
    expect(screen.getByText("Boarding")).toBeInTheDocument();
    cleanup();
    renderSpine({ departures: [departure({ stage: null })] });
    // The phase words are gone from every chip (UX review 2026-10-10, item 1):
    // "Aboard" from a clock is a claim about where people are.
    for (const word of ["Prep", "Check-in", "Aboard", "Back", "Boarding"]) {
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

  it("opens the boat the reader crews straight onto its manifest, and only that one", () => {
    // UX review 2026-10-13, item 17: the roll call was the title, then the
    // Boat tab, then a scroll, and the role card promised a manifest door.
    renderSpine({
      departures: [
        departure({ tripId: "morning", title: "Morning Reef", startsAt: hoursFromNow(1) }),
        departure({ tripId: "wreck", title: "Wreck Trip", startsAt: hoursFromNow(6) }),
      ],
      crewedTripIds: ["wreck"],
    });
    const doors = screen.getAllByRole("link", { name: "Open the boat" });
    expect(doors).toHaveLength(1);
    expect(doors[0]).toHaveAttribute("href", "/shop/blue-mantis/trips/wreck/manifest");
    // The title still goes to Divers, the desk's tab.
    expect(screen.getByRole("link", { name: "Wreck Trip" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/wreck",
    );
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
    expect(rows[1]).toHaveTextContent("One review is waiting on you");
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
    const chore = sentence("One review is waiting on you");
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
