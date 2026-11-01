// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffingView } from "@/db/staffing";

const OTHER_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_ID = "22222222-2222-4222-8222-222222222222";
const WRONG_READ_ID = "33333333-3333-4333-8333-333333333333";
const staffingView = vi.hoisted(() => vi.fn());
const duplicateStaffRead = vi.hoisted(() => vi.fn());
const awayRead = vi.hoisted(() => vi.fn());

vi.mock("@/db/staffing", () => ({ getStaffingView: staffingView }));
vi.mock("@/db/trips", () => ({ listStaff: duplicateStaffRead }));
vi.mock("@/db/crew-requests", () => ({
  listCrewAssignmentRequests: vi.fn(async () => []),
  readStaffingWeekAway: awayRead,
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("./actions", () => ({
  createShiftAction: vi.fn(),
  decideCrewRequestAction: vi.fn(),
  deleteAwayAction: vi.fn(),
  deleteShiftAction: vi.fn(),
  requestCrewAction: vi.fn(),
  saveAwayAction: vi.fn(),
  saveCrewPublicConsentAction: vi.fn(),
}));
vi.mock("./_components/StaffingWarnings", () => ({ StaffingWarnings: () => null }));
vi.mock("./_components/StaffingWeek", () => ({
  StaffingWeek: () => null,
  weekTailRowClass: "",
}));
vi.mock("./_components/CrewPageHeader", () => ({ CrewPageHeader: () => null }));
vi.mock("../schedule/_components/ScheduleViews", () => ({ ScheduleViews: () => null }));

const { requireShopSurface } = await import("@/lib/session");
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

async function renderPage() {
  render(
    await StaffingPage({
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
      searchParams: Promise.resolve({}),
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
  it("uses the staffing view roster for both selectors and the reader's own consent", async () => {
    await renderPage();

    const shiftOptions = within(screen.getByRole("combobox", { name: "Staff member" }))
      .getAllByRole("option")
      .map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent }));
    expect(shiftOptions).toEqual([
      { value: "", text: "Choose a person" },
      { value: OTHER_ID, text: "Abe Able" },
      { value: VIEWER_ID, text: "Zoe Zed" },
    ]);

    const awayOptions = within(screen.getByRole("combobox", { name: "Who" }))
      .getAllByRole("option")
      .map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent }));
    expect(awayOptions).toEqual([
      { value: OTHER_ID, text: "Abe Able" },
      { value: VIEWER_ID, text: "Zoe Zed" },
    ]);

    expect(screen.getByText("Shown as Zed Public")).toBeInTheDocument();
    expect(screen.queryByText("Shown as Abe Public")).toBeNull();
    expect(screen.queryByText("Shown as Wrong Snapshot Person")).toBeNull();
    expect(
      screen.getByRole("checkbox", {
        name: "Let divers see my first name, role and languages on this shop’s public pages.",
      }),
    ).toBeChecked();

    expect(staffingView).toHaveBeenCalledOnce();
    expect(duplicateStaffRead).not.toHaveBeenCalled();
  });
});
