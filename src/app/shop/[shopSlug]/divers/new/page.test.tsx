// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/components/FormDraft", () => ({ FormDraft: () => null }));
vi.mock("@/components/ShopPageHeader", () => ({
  ShopNotice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ShopPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/app/actions/form-drafts", () => ({
  discardFormDraftAction: vi.fn(),
  saveFormDraftAction: vi.fn(),
}));
vi.mock("@/app/actions/seat-diver", () => ({
  seatExistingDiverAction: vi.fn(),
  seatNewDiverAction: vi.fn(),
}));
vi.mock("@/app/shop/[shopSlug]/trips/[id]/actions", () => ({ addToWaitlistAction: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/divers", () => ({ createDiver: vi.fn(), findSimilarDivers: vi.fn() }));
vi.mock("@/db/form-drafts", () => ({
  discardFormDraft: vi.fn(),
  readFormDraft: vi.fn(async () => null),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/i18n/staff-messages", () => ({
  staffTranslator: () =>
    Object.assign((key: string) => key, {
      raw: (key: string) => key,
      rich: (key: string) => key,
    }),
}));
vi.mock("@/lib/session", () => ({
  requireShopSurface: vi.fn(),
  requireStaffSession: vi.fn(),
}));

const { findSimilarDivers } = await import("@/db/divers");
const { requireShopSurface } = await import("@/lib/session");
const { default: NewDiverPage } = await import("./page");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";

const MATCH = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Nadia Ruiz",
  email: "nadia@example.com",
  phone: "+52 998 555 0100",
  lastDiveDayAt: null,
};

afterEach(cleanup);

async function renderPage(search: Record<string, string>) {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: "staff" } },
    db: {},
    shop: {
      id: SHOP_ID,
      slug: "blue-mantis",
      defaultLocale: "en-US",
      timezone: "America/Cancun",
    },
  } as never);
  vi.mocked(findSimilarDivers).mockResolvedValue([MATCH] as never);
  return render(
    await NewDiverPage({
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
      searchParams: Promise.resolve(search),
    }),
  );
}

const seatingArm = { surface: "trip-guests", tripId: TRIP_ID, confirmName: "Nadia Ruis" };
const waitlistArm = { ...seatingArm, waitlist: "true" };

/**
 * The third door onto the counter prompt (issue #1556), and the only one where
 * the flag is behind a ternary: `isWaitlist` picks the arm, so one flipped
 * character either stops marking a guessed seat or starts marking every
 * wait-list entry. The sibling prompts are pinned in `SeatDiverPanel.test.tsx`
 * and `AddDiverSection.test.tsx`.
 */
describe("NewDiverPage name-match prompt", () => {
  it("marks a seating tap as the guess it is, and marks nothing else on the page", async () => {
    const { container } = await renderPage(seatingArm);

    const candidateForm = screen.getByRole("button", { name: MATCH.fullName }).closest("form");
    expect(candidateForm?.querySelector('input[name="fromNameMatch"]')).toHaveValue("true");
    // Not on "create a new diver anyway", which invents nobody's history, and
    // not on the hand-entry form below it: a flag on either would block every
    // seat and teach the counter to tap past it.
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(1);
  });

  it("leaves the wait-list arm unmarked, because nobody boards from an entry", async () => {
    const { container } = await renderPage(waitlistArm);

    expect(screen.getByRole("button", { name: MATCH.fullName })).toBeInTheDocument();
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(0);
  });

  it("wait-lists the matched diver's own record, not the name that was typed", async () => {
    // The tap *means* "this is the same diver", and `addToWaitlistAction`
    // ignores `personId`: `joinTripWaitlist` resolves the person from the name
    // and email it is handed. Sending the counter-typed spelling instead would
    // spawn the second person row this prompt exists to prevent, and put a
    // stranger's name on the list. The seating arm does the same thing by id.
    await renderPage(waitlistArm);

    const form = screen.getByRole("button", { name: MATCH.fullName }).closest("form");
    expect(form?.querySelector('input[name="fullName"]')).toHaveValue(MATCH.fullName);
    expect(form?.querySelector('input[name="email"]')).toHaveValue(MATCH.email);
    expect(form?.querySelector('input[name="phone"]')).toHaveValue(MATCH.phone);
    expect(form?.querySelector('input[name="personId"]')).toHaveValue(MATCH.id);
  });

  it("links the match instead of seating them when there is no trip to seat onto", async () => {
    const { container } = await renderPage({ confirmName: "Nadia Ruis" });

    expect(screen.getByRole("link", { name: MATCH.fullName })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/divers/${MATCH.id}`,
    );
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(0);
  });
});
