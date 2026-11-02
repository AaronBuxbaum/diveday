// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleDaySpine, type TodayAction } from "@/lib/today";

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

import type { FirstBooking } from "@/db/first-booking";
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
} from "./day-spine-test-fixtures";

afterEach(() => {
  cleanup();
});

/**
 * The two good-news moments (principles.md §3). These assertions moved here
 * from `TodayQueue.test.tsx` when the queue became the spine; the conditions
 * are restated in spine terms and nothing was dropped.
 */
/**
 * **A claim a wind row would contradict waits for the wind** (code review
 * 2026-10-11, item 1, dive-domain review). The high-wind rows stream in after
 * the queue, so the two good-news claims render only once the forecast has
 * answered. Rendered on the server, as the page streams it: `signal` stops the
 * render with the forecast still out, so the fallbacks stand where it lands.
 */
describe("the good-news moments, beside a forecast still arriving", () => {
  const windRow = action({
    id: "high-wind:t1",
    kind: "high_wind_alert",
    detail: "Forecast 25 kt wind from NE.",
    departure: boat("t1"),
    aboutDeparture: true,
  });

  async function prerenderSpine(
    actions: TodayAction[],
    highWind: Promise<readonly TodayAction[]>,
    signal?: AbortSignal,
  ) {
    const { prelude } = await prerender(
      <DaySpine
        context={{
          spine: assembleDaySpine(
            { departures: [departure()], actions },
            { departures: [], actions: [] },
          ),
          highWind,
          shopSlug: "blue-mantis",
          mailShopName: "Blue Mantis",
          locale: "en-US",
          timeZone: "America/New_York",
          currency: "usd",
          now: NOW,
        }}
      />,
      { progressiveChunkSize: Number.POSITIVE_INFINITY, signal, onError: () => {} },
    );
    return new Response(prelude).text();
  }
  const cleanRoster = [
    action({ id: "quiet", kind: "dive_prep", departure: boat("t1") }),
    action({ id: "later", kind: "waiver", departure: boat("t9") }),
  ];

  it("never calls today's boats clear above a wind warning on one of them", async () => {
    const html = await prerenderSpine(cleanRoster, Promise.resolve([windRow]));
    expect(html).toContain("Forecast 25 kt wind from NE");
    expect(html).not.toContain("Today’s boats are all clear");
    expect(html).not.toContain("Nothing is waiting on you");
  });

  it("never says nothing is waiting while a wind warning is", async () => {
    const html = await prerenderSpine([], Promise.resolve([windRow]));
    expect(html).toContain("Forecast 25 kt wind from NE");
    expect(html).not.toContain("Nothing is waiting on you");
    expect(html).not.toContain("Today’s boats are all clear");
  });

  it("says either once a calm forecast answers", async () => {
    expect(await prerenderSpine(cleanRoster, Promise.resolve([]))).toContain(
      "Today’s boats are all clear",
    );
    expect(await prerenderSpine([], Promise.resolve([]))).toContain("Nothing is waiting on you");
  });

  it("says neither while the forecast is out, and says it is checking", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    const html = await prerenderSpine(cleanRoster, new Promise(() => {}), controller.signal);
    expect(html).toContain("Checking the forecast…");
    expect(html).not.toContain("Today’s boats are all clear");
    expect(html).toContain("Diver");
  });
});

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
  // Third review, item 5: a captain's Today opened on "22 jobs for the front
  // desk", rows the role cannot see, above a fold of rows it can. The count of
  // what is withheld is not a line any more; the fold is the one desk number.
  it("prints no count of the work a role does not see", () => {
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
    expect(screen.getByText(/1 departure · 1 thing/)).toBeInTheDocument();
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

    const week = container.querySelectorAll("details")[1];
    expect(week).toHaveClass("sm:rounded-panel", "sm:bg-surface-sunken", "open:sm:col-span-2");
    expect(week.querySelector("summary")).toHaveClass("min-h-14");
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
    const week = container.querySelectorAll("details")[1];
    expect(week.querySelector("summary")).toHaveClass("border-t");
    expect(week.className).toContain("max-sm:[&>summary]:border-b");
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
    const weekPanel = container.querySelectorAll("details")[1];
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
    expect(weekPanel.className).not.toContain("[&>summary]:hover:bg-surface-sunken");
  });

  it("renders no Tomorrow row on a day with nothing sailing tomorrow", () => {
    renderSpine({ actions: [action({ id: "today", departure: boat("t1") })] });
    expect(screen.queryByText(/^Tomorrow/)).toBeNull();
  });

  // Aaron 2026-10-23: the side panel's Board is the same door, so the week has none.
  it("expands 'This week' in place to its jobs, with no board link inside", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({ id: "friday", departure: boat("t9") }),
      ],
    });
    const week = container.querySelector("details");
    expect(week).not.toBeNull();
    expect(week).not.toHaveAttribute("open");
    expect(within(week as HTMLElement).getByText("This week")).toBeInTheDocument();
    expect(within(week as HTMLElement).queryByRole("link", { name: "Open the board" })).toBeNull();
  });

  // Issue #2671: a rostered crew member away later this week is counted on the line.
  it("counts the week's away crew on its line", () => {
    const { container } = renderSpine({
      actions: [
        action({ id: "today", departure: boat("t1") }),
        action({
          id: "crew-away:t9",
          kind: "crew_away",
          departure: boat("t9"),
          crewAway: { people: [{ personId: "marcus", fullName: "Marcus Webb" }] },
          dueAt: hoursFromNow(72),
        }),
        action({ id: "friday", departure: boat("t8") }),
      ],
    });
    const week = container.querySelector("details") as HTMLElement;
    expect(within(week).getByText("2 things, 1 crew member away")).toBeInTheDocument();
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
