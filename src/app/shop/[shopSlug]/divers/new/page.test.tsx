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
  phone: "+529985550100",
  lastDiveDayAt: null,
};

afterEach(cleanup);

async function renderPage(search: Record<string, string>, matches: unknown[] = [MATCH]) {
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
  vi.mocked(findSimilarDivers).mockResolvedValue(matches as never);
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
    // ...along with the name it was guessing from, which is what the booking
    // compares. `fullName` beside it is the *matched* diver's, so only this
    // field can tell a guess from a regular the desk spelled right.
    expect(candidateForm?.querySelector('input[name="nameMatchQuery"]')).toHaveValue("Nadia Ruis");
    // Not on "create a new diver anyway", which invents nobody's history, and
    // not on the hand-entry form below it: a flag on either would block every
    // seat and teach the counter to tap past it.
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(1);
  });

  it("leaves the wait-list arm unmarked, because nobody boards from an entry", async () => {
    const { container } = await renderPage(waitlistArm);

    expect(screen.getByRole("button", { name: MATCH.fullName })).toBeInTheDocument();
    expect(container.querySelectorAll('input[name="fromNameMatch"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[name="nameMatchQuery"]')).toHaveLength(0);
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

  /**
   * The stored column is E.164 (#1547). The line the staffer reads is grouped,
   * and the form beside it still posts the stored value the action matches on —
   * a display concern that must not reach the write (#1712).
   */
  it("groups the candidate's stored number without changing what the form posts", async () => {
    await renderPage(seatingArm);

    expect(screen.getByText(`(${MATCH.email}, +52 998 555 0100)`)).toBeInTheDocument();
    const form = screen.getByRole("button", { name: MATCH.fullName }).closest("form");
    expect(form?.querySelector('input[name="phone"]')).toHaveValue("+529985550100");
  });

  it("names the candidate with no dive day once a sibling has one", async () => {
    // The third door renders its own dive-day line, so it gets its own pin
    // (`dive-domain-expert`, 2026-09-11): a blank beside a dated sibling reads
    // as "the one with the date is the real diver" and biases the tap toward
    // the record that already has cards. With no date anywhere on the list the
    // line says nothing and is not rendered — `noDiveDayNeedsSaying`.
    await renderPage(seatingArm, [
      { ...MATCH, lastDiveDayAt: new Date("2026-08-27T00:30:00Z") },
      { ...MATCH, id: "44444444-4444-4444-8444-444444444444", fullName: "Nadia Ruiseco" },
    ]);

    // The translator is mocked to echo keys here, so these are the two message
    // keys; the sentences themselves are pinned in `i18n/name-match-prompt`.
    expect(screen.getByText("divers.page.confirmMatchesLastDive")).toBeInTheDocument();
    expect(screen.getByText("divers.page.confirmMatchesNoDiveDay")).toBeInTheDocument();
  });

  it("says nothing about dive days when this shop has one for nobody on the list", async () => {
    await renderPage(seatingArm);

    expect(screen.queryByText("divers.page.confirmMatchesLastDive")).toBeNull();
    expect(screen.queryByText("divers.page.confirmMatchesNoDiveDay")).toBeNull();
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
