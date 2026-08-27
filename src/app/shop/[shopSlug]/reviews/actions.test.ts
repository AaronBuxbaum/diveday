import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The moderation actions' own job, isolated from the writes they wrap: read the
 * form, refuse what cannot be acted on, and **return** what happened rather
 * than redirecting to a `?notice=`. What "matched nothing in this shop" means
 * is covered against a real database in `src/db/reviews.test.ts` (every query
 * here is shop-scoped), so nothing below re-tests the query.
 *
 * `revalidatePath` is mocked to a no-op: outside a request scope the real one
 * throws, and what these tests are about is the result the control settles on.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/reviews", () => ({
  REVIEW_MODERATION_REASONS: ["abusive", "names_a_person", "wrong_subject", "spam", "other"],
  setReviewPublished: vi.fn(),
  setReviewStandout: vi.fn(),
  setReviewsPublished: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { revalidatePath } = await import("next/cache");
const { setReviewPublished, setReviewStandout, setReviewsPublished } = await import("@/db/reviews");
const { requireStaffSession } = await import("@/lib/session");
const { publishReviewsAction, reviewRowAction } = await import("./actions");

const SHOP_ID = "3f4b1a2c-1111-4222-8333-444444444444";
const REVIEW_A = "11111111-1111-4111-8111-111111111111";
const REVIEW_B = "22222222-2222-4222-8222-222222222222";
/** Whoever released them — every moderation act names its author now. */
const STAFF_ID = "55555555-5555-4555-8555-555555555555";
const REVIEWS_PATH = "/shop/blue-mantis/reviews";

function selection(...reviewIds: string[]): FormData {
  const formData = new FormData();
  for (const reviewId of reviewIds) formData.append("reviewIds", reviewId);
  return formData;
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

beforeEach(() => {
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: STAFF_ID },
  } as unknown as Awaited<ReturnType<typeof requireStaffSession>>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("publishReviewsAction", () => {
  it("publishes the ticked reviews and reports how many landed", async () => {
    vi.mocked(setReviewsPublished).mockResolvedValue(2);

    expect(await publishReviewsAction(null, selection(REVIEW_A, REVIEW_B))).toEqual({
      ok: true,
      published: 2,
    });
    // The shop comes from the session, never from the form.
    expect(setReviewsPublished).toHaveBeenCalledWith({}, SHOP_ID, [REVIEW_A, REVIEW_B], STAFF_ID);
    // The list still has to re-read, or the rows that just moved would render
    // from the cached segment — the half of `revalidateAndRedirect` that
    // survives losing the redirect (src/lib/navigation.ts).
    expect(revalidatePath).toHaveBeenCalledWith(REVIEWS_PATH);
  });

  it("refuses an empty selection without touching the database", async () => {
    expect(await publishReviewsAction(null, selection())).toEqual({
      ok: false,
      reason: "none-selected",
    });
    expect(setReviewsPublished).not.toHaveBeenCalled();
    // Nothing changed, so nothing is re-read.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a refusal when the selection matched nothing this shop owns", async () => {
    // What a replayed form carrying another shop's review ids looks like from
    // here: the shop-scoped query changes zero rows.
    vi.mocked(setReviewsPublished).mockResolvedValue(0);

    expect(await publishReviewsAction(null, selection(REVIEW_A))).toEqual({
      ok: false,
      reason: "error",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("reviewRowAction", () => {
  it("publishes one review and settles without a redirect", async () => {
    vi.mocked(setReviewPublished).mockResolvedValue(true);

    expect(await reviewRowAction(null, form({ reviewId: REVIEW_A, publish: "true" }))).toEqual({
      ok: true,
      effect: "published",
    });
    expect(revalidatePath).toHaveBeenCalledWith(REVIEWS_PATH);
  });

  it("names the hidden review so the row can offer Undo", async () => {
    vi.mocked(setReviewPublished).mockResolvedValue(true);

    expect(
      await reviewRowAction(null, form({ reviewId: REVIEW_A, publish: "false", reason: "spam" })),
    ).toEqual({ ok: true, effect: "hidden", undoReviewId: REVIEW_A });
  });

  it("reports a hide refused for want of a reason, on the row that asked", async () => {
    vi.mocked(setReviewPublished).mockResolvedValue("reason_required");

    expect(await reviewRowAction(null, form({ reviewId: REVIEW_A, publish: "false" }))).toEqual({
      ok: false,
      reason: "reason-required",
    });
    expect(setReviewPublished).toHaveBeenCalledWith(
      {},
      SHOP_ID,
      REVIEW_A,
      false,
      expect.objectContaining({ recordedByPersonId: STAFF_ID, reason: null }),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("narrows a reason code that is not one of the five to null", async () => {
    vi.mocked(setReviewPublished).mockResolvedValue("reason_required");

    await reviewRowAction(
      null,
      form({ reviewId: REVIEW_A, publish: "false", reason: "because-i-said-so" }),
    );
    // Never passed through: the enum is the contract the moderation trail is
    // written against.
    expect(setReviewPublished).toHaveBeenCalledWith(
      {},
      SHOP_ID,
      REVIEW_A,
      false,
      expect.objectContaining({ reason: null }),
    );
  });

  it("marks and unmarks a standout, keeping the shop from the session", async () => {
    vi.mocked(setReviewStandout).mockResolvedValue(true);

    expect(
      await reviewRowAction(
        null,
        form({ intent: "standout", reviewId: REVIEW_A, standout: "true" }),
      ),
    ).toEqual({ ok: true, effect: "standout" });
    expect(setReviewStandout).toHaveBeenCalledWith({}, SHOP_ID, REVIEW_A, true);

    expect(
      await reviewRowAction(
        null,
        form({ intent: "standout", reviewId: REVIEW_A, standout: "false" }),
      ),
    ).toEqual({ ok: true, effect: "standout-removed" });
    expect(setReviewStandout).toHaveBeenCalledWith({}, SHOP_ID, REVIEW_A, false);
  });

  it("refuses a review id that is not a uuid before reaching the database", async () => {
    expect(await reviewRowAction(null, form({ reviewId: "../../etc", publish: "true" }))).toEqual({
      ok: false,
      reason: "error",
    });
    expect(setReviewPublished).not.toHaveBeenCalled();
    expect(setReviewStandout).not.toHaveBeenCalled();
  });

  it("reports a refusal when the review is not this shop's", async () => {
    // `setReviewPublished` is shop-scoped, so another shop's id comes back as
    // `not_found` rather than as a write.
    vi.mocked(setReviewPublished).mockResolvedValue("not_found");

    expect(await reviewRowAction(null, form({ reviewId: REVIEW_B, publish: "true" }))).toEqual({
      ok: false,
      reason: "error",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
