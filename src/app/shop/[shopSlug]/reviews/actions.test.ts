import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bulk-publish action's own job, isolated from the write it wraps: read the
 * ticked ids off the form, refuse an empty selection and a selection that
 * matched nothing in this shop, and turn a count into the query values the page
 * reads back. What "matched nothing in this shop" means is covered against a
 * real database in `src/db/reviews.test.ts` (`setReviewsPublished` is
 * shop-scoped), so nothing here re-tests the query.
 */

vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    // The real helper redirects, which throws to unwind the action; mirroring
    // that keeps the tests honest about the code after it never running.
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/reviews", () => ({ setReviewPublished: vi.fn(), setReviewsPublished: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { setReviewsPublished } = await import("@/db/reviews");
const { requireStaffSession } = await import("@/lib/session");
const { publishReviewsAction } = await import("./actions");

const SHOP_ID = "3f4b1a2c-1111-4222-8333-444444444444";
const REVIEW_A = "11111111-1111-4111-8111-111111111111";
const REVIEW_B = "22222222-2222-4222-8222-222222222222";

/** Where the action sent staff, without the redirect's control-flow throw. */
async function redirectedTo(formData: FormData): Promise<string> {
  try {
    await publishReviewsAction(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

function selection(...reviewIds: string[]): FormData {
  const formData = new FormData();
  for (const reviewId of reviewIds) formData.append("reviewIds", reviewId);
  return formData;
}

beforeEach(() => {
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: SHOP_ID, shopSlug: "blue-mantis" },
  } as unknown as Awaited<ReturnType<typeof requireStaffSession>>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("publishReviewsAction", () => {
  it("publishes the ticked reviews and reports how many landed", async () => {
    vi.mocked(setReviewsPublished).mockResolvedValue(2);

    expect(await redirectedTo(selection(REVIEW_A, REVIEW_B))).toBe(
      "/shop/blue-mantis/reviews?notice=published_many&published=2",
    );
    // The shop comes from the session, never from the form.
    expect(setReviewsPublished).toHaveBeenCalledWith({}, SHOP_ID, [REVIEW_A, REVIEW_B]);
  });

  it("refuses an empty selection without touching the database", async () => {
    expect(await redirectedTo(selection())).toBe("/shop/blue-mantis/reviews?notice=none_selected");
    expect(setReviewsPublished).not.toHaveBeenCalled();
  });

  it("reports a refusal when the selection matched nothing this shop owns", async () => {
    // What a replayed form carrying another shop's review ids looks like from
    // here: the shop-scoped query changes zero rows.
    vi.mocked(setReviewsPublished).mockResolvedValue(0);

    expect(await redirectedTo(selection(REVIEW_A))).toBe("/shop/blue-mantis/reviews?notice=error");
  });
});
