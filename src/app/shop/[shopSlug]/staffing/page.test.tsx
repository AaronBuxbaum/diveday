// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffingView } from "../../../../features/staffing/store";

const OTHER_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_ID = "22222222-2222-4222-8222-222222222222";
const WRONG_READ_ID = "33333333-3333-4333-8333-333333333333";
const staffingView = vi.hoisted(() => vi.fn());
const duplicateStaffRead = vi.hoisted(() => vi.fn());
const awayRead = vi.hoisted(() => vi.fn());

// The page's one reader (issue #2757), assembled from the same two reads it
// makes, so the roster still comes from the staffing view alone.
vi.mock("../../../../features/staffing/store", () => ({
  getStaffingPage: vi.fn(async () => ({
    view: await staffingView(),
    ...(await awayRead()),
    crewRequests: [],
    pendingTimeOff: [],
  })),
}));
vi.mock("@/db/trips", () => ({ listStaff: duplicateStaffRead }));
vi.mock("@/db/crew-requests", () => ({
  listCrewAssignmentRequests: vi.fn(async () => []),
  readStaffingWeekAway: awayRead,
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));
vi.mock("./actions", () => ({
  createShiftAction: vi.fn(),
  decideAwayAction: vi.fn(),
  decideCrewRequestAction: vi.fn(),
  deleteAwayAction: vi.fn(),
  deleteShiftAction: vi.fn(),
  requestCrewAction: vi.fn(),
  saveAwayAction: vi.fn(),
}));
vi.mock("./_components/StaffingWarnings", () => ({ StaffingWarnings: () => null }));
vi.mock("./_components/StaffingWeek", () => ({
  StaffingWeek: ({ picker }: { picker?: React.ReactNode }) => picker ?? null,
  weekTailRowClass: "",
}));
vi.mock("./_components/CrewPageHeader", () => ({ CrewPageHeader: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/staffing",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("../schedule/_components/ScheduleViews", () => ({ ScheduleViews: () => null }));

const { requireShopSurface } = await import("../../../../features/session/rules");
const { default: StaffingPage } = await import("./page");

const roster = [
  {
    person: {
      id: OTHER_ID,
      fullName: "Abe Able",
      spokenLanguages: ["en"],
      crewPublicConsentAt: new Date("2026-10-01T12:00:00Z"),
      crewPublicName: "Abe Public",
    },
    roles: ["captain"],
    shifts: [],
    crewingTrips: [],
  },
  {
    person: {
      id: VIEWER_ID,
      fullName: "Zoe Zed",
      spokenLanguages: ["en"],
      crewPublicConsentAt: new Date("2026-10-02T12:00:00Z"),
      crewPublicName: "Zed Public",
    },
    roles: ["divemaster"],
    shifts: [],
    crewingTrips: [],
  },
] as StaffingView["staff"];

async function renderPage(person?: string, view?: string) {
  render(
    await StaffingPage({
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
      searchParams: Promise.resolve({ person, view }),
    }),
  );
}

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: "shop-id", personId: VIEWER_ID, roles: ["owner"] } },
    db: {},
    shop: {
      id: "shop-id",
      slug: "blue-mantis",
      defaultLocale: "en-US",
      timezone: "America/New_York",
      crewScheduleEnabled: true,
      diversPerDivemaster: 6,
      name: "Blue Mantis Divers",
    },
  } as never);
  getStaffingViewMock();
  awayRead.mockResolvedValue({ blocks: [], canManageStaffAccounts: true });
  duplicateStaffRead.mockResolvedValue([
    {
      person: {
        id: WRONG_READ_ID,
        fullName: "Wrong Snapshot Person",
        spokenLanguages: [],
        crewPublicConsentAt: null,
        crewPublicName: null,
      },
      roles: ["captain"],
    },
  ]);
});

function getStaffingViewMock() {
  staffingView.mockResolvedValue({
    from: new Date("2026-10-26T04:00:00Z"),
    to: new Date("2026-11-02T05:00:00Z"),
    staff: roster,
    crewGaps: { departures: 0, needCrew: 0 },
    gapTrips: [],
  } satisfies StaffingView);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("staffing page roster snapshot", () => {
  it("offers ordinary crew everyone or themselves, with no other people to pick", async () => {
    awayRead.mockResolvedValue({ blocks: [], canManageStaffAccounts: false });
    await renderPage("me");
    const picker = screen.getByRole("combobox", { name: "View a person" });
    expect(picker).toHaveValue("me");
    expect(within(picker).getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Show schedule" })).toBeNull();
  });
  it("offers managers the current shop roster for viewing another person", async () => {
    await renderPage(OTHER_ID);
    expect(screen.getByRole("combobox", { name: "View a person" })).toHaveValue(OTHER_ID);
  });

  it("uses the staffing view roster for every day's person selector, with public profile settings elsewhere", async () => {
    await renderPage(undefined, "plan");

    const selectors = screen.getAllByRole("combobox", { name: "Staff member" });
    expect(selectors).toHaveLength(7);
    const options = within(selectors[0])
      .getAllByRole("option")
      .map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent }));
    expect(options).toEqual([
      { value: OTHER_ID, text: "Abe Able" },
      { value: VIEWER_ID, text: "Zoe Zed" },
    ]);

    expect(screen.queryByText("On public pages")).toBeNull();
    expect(staffingView).toHaveBeenCalledOnce();
    expect(duplicateStaffRead).not.toHaveBeenCalled();
  });
});
