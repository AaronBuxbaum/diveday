// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Reading a day is every role's; putting a boat on it is not** (issue #1831).
 *
 * Date requests is open to every live staff role (issue #1679, an H-20260724-staff-role-reach
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
vi.mock("@/db/interest-dates", () => ({
  countWaitingDateInterests: vi.fn(async () => 0),
  listOpenDateInterests: vi.fn(),
  listClosedDateInterests: vi.fn(async () => []),
  listDeparturesOnDates: vi.fn(async () => []),
}));
vi.mock("./actions", () => ({ setRequestOutcomeAction: vi.fn() }));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { canPersonConfigureTrips } = await import("@/db/authz");
const { countWaitingDateInterests, listOpenDateInterests, listClosedDateInterests } = await import(
  "@/db/interest-dates"
);
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
  partySize: 2,
  message: null,
  askedAt: new Date("2026-09-01T12:00:00Z"),
  closedAt: null,
  closedAs: null,
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
      dateRequestsEnabled: true,
      diversPerDivemaster: 6,
      name: "Blue Mantis Divers",
    },
  } as never);
  vi.mocked(listOpenDateInterests).mockResolvedValue({
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

    const add = screen.getByRole("link", { name: "Open a departure for this date" });
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

    expect(screen.queryByRole("link", { name: "Open a departure for this date" })).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: /1 group · 2 divers/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });
});

/**
 * **A day reached only by second choices keeps its act** (layer 3 review,
 * dive-domain run B, item 1). A date that is only someone's alternate is a
 * real group with real people, drawn as reference rows; each carries the
 * day's act like a full row does (visual review A23), and no header does.
 */
describe("a day named only as someone's alternate", () => {
  it("still offers to open a departure on that date, carrying the request", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    vi.mocked(listOpenDateInterests).mockResolvedValue({
      rows: [
        { ...REQUEST, preferredDate: "2027-03-12", alternateDate: "2027-03-14", partySize: 4 },
      ],
      total: 1,
      page: 1,
      pageCount: 1,
    } as never);
    await renderPage();

    const group = document.getElementById("date-2027-03-14")?.closest("section");
    if (!group) throw new Error("the Mar 14 group renders as a section");
    const add = within(group).getByRole("link", { name: "Open a departure for this date" });
    expect(add.getAttribute("href")).toContain("date=2027-03-14");
    expect(add.getAttribute("href")).toContain(`requests=${REQUEST.id}`);
    // The act rides on the row, never beside the day's heading.
    expect(add.closest("li")).not.toBeNull();
  });
});

/**
 * **A request closes** (third UX review, item 13). A closed interest leaves its
 * day, so the day's count is open requests only, and it is listed under Done
 * with how it was closed and a way to reopen it.
 */
describe("closed requests", () => {
  it("lists a booked request under Done, with Reopen", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    vi.mocked(listClosedDateInterests).mockResolvedValue([
      {
        ...REQUEST,
        id: "44444444-4444-4444-8444-444444444444",
        name: "Dee Whitlock",
        closedAt: new Date("2026-10-14T15:00:00Z"),
        closedAs: "booked",
      },
    ] as never);
    await renderPage();

    expect(screen.getByRole("heading", { level: 2, name: /Done: 1 request/ })).toBeInTheDocument();
    expect(screen.getByText("Dee Whitlock")).toBeInTheDocument();
    expect(screen.getByText(/Booked Wed, Oct\s14/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("gives an open request Mark done and a reply door", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    await renderPage();

    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Reply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Actions for Priya Sharma$/ }));

    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    const reply = screen.getByRole("link", { name: "Reply" });
    expect(reply.getAttribute("href")).toMatch(/^mailto:priya@example\.test\?subject=/);
  });

  it("says nothing is open without claiming nobody ever asked", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
    vi.mocked(listOpenDateInterests).mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageCount: 1,
    } as never);
    vi.mocked(listClosedDateInterests).mockResolvedValue([
      { ...REQUEST, closedAt: new Date("2026-10-14T15:00:00Z"), closedAs: "done" },
    ] as never);
    await renderPage();

    expect(screen.queryByText("No requests yet")).toBeNull();
    expect(screen.getByText(/Marked done Wed, Oct\s14/)).toBeInTheDocument();
  });
});

/**
 * **Date requests switched off** (the Features page): the tab is gone, and a
 * direct URL lands on the inbox with no error, unless a course page's inquiry
 * still waits here (those are not part of the switch).
 */
describe("with date requests switched off", () => {
  function switchedOff() {
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: { user: { shopId: SHOP_ID, personId: "staff", roles: ["captain"] } },
      db: {},
      shop: {
        id: SHOP_ID,
        slug: "blue-mantis",
        defaultLocale: "en-US",
        timezone: "America/New_York",
        crewScheduleEnabled: true,
        dateRequestsEnabled: false,
        diversPerDivemaster: 6,
        name: "Blue Mantis Divers",
      },
    } as never);
  }

  it("redirects to the inbox when nothing waits", async () => {
    switchedOff();
    vi.mocked(countWaitingDateInterests).mockResolvedValue(0);
    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("still opens while a course inquiry waits", async () => {
    switchedOff();
    vi.mocked(countWaitingDateInterests).mockResolvedValue(1);
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(false);
    await renderPage();
    expect(screen.getAllByText("Priya Sharma").length).toBeGreaterThan(0);
  });
});
