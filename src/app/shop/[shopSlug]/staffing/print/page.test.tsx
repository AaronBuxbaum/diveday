// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffingView } from "../../../../../features/staffing/store";

const staffingView = vi.hoisted(() => vi.fn());
const awayRead = vi.hoisted(() => vi.fn());

// The week's one reader (issue #2757), assembled from the same two reads it
// makes, so the roster still comes from the staffing view alone.
vi.mock("../../../../../features/staffing/store", () => ({
  getStaffingPage: vi.fn(async () => ({
    view: await staffingView(),
    ...(await awayRead()),
    crewRequests: [],
  })),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("../../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
}));

const { requireShopSurface } = await import("../../../../../features/session/rules");
const { default: StaffingPrintPage } = await import("./page");

const PERSON_ID = "22222222-2222-4222-8222-222222222222";

function shop(overrides: Record<string, unknown> = {}) {
  return {
    session: { user: { shopId: "shop-id", personId: PERSON_ID, roles: ["owner"] } },
    db: {},
    shop: {
      id: "shop-id",
      slug: "blue-mantis",
      name: "Blue Mantis Divers",
      defaultLocale: "en-US",
      timezone: "America/New_York",
      crewScheduleEnabled: true,
      diversPerDivemaster: 6,
      brandColor: null,
      brandDisplayFont: null,
      ...overrides,
    },
  } as never;
}

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue(shop());
  staffingView.mockResolvedValue({
    from: new Date("2026-10-26T04:00:00Z"),
    to: new Date("2026-11-02T05:00:00Z"),
    staff: [
      {
        person: {
          id: PERSON_ID,
          fullName: "Zoe Zed",
          spokenLanguages: ["en"],
          crewPublicConsentAt: null,
          crewPublicName: null,
        },
        roles: ["divemaster"],
        shifts: [
          {
            id: "shift-1",
            startsAt: new Date("2026-10-29T11:00:00Z"),
            endsAt: new Date("2026-10-29T19:00:00Z"),
            note: null,
          },
        ],
        crewingTrips: [],
      },
    ],
    crewGaps: { departures: 0, needCrew: 0 },
    gapTrips: [],
  } as unknown as StaffingView);
  awayRead.mockResolvedValue({ blocks: [], canManageStaffAccounts: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderRota(week = "2026-10-26", person?: string) {
  return render(
    await StaffingPrintPage({
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
      searchParams: Promise.resolve({ week, person }),
    }),
  );
}

/**
 * **The crew rota is a sheet** (issue #2745, layer 2): the Crew screen's Print
 * door lands here, and what comes out of the printer is this page's one
 * `PaperSheet`, with no control on it.
 */
describe("the crew rota page", () => {
  it("renders the week as one sheet of the shop's paper with no control inside", async () => {
    const { container } = await renderRota();
    const sheets = container.querySelectorAll(".paper-sheet");
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0] as HTMLElement;
    expect(sheet.querySelectorAll("button, select, textarea, input, a")).toHaveLength(0);
    expect(sheet.querySelector(".paper-sheet-band")).toHaveTextContent("Blue Mantis Divers");
    expect(sheet.querySelector(".paper-sheet-band")).toHaveTextContent("Crew");
    expect(sheet.querySelector(".paper-sheet-fold")).toHaveTextContent(
      /Printed .* · America\/New_York/,
    );
    expect(screen.getByRole("rowheader", { name: /Zoe Zed/ })).toBeTruthy();
  });

  it("prints the week the screen showed, and goes back to it", async () => {
    await renderRota("2026-10-26");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Oct\s26/);
    expect(screen.getByRole("link", { name: "Crew" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/staffing?week=2026-10-26&person=all",
    );
  });

  it("keeps the personal schedule selected when returning from paper", async () => {
    await renderRota("2026-10-26", "me");
    expect(screen.getByRole("link", { name: "Crew" })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/staffing?week=2026-10-26&person=${PERSON_ID}`,
    );
    expect(screen.getByRole("rowheader", { name: /Zoe Zed/ })).toBeTruthy();
  });

  it("is the Crew view's to print: a shop that keeps no crew schedule has none", async () => {
    vi.mocked(requireShopSurface).mockResolvedValue(shop({ crewScheduleEnabled: false }));
    await expect(renderRota()).rejects.toThrow(/redirect \/shop\/blue-mantis\/schedule\/board/);
  });
});
