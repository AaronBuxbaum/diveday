// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { CheckInPhase } from "./CheckInPhase";
import { LookBackCloseOut } from "./LookBackCloseOut";
import type { PhaseRecordContext } from "./WaterPhase";

const reads = vi.hoisted(() => ({
  incidents: vi.fn(),
  view: vi.fn(),
  standing: vi.fn(),
  rentals: vi.fn(),
  flySafe: vi.fn(),
}));
vi.mock("@/db/incident-reports", () => ({ listTripIncidentReports: reads.incidents }));
vi.mock("@/db/gear", () => ({ listTripUnitsToCheckIn: reads.rentals }));
vi.mock("@/db/fly-safe-correction", () => ({ listFlySafeFollowUps: reads.flySafe }));
vi.mock("../../manifest/_components/manifest-view", () => ({ readManifestView: reads.view }));
vi.mock("./water-reading", () => ({ waterStandingOf: reads.standing }));
const t = staffTranslator("en-US");
const record = {
  context: {
    db: {},
    shop: { id: "shop-1", slug: "blue-mantis" },
    session: { user: { personId: "person-1" } },
  },
  tripId: "trip-1",
  locale: "en-US",
  t,
} as unknown as PhaseRecordContext;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  reads.incidents.mockResolvedValue({ reports: [], mayStart: false });
  reads.view.mockResolvedValue({ status: "ready" });
  reads.rentals.mockResolvedValue([]);
  reads.flySafe.mockResolvedValue([]);
  reads.standing.mockReturnValue({
    latest: { dive: 1, complete: true, aboard: 1 },
    notYetBack: [],
    timeline: [],
    lastAboard: [],
  });
});

it("reads Check-in's incident reports as this viewer and draws only the ones that exist", async () => {
  const props = { record, guests: null, quiet: null, buddies: null };
  const { unmount } = render(await CheckInPhase(props));
  expect(reads.incidents).toHaveBeenCalledWith(record.context.db, "shop-1", "trip-1", "person-1");
  expect(document.getElementById("incidents")).toBeNull();
  unmount();
  reads.incidents.mockResolvedValueOnce({
    reports: [{ id: "report-1", status: "filed", createdByName: "Ana" }],
    mayStart: true,
  });
  render(await CheckInPhase(props));
  expect(
    screen.getByRole("link", { name: t("trips.clock.wrapped.reportFiled", { name: "Ana" }) }),
  ).toBeVisible();
});

it("links a historical look-back to the open roll-call item when someone is not recorded back", async () => {
  reads.standing.mockReturnValue({
    latest: { dive: 1, complete: false, aboard: 1 },
    notYetBack: [{ name: "Ana", status: "notBack" }],
    timeline: [],
    lastAboard: ["Ana"],
  });
  render(await LookBackCloseOut({ record, cancelled: false, notBack: 0 }));
  expect(screen.getByRole("link", { name: "1 thing open in Wrapped up" })).toHaveAttribute(
    "href",
    "/shop/blue-mantis/trips/trip-1?phase=wrapped",
  );
});

it("shows no link when all close-out items are closed", async () => {
  const { container } = render(await LookBackCloseOut({ record, cancelled: false, notBack: 0 }));
  expect(container).toBeEmptyDOMElement();
});

it("keeps a door for an alert or a known not-back when the roll call cannot be read", async () => {
  reads.standing.mockReturnValue({
    latest: { dive: 1, complete: true, aboard: 1 },
    alerts: 1,
    notYetBack: [],
    timeline: [],
    lastAboard: [],
  });
  const { unmount } = render(await LookBackCloseOut({ record, cancelled: false, notBack: 0 }));
  expect(screen.getByText("1 missing-diver alert is open.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Review Wrapped up" })).toBeVisible();
  unmount();
  reads.view.mockResolvedValue({ status: "unavailable" });
  reads.rentals.mockResolvedValue([{ personName: "Ana" }]);
  render(await LookBackCloseOut({ record, cancelled: false, notBack: 1 }));
  expect(screen.getByRole("link", { name: "Review Wrapped up" })).toBeVisible();
});
