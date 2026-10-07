// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Reading a day is every role's; putting a boat on it is not** (issue #1831).
 *
 * Date requests is open to every live staff role (issue #1679, an H-14
 * amendment). The day group's one act, "Add a departure", lands on the
 * schedule builder, whose add panel is `canConfigureTrips` — owner, manager,
 * instructor. A captain followed it to a board with no form. So the page asks
 * the same live question the board asks, and draws the act only for a reader
 * the board would give the panel to (ADR
 * 20260724-role-gated-surfaces-hide-not-explain).
 *
 * `RequestDayGroup` draws whatever `add` it is handed, so the decision lives in
 * the page and is pinned here rather than on the component.
 */

vi.mock("@/db/authz", () => ({ canPersonConfigureTrips: vi.fn() }));
vi.mock("@/db/boats", () => ({ listBoats: vi.fn(async () => []) }));
vi.mock("@/db/course-inquiries", () => ({ listDateRequestsForStaff: vi.fn() }));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { canPersonConfigureTrips } = await import("@/db/authz");
const { listDateRequestsForStaff } = await import("@/db/course-inquiries");
const { requireShopSurface } = await import("@/lib/session");
const { default: RequestsPage } = await import("./page");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";

const REQUEST = {
  id: "33333333-3333-4333-8333-333333333333",
  courseId: null,
  courseTitle: null,
  interest: "Night dive",
  personId: null,
  name: "Priya Sharma",
  email: "priya@example.test",
  phone: null,
  experienceLevel: "certified",
  timing: null,
  preferredDate: "2027-03-06",
  alternateDate: null,
  dateFlexible: false,
  divers: 2,
  message: null,
  createdAt: new Date("2026-09-01T12:00:00Z"),
};

async function renderPage() {
  render(
    await RequestsPage({
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
      searchParams: Promise.resolve({}),
    }),
  );
}

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: SHOP_ID, personId: "staff", roles: ["captain"] } },
    db: {},
    shop: {
      id: SHOP_ID,
      slug: "blue-mantis",
      defaultLocale: "en-US",
      timezone: "America/New_York",
      crewScheduleEnabled: true,
      diversPerDivemaster: 6,
    },
  } as never);
  vi.mocked(listDateRequestsForStaff).mockResolvedValue({
    rows: [REQUEST],
    total: 1,
    page: 1,
    pageCount: 1,
  } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a day's Add a departure", () => {
  it("is drawn for a reader the schedule builder gives the add panel to", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    await renderPage();

    const add = screen.getByRole("link", { name: "Add a departure" });
    expect(add.getAttribute("href")).toContain("/shop/blue-mantis/schedule/board?add=full");
    expect(canPersonConfigureTrips).toHaveBeenCalledWith({}, SHOP_ID, "staff");
  });

  /**
   * A captain still reads the day and the people who asked for it — that is
   * what the page was opened for. Only the act they would be refused goes.
   */
  it("is not drawn for a reader the builder refuses, and the day still is", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(false);
    await renderPage();

    expect(screen.queryByRole("link", { name: "Add a departure" })).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: /1 group · 2 divers/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });
});
