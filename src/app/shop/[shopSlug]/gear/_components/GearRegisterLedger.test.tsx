// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GearRegisterGroups, GearRegisterRow, GearRowReservation } from "@/db/gear";
import { staffTranslator } from "@/i18n/staff-messages";
import { GearRegisterLedger, GearServiceDueList } from "./GearRegisterLedger";

afterEach(cleanup);

const t = staffTranslator("en-US");
const TODAY = "2026-08-20";

/**
 * A register row with everything a unit can leave unsaid left unsaid — no
 * brand, no size, no clock, nothing reserved. Each test names only the one or
 * two facts it is about.
 *
 * The rows are built here rather than through `gearRegisterGroups`: that
 * function lives beside the query it groups, and importing it would drag
 * `src/db/client.ts` (PGlite, `pg`) into a jsdom render test. Its own pins —
 * exactly one group per unit, out and overdue never paged away — are in
 * `src/db/gear.test.ts`, over the pure rule in `src/lib/gear.test.ts`.
 */
function unit(label: string, overrides: Partial<GearRegisterRow> = {}): GearRegisterRow {
  return {
    item: {
      id: `unit-${label}`,
      shopId: "shop-1",
      kind: "bcd",
      label,
      size: null,
      serialNumber: null,
      brandModel: null,
      status: "in_service",
      serviceNote: null,
      purchasedOn: null,
      deletedAt: null,
    },
    serviceState: { state: "no_clock" },
    reservation: null,
    ...overrides,
  } as GearRegisterRow;
}

function reservation(overrides: Partial<GearRowReservation> = {}): GearRowReservation {
  return {
    reservationId: "res-1",
    bookingId: "booking-1",
    reservedFrom: "2026-08-19",
    reservedUntil: "2026-08-25",
    checkedOutAt: new Date("2026-08-19T13:00:00.000Z"),
    returnedAt: null,
    returnOutcome: null,
    returnNote: null,
    personName: "Grace Mensah",
    tripTitle: "Wreck Trip — Spiegel Grove",
    tripEndsAt: null,
    ...overrides,
  };
}

function groups(overrides: Partial<GearRegisterGroups> = {}): GearRegisterGroups {
  return {
    out: [],
    overdue: [],
    onWall: { rows: [], page: 1, pageCount: 1, pageSize: 50, total: 0 },
    ...overrides,
  };
}

/** One page of the wall, with its own count — the shape the reader hands over. */
function wall(rows: GearRegisterRow[], total = rows.length) {
  return { rows, page: 1, pageCount: 1, pageSize: 50, total };
}

function renderLedger(
  value: Partial<GearRegisterGroups> = {},
  options: { allHome?: boolean; celebrate?: boolean } = {},
) {
  return render(
    <GearRegisterLedger
      groups={groups(value)}
      shopSlug="blue-mantis"
      t={t}
      locale="en-US"
      timeZone="America/New_York"
      todayLocal={TODAY}
      allHome={options.allHome ?? false}
      celebrate={options.celebrate ?? false}
      pageHref={(page) => `/shop/blue-mantis/gear?page=${page}`}
      returnAction={vi.fn().mockResolvedValue(undefined)}
      checkOutAction={vi.fn().mockResolvedValue(undefined)}
      releaseAction={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

/**
 * **The pin the roadmap names for slice 9d** (ADR 20260827-the-shops-shelves):
 * the states are the groups, and a shared fact is said by the heading rather
 * than by every row beneath it.
 */
describe("the three groups", () => {
  it("heads each group with its own word and count, and renders nothing for the empty ones", () => {
    renderLedger({
      out: [unit("BCD-02", { reservation: reservation() })],
      overdue: [
        unit("REG-03", {
          reservation: reservation({ reservationId: "res-2", reservedUntil: "2026-08-18" }),
        }),
      ],
      onWall: wall([unit("WET-04")], 21),
    });
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["Out — 1", "Overdue — 1", "On the wall — 21"]);
  });

  it("says nothing at all when a group is empty — never 'Out — 0'", () => {
    renderLedger({ onWall: wall([unit("WET-04")]) });
    expect(screen.queryByText(/^Out/)).toBeNull();
    expect(screen.queryByText(/^Overdue/)).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("On the wall — 1");
  });

  it("never restates the group's own word on its rows", () => {
    renderLedger({
      out: [unit("BCD-02", { reservation: reservation() })],
    });
    // "Out with Grace Mensah" under a heading that already says Out is the
    // shared fact twice (ADR 20260827-clearwater-surface-language, decision 2).
    expect(screen.getByText("With Grace Mensah · due back Aug 25, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/^Out with/)).toBeNull();
  });

  it("counts the whole wall in its heading and leaves the pager to say the position", () => {
    renderLedger({
      onWall: { rows: [unit("WET-04")], page: 2, pageCount: 3, pageSize: 50, total: 121 },
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("On the wall — 121");
    // The pager states where you are, never the count the heading owns.
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.queryByText(/121 units/)).toBeNull();
  });
});

/**
 * Every colour-carried state also carries a word, and the mark beside it is
 * drawn rather than an emoji (ADR 20260827-clearwater-surface-language).
 */
describe("the overdue rows", () => {
  it("carries the warning word and a drawn mark for a unit that is with somebody", () => {
    const { container } = renderLedger({
      overdue: [unit("REG-03", { reservation: reservation({ reservedUntil: "2026-08-18" }) })],
    });
    const warned = container.querySelector(".text-warning-strong");
    expect(warned?.textContent).toBe("With Grace Mensah · was due Aug 18, 2026");
    // Drawn, never an emoji: the mark is an inline SVG on the same 24px grid.
    expect(warned?.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/[⚠✅❌]/);
  });

  /**
   * The distinction the dive-domain review insisted on (2026-08-20): a unit
   * that left the counter comes home with a *return*; one that never left is
   * *released*, because a fabricated return is a false record.
   */
  it("keeps its own quieter word and its own act for a unit that never left", () => {
    const { container } = renderLedger({
      overdue: [
        unit("BCD-07", {
          reservation: reservation({ reservedUntil: "2026-08-18", checkedOutAt: null }),
        }),
      ],
    });
    expect(
      screen.getByText("Never picked up · Grace Mensah · was due Aug 18, 2026"),
    ).toBeInTheDocument();
    expect(container.querySelector(".text-warning-strong")).toBeNull();
    expect(screen.getByRole("button", { name: "Release — BCD-07" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mark returned/ })).toBeNull();
  });
});

/** The act follows the handover stamp, and the due-back fact follows the window. */
describe("the out rows", () => {
  it("offers the return for a unit that is with a diver", () => {
    renderLedger({ out: [unit("BCD-02", { reservation: reservation() })] });
    expect(screen.getByRole("button", { name: "Mark returned — BCD-02" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Check out/ })).toBeNull();
  });

  it("names the departure's own clock on the day the window closes", () => {
    renderLedger({
      out: [
        unit("BCD-02", {
          reservation: reservation({
            reservedUntil: TODAY,
            tripEndsAt: new Date("2026-08-20T15:00:00.000Z"),
          }),
        }),
      ],
    });
    // 3:00 PM UTC is 11:00 AM where the boat is — the shop's zone, never the
    // server's (AGENTS.md's timezone rule).
    expect(screen.getByText("With Grace Mensah · due back today 11:00 AM")).toBeInTheDocument();
  });

  it("falls back to date words when no departure carries a time", () => {
    renderLedger({
      out: [unit("BCD-02", { reservation: reservation({ reservedUntil: TODAY }) })],
    });
    expect(screen.getByText("With Grace Mensah · due back today")).toBeInTheDocument();
  });

  it("corrects the heading's count for a unit nobody has collected", () => {
    renderLedger({
      out: [unit("BCD-07", { reservation: reservation({ checkedOutAt: null }) })],
    });
    expect(screen.getByText("Not collected · reserved for Grace Mensah")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check out — BCD-07" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Release — BCD-07" })).toBeInTheDocument();
  });
});

/**
 * Service clocks inform, never gate (ADR 20260815-minimal-gear-register), and
 * a healthy unit says nothing — which is what makes the ones that speak
 * visible at all.
 */
describe("the service sentence", () => {
  it("stays silent for a unit whose clocks are fine", () => {
    const { container } = renderLedger({
      onWall: wall([
        unit("REG-01", {
          serviceState: { state: "ok", kind: "service", nextDueOn: "2027-01-01" },
        }),
      ]),
    });
    expect(container.textContent).not.toMatch(/good through/);
  });

  it("speaks, and tones, only where a clock is running out", () => {
    const { container } = renderLedger({
      onWall: wall([
        unit("REG-01", {
          serviceState: {
            state: "overdue",
            kind: "visual_inspection",
            nextDueOn: "2026-07-01",
            daysOverdue: 50,
          },
        }),
      ]),
    });
    expect(container.querySelector(".text-warning-strong")?.textContent).toBe(
      "Visual inspection was due Jul 1, 2026",
    );
    // Informing, not gating: the row is still a door to the unit's record.
    expect(screen.getByRole("link", { name: "REG-01" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/gear/unit-REG-01",
    );
  });

  it("says a benched unit's status in place of a clock", () => {
    renderLedger({ onWall: wall([unit("REG-04", { item: benched() })]) });
    expect(screen.getByText("Needs service")).toBeInTheDocument();
  });
});

function benched(): GearRegisterRow["item"] {
  return { ...unit("REG-04").item, status: "needs_service" };
}

/**
 * The register's one coral moment (ADR 20260827-clearwater-surface-language,
 * decision 11): condition-derived, transient, and never more than one.
 */
describe("the all-home line", () => {
  it("renders once the wall holds everything, and plays no entrance on arrival", () => {
    const { container } = renderLedger(
      { onWall: wall([unit("BCD-01"), unit("BCD-02")]) },
      {
        allHome: true,
      },
    );
    const line = screen.getByRole("status");
    expect(line.textContent).toBe("All home. Every unit is back on the wall.");
    expect(line.className).not.toMatch(/rise-in/);
    // One coral element, and one group heading — nothing else on the surface.
    expect(container.querySelectorAll(".bg-accent\\/10")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "On the wall — 2",
    ]);
  });

  it("plays its entrance for the reader who just closed the last one out", () => {
    renderLedger({ onWall: wall([unit("BCD-01")]) }, { allHome: true, celebrate: true });
    expect(screen.getByRole("status").className).toMatch(/rise-in/);
  });

  it("stays away while anything is out", () => {
    renderLedger({ out: [unit("BCD-02", { reservation: reservation() })] });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing at all for a register with no units on it", () => {
    const { container } = renderLedger();
    expect(container.textContent).toBe("");
  });
});
/**
 * **The one reading no group owns** (ADR 20260827-the-shops-shelves, slice 9d
 * as amended after review). Out, Overdue and On the wall each absorbed a
 * retired stat tile; the service tile duplicated nothing, so deleting it with
 * the others left the register answering "what is due for service?" only for
 * the units on the wall page in front of you. It comes back as its own view.
 */
describe("the service-due view", () => {
  function renderServiceDue(rows: GearRegisterRow[]) {
    return render(
      <GearServiceDueList
        rows={rows}
        shopSlug="blue-mantis"
        t={t}
        locale="en-US"
        timeZone="America/New_York"
        todayLocal={TODAY}
        returnAction={vi.fn().mockResolvedValue(undefined)}
        checkOutAction={vi.fn().mockResolvedValue(undefined)}
        releaseAction={vi.fn().mockResolvedValue(undefined)}
      />,
    );
  }

  const lapsedVip = {
    state: "overdue",
    kind: "visual_inspection",
    nextDueOn: "2026-07-01",
    daysOverdue: 50,
  } as const;

  it("says each unit's clock, and carries no heading of its own", () => {
    renderServiceDue([
      unit("AL80-03", { serviceState: lapsedVip }),
      unit("AL80-04", {
        serviceState: {
          state: "due_soon",
          kind: "hydro_test",
          nextDueOn: "2026-09-10",
          daysLeft: 21,
        },
      }),
    ]);
    expect(screen.getByText("Visual inspection was due Jul 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Hydro test due Sep 10, 2026")).toBeInTheDocument();
    // The chip above names the view; a heading repeating it is the shared fact
    // said twice (ADR 20260827-clearwater-surface-language, decision 2).
    expect(screen.queryByRole("heading")).toBeNull();
  });

  /**
   * A unit can want the bench while a diver still has it, and the act that
   * starts getting it back belongs on the row that said the clock had run out.
   */
  it("keeps the row's own words and act for a unit that is out with somebody", () => {
    renderServiceDue([unit("AL80-05", { serviceState: lapsedVip, reservation: reservation() })]);
    expect(screen.getByText("With Grace Mensah · due back Aug 25, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark returned — AL80-05" })).toBeInTheDocument();
  });

  it("takes the overdue group's warning word for a unit whose window has lapsed", () => {
    const { container } = renderServiceDue([
      unit("AL80-06", {
        serviceState: lapsedVip,
        reservation: reservation({ reservedUntil: "2026-08-18", checkedOutAt: null }),
      }),
    ]);
    // The group is derived per row, so the never-collected split survives here
    // exactly as it does under the Overdue heading.
    expect(
      screen.getByText("Never picked up · Grace Mensah · was due Aug 18, 2026"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Release — AL80-06" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[⚠✅❌]/);
  });

  it("stays a door to the unit's record — service informs, it never gates", () => {
    renderServiceDue([unit("REG-04", { item: benched() })]);
    expect(screen.getByText("Needs service")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "REG-04" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/gear/unit-REG-04",
    );
  });
});
