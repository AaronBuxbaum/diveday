// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncidentExportDocument } from "@/lib/incident-export";

const TRIP_ID = "5a5bd26d-553a-4c5c-9609-ca048049f010";
const exportRead = vi.hoisted(() => vi.fn());
const mayExport = vi.hoisted(() => vi.fn());

// `getTripLogPage` is the gate then the read, so the mock keeps that order.
vi.mock("@/db/incident-export", () => ({
  getTripLogPage: async () =>
    (await mayExport()) ? { allowed: true, doc: await exportRead() } : { allowed: false },
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
}));
// An async Server Component with its own read; the trail it prints is its own test's.
vi.mock("./_components/CrewAwayWorkingLog", () => ({ CrewAwayWorkingLog: () => null }));

const { requireShopSurface } = await import("@/lib/session");
const { default: IncidentExportPage } = await import("./page");

const DOC: IncidentExportDocument = {
  meta: {
    shopName: "Blue Mantis Divers",
    shopSlug: "blue-mantis",
    timezone: "America/New_York",
    depthUnit: "feet",
    tripId: TRIP_ID,
    tripTitle: "Two-Tank Reef",
    tripStartsAt: "2026-10-14T12:00:00.000Z",
    tripEndsAt: "2026-10-14T16:00:00.000Z",
    plannedDives: 2,
    checkpoints: ["departure", "after_dive_1", "after_dive_2"],
    generatedAt: "2026-10-14T22:00:00.000Z",
    generatedByName: "Rae Owner",
  },
  departureSummary: {
    totalDivers: 0,
    byType: { diver: 0, snorkeler: 0, rider: 0 },
    boarded: 0,
    notBoarded: 0,
    awaiting: 0,
    crewAssigned: 0,
  },
  roster: [],
  turnedAway: [],
  crew: [],
  executedDives: [],
  preDepartureCheck: [],
  sailedWithSnags: [],
  boatSafety: null,
  boatSafetyAbsence: "no_boat",
  timeline: [],
  incidentReports: [],
  hashVersion: 3,
  contentHash: "a".repeat(64),
};

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { personId: "person-owner" } },
    db: {},
    shop: {
      id: "shop-id",
      slug: "blue-mantis",
      name: "Blue Mantis Divers",
      defaultLocale: "en-US",
      timezone: "America/New_York",
      brandColor: null,
      brandDisplayFont: null,
    },
  } as never);
  mayExport.mockResolvedValue(true);
  exportRead.mockResolvedValue(DOC);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderLog() {
  return render(
    await IncidentExportPage({
      params: Promise.resolve({ shopSlug: "blue-mantis", id: TRIP_ID }),
    }),
  );
}

/**
 * **The departure log is a sheet** (issue #2745, layer 2): what an owner
 * reviews on screen is the page that comes out, so the sheet holds every fact
 * and no control at all. Nothing interactive reaches paper because nothing
 * interactive is rendered inside it, not because a stylesheet hides it.
 */
describe("the departure log", () => {
  it("renders as one sheet of the shop's paper with no control inside", async () => {
    const { container } = await renderLog();
    const sheets = container.querySelectorAll(".paper-sheet");
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0] as HTMLElement;
    expect(sheet.querySelectorAll("button, select, textarea, input")).toHaveLength(0);
    // Nothing on it is only for one medium.
    expect(sheet.innerHTML).not.toMatch(/print:hidden|print:block/);
    // The band names the shop and the document; the fold, when, in which zone.
    expect(sheet.querySelector(".paper-sheet-band")).toHaveTextContent("Blue Mantis Divers");
    expect(sheet.querySelector(".paper-sheet-band")).toHaveTextContent("Departure log");
    expect(sheet.querySelector(".paper-sheet-fold")).toHaveTextContent(
      /Printed .*2026.* · America\/New_York/,
    );
  });

  it("keeps the record's facts on the sheet, the integrity code last", async () => {
    const { container } = await renderLog();
    const sheet = container.querySelector(".paper-sheet") as HTMLElement;
    expect(screen.getByRole("heading", { level: 1, name: "Two-Tank Reef" })).toBeVisible();
    for (const heading of [
      "Roll-call timeline",
      "Certification evidence and waiver status",
      "Incident reports",
    ]) {
      expect(sheet).toContainElement(screen.getByRole("heading", { name: heading }));
    }
    const footer = sheet.querySelector("footer");
    expect(footer).toHaveTextContent("Integrity code (SHA-256)");
    expect(footer).toHaveTextContent("a".repeat(64));
    // Every page it runs to still names the departure.
    expect(container.querySelector(`[data-departure-paper="departure-${TRIP_ID}-log"]`)).toBe(
      sheet.parentElement,
    );
  });

  it("is read before it is printed: the door said its name, not Print", async () => {
    const { container } = await renderLog();
    // One Print, beside the way back, off the sheet.
    const print = screen.getByRole("button", { name: "Print" });
    expect(container.querySelector(".paper-sheet")).not.toContainElement(print);
    expect(screen.getByRole("link", { name: "Trip" })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${TRIP_ID}`,
    );
  });

  it("refuses anyone but an owner before it reads the record", async () => {
    mayExport.mockResolvedValue(false);
    await expect(renderLog()).rejects.toThrow(/redirect .*log-not-authorized/);
    expect(exportRead).not.toHaveBeenCalled();
  });
});
