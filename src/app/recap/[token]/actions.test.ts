import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The pulse action's own job**, isolated from the write it wraps: throttle by
 * IP *before* the token is verified, narrow what the form claims, and turn a
 * domain outcome code into the one word the page reads back off the URL.
 *
 * What the write itself does — one live row per booking, withdrawal, the
 * cancelled-booking refusal — is pinned against a real database in
 * `src/db/recap-pulses.test.ts`. What can only be seen here is the *order*: an
 * IP limit that runs after `verifyRecapToken` throttles abuse of a link
 * somebody already has and does nothing at all about somebody spraying guesses
 * at the signature (CR-013), and no database test can tell the two apart.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws to unwind the action; mirroring that keeps the
    // tests honest about the code after a redirect never running.
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/recap-pulses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/recap-pulses")>();
  return { ...actual, submitRecapPulse: vi.fn() };
});
vi.mock("@/db/people", () => ({ recordDiverOwnLocaleForBooking: vi.fn() }));
vi.mock("@/db/recap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/recap")>();
  return {
    ...actual,
    isRecapOpen: vi.fn(async () => true),
    canAddRecapPhoto: vi.fn(async () => ({ ok: true })),
    addRecapPhoto: vi.fn(async () => ({ ok: true, photo: { id: "photo" } })),
    unshareRecapPhoto: vi.fn(async () => ({ ok: true })),
  };
});
vi.mock("@/db/reviews", () => ({ submitTripReview: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storeRecapImage: vi.fn(), deleteStoredImage: vi.fn() }));
vi.mock("@/db/tips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/tips")>();
  return {
    ...actual,
    getTipCurrencyForBooking: vi.fn(async () => "usd"),
    startTipCheckout: vi.fn(async () => ({ ok: true, checkoutUrl: "https://checkout.test/tip" })),
  };
});
vi.mock("@/lib/notifications", () => ({ publicAppUrl: vi.fn(() => "https://diveday.test") }));
vi.mock("@/i18n/request", () => ({
  requestFirstHandLocale: vi.fn(async () => "en-US"),
  requestLocale: vi.fn(async () => "en-US"),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/recap-links", () => ({ verifyRecapToken: vi.fn(() => null) }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { submitRecapPulse } = await import("@/db/recap-pulses");
const { verifyRecapToken } = await import("@/lib/recap-links");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { startTipCheckout } = await import("@/db/tips");
const { addRecapPhoto, canAddRecapPhoto, isRecapOpen, unshareRecapPhoto } = await import(
  "@/db/recap"
);
const { recordDiverOwnLocaleForBooking } = await import("@/db/people");
const { submitTripReview } = await import("@/db/reviews");
const { storeRecapImage } = await import("@/lib/storage");
const {
  startTipAction,
  submitRecapPulseAction,
  submitReviewAction,
  unshareRecapPhotoAction,
  uploadRecapPhotoAction,
} = await import("./actions");

const TOKEN = "signed-recap-token";
const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

/** Where the action sent the diver, without the redirect's control-flow throw. */
async function redirectedTo(data: FormData): Promise<string> {
  try {
    await submitRecapPulseAction(TOKEN, data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(verifyRecapToken).mockReturnValue(BOOKING_ID);
  vi.mocked(submitRecapPulse).mockResolvedValue({ ok: true, withdrawn: false });
  vi.mocked(isRecapOpen).mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("submitRecapPulseAction", () => {
  it("throttles on IP before it ever verifies the token (CR-013)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
    // The point of the ordering: a refused IP costs nothing and reveals nothing
    // about whether the token was real.
    expect(verifyRecapToken).not.toHaveBeenCalled();
    expect(submitRecapPulse).not.toHaveBeenCalled();
  });

  it("throttles per booking once the token is known good", async () => {
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
    expect(submitRecapPulse).not.toHaveBeenCalled();
  });

  it("refuses a token that verifies to nothing", async () => {
    vi.mocked(verifyRecapToken).mockReturnValue(null);
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
    expect(submitRecapPulse).not.toHaveBeenCalled();
  });

  /**
   * The authorization shape this action shares with the review beside it: the
   * booking comes from the signed token, and **nothing** in the form is read as
   * identity. A crafted post naming another shop's trip changes nothing,
   * because those fields are never looked at.
   */
  it("takes the booking from the token and reads no identity out of the form", async () => {
    await redirectedTo(
      form([
        ["category", "gear"],
        ["shopId", "00000000-0000-0000-0000-000000000000"],
        ["tripId", "11111111-1111-1111-1111-111111111111"],
        ["bookingId", "22222222-2222-2222-2222-222222222222"],
        ["note", "The inflator stuck."],
      ]),
    );
    expect(submitRecapPulse).toHaveBeenCalledWith(expect.anything(), {
      bookingId: BOOKING_ID,
      categories: ["gear"],
      note: "The inflator stuck.",
    });
  });

  it("drops every posted value that is not one of the five codes", async () => {
    await redirectedTo(
      form([
        ["category", "constructor"],
        ["category", "boat"],
        ["category", "__proto__"],
      ]),
    );
    expect(submitRecapPulse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ categories: ["boat"] }),
    );
  });

  it("names each outcome in one word, and never renders a sentence", async () => {
    const cases = [
      [{ ok: true, withdrawn: false } as const, "saved"],
      [{ ok: true, withdrawn: true } as const, "withdrawn"],
      [{ ok: false, reason: "empty" } as const, "empty"],
      [{ ok: false, reason: "did_not_dive" } as const, "did_not_dive"],
      [{ ok: false, reason: "not_found" } as const, "error"],
    ] as const;
    for (const [outcome, code] of cases) {
      vi.mocked(submitRecapPulse).mockResolvedValueOnce(outcome);
      expect(await redirectedTo(form([["category", "gear"]]))).toBe(
        `/recap/${TOKEN}?pulse=${code}`,
      );
    }
  });

  it("reports an error rather than throwing when the write itself fails", async () => {
    vi.mocked(submitRecapPulse).mockRejectedValueOnce(new Error("db down"));
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
  });
});

describe("startTipAction", () => {
  async function tipRedirect(data: FormData): Promise<string> {
    try {
      await startTipAction(TOKEN, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
      throw error;
    }
    throw new Error("action returned without redirecting");
  }

  it("refuses an amount that is not a number, and charges nothing", async () => {
    expect(await tipRedirect(form([["customAmount", "lots"]]))).toBe(`/recap/${TOKEN}?tip=invalid`);
    expect(startTipCheckout).not.toHaveBeenCalled();
  });

  it("refuses a form with no amount at all", async () => {
    expect(await tipRedirect(form([]))).toBe(`/recap/${TOKEN}?tip=invalid`);
    expect(startTipCheckout).not.toHaveBeenCalled();
  });

  it("lets a typed amount win over the checked preset", async () => {
    expect(
      await tipRedirect(
        form([
          ["amount", "10"],
          ["customAmount", " 25 "],
        ]),
      ),
    ).toBe("https://checkout.test/tip");
    expect(vi.mocked(startTipCheckout).mock.calls[0]?.[1]).toMatchObject({ amountCents: 2500 });
  });
});

/**
 * **Nothing writes through a recap the page would not show** (security review
 * of #2123). A recap that waits on a missing diver, a held seat, a diver left
 * at the dock: the page renders a card with no forms, and a form loaded before
 * the hold, or a crafted post, must not reach any of the four writers.
 */
describe("a recap that is not open", () => {
  async function landing(
    action: (token: string, data: FormData) => Promise<unknown>,
    data: FormData,
  ) {
    try {
      await action(TOKEN, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
      throw error;
    }
    throw new Error("action returned without redirecting");
  }

  beforeEach(() => {
    vi.mocked(isRecapOpen).mockResolvedValue(false);
  });

  it("refuses a photo before any bytes are stored", async () => {
    const data = new FormData();
    data.append("photo", new File(["x"], "reef.jpg", { type: "image/jpeg" }));
    expect(await landing(uploadRecapPhotoAction, data)).toBe(`/recap/${TOKEN}?photo=cancelled`);
    expect(storeRecapImage).not.toHaveBeenCalled();
  });

  it("refuses a tip before any checkout starts", async () => {
    expect(await landing(startTipAction, form([["amount", "10"]]))).toBe(
      `/recap/${TOKEN}?tip=error`,
    );
    expect(startTipCheckout).not.toHaveBeenCalled();
  });

  it("refuses a review", async () => {
    expect(await landing(submitReviewAction, form([["rating", "5"]]))).toBe(
      `/recap/${TOKEN}?review=did_not_dive`,
    );
    expect(submitTripReview).not.toHaveBeenCalled();
  });

  it("refuses a pulse", async () => {
    expect(await landing(submitRecapPulseAction, form([["category", "gear"]]))).toBe(
      `/recap/${TOKEN}?pulse=error`,
    );
    expect(submitRecapPulse).not.toHaveBeenCalled();
  });

  it("asks about the booking the token names", async () => {
    await landing(submitRecapPulseAction, form([["category", "gear"]]));
    expect(vi.mocked(isRecapOpen).mock.calls[0]?.[1]).toBe(BOOKING_ID);
  });
});

/**
 * **The recap link cannot publish to the boat** (security review of layer
 * r5-4, F3). It is signed for 180 days, cannot be revoked and is written to be
 * forwarded, so whoever it reaches may add photos to this diver's own recap,
 * never onto everyone else's under the diver's name. The tick is honored only
 * through the readiness link (`ready/[token]/recap-photo-actions.ts`).
 */
/**
 * **A refused upload leaves nothing behind** (ADR 20261005-optional-shop-features):
 * with recap photos switched off, `canAddRecapPhoto` refuses, and the diver's
 * language is not recorded from a form that took nothing.
 */
describe("uploadRecapPhotoAction with recap photos switched off", () => {
  it("refuses with no side effect: no bytes stored, no language recorded", async () => {
    vi.mocked(canAddRecapPhoto).mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const data = new FormData();
    data.append("photo", new File(["x"], "reef.jpg", { type: "image/jpeg" }));

    await expect(uploadRecapPhotoAction(TOKEN, data)).rejects.toThrow(
      `REDIRECT:/recap/${TOKEN}?photo=error`,
    );
    expect(storeRecapImage).not.toHaveBeenCalled();
    expect(recordDiverOwnLocaleForBooking).not.toHaveBeenCalled();
  });
});

describe("uploadRecapPhotoAction and the share tick", () => {
  it("adds the photo to this recap alone, whatever the post says", async () => {
    vi.mocked(storeRecapImage).mockResolvedValue({
      status: "stored",
      url: "https://img/reef.jpg",
    } as never);
    const data = new FormData();
    data.append("photo", new File(["x"], "reef.jpg", { type: "image/jpeg" }));
    data.append("shareWithBoat", "on");

    await uploadRecapPhotoAction(TOKEN, data).catch(() => undefined);

    expect(addRecapPhoto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addRecapPhoto).mock.calls[0]?.[1]).toMatchObject({
      bookingId: BOOKING_ID,
      shareWithBoat: false,
    });
  });
});

/**
 * **The sharer takes a photo back** (issue #2806). The booking comes from the
 * signed token and only the photo id from the form, so a crafted post can name
 * any photo and still clears only one this booking uploaded (the writer's own
 * `booking_id` match, pinned in `src/db/recap-shared-photos.test.ts`).
 */
describe("unshareRecapPhotoAction", () => {
  const PHOTO_ID = "5b1d7e2a-aaaa-4bbb-8ccc-dddddddddddd";

  async function unshareRedirect(data: FormData): Promise<string> {
    try {
      await unshareRecapPhotoAction(TOKEN, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
      throw error;
    }
    throw new Error("action returned without redirecting");
  }

  it("throttles on IP before it ever verifies the token (CR-013)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });
    expect(await unshareRedirect(form([["photoId", PHOTO_ID]]))).toBe(
      `/recap/${TOKEN}?photo=error`,
    );
    expect(verifyRecapToken).not.toHaveBeenCalled();
    expect(unshareRecapPhoto).not.toHaveBeenCalled();
  });

  it("throttles per booking once the token is known good", async () => {
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });
    expect(await unshareRedirect(form([["photoId", PHOTO_ID]]))).toBe(
      `/recap/${TOKEN}?photo=error`,
    );
    expect(unshareRecapPhoto).not.toHaveBeenCalled();
  });

  it("refuses a token that verifies to nothing", async () => {
    vi.mocked(verifyRecapToken).mockReturnValue(null);
    expect(await unshareRedirect(form([["photoId", PHOTO_ID]]))).toBe(
      `/recap/${TOKEN}?photo=error`,
    );
    expect(unshareRecapPhoto).not.toHaveBeenCalled();
  });

  it("refuses a photo id that is not one", async () => {
    expect(await unshareRedirect(form([["photoId", "'; drop table"]]))).toBe(
      `/recap/${TOKEN}?photo=error`,
    );
    expect(unshareRecapPhoto).not.toHaveBeenCalled();
  });

  it("clears the photo for the token's own booking, never one the form names", async () => {
    expect(
      await unshareRedirect(
        form([
          ["photoId", PHOTO_ID],
          ["bookingId", "22222222-2222-2222-2222-222222222222"],
        ]),
      ),
    ).toBe(`/recap/${TOKEN}?photo=unshared`);
    expect(unshareRecapPhoto).toHaveBeenCalledWith(expect.anything(), {
      bookingId: BOOKING_ID,
      photoId: PHOTO_ID,
    });
  });

  it("says it failed when no photo of this booking's was cleared", async () => {
    vi.mocked(unshareRecapPhoto).mockResolvedValueOnce({ ok: false });
    expect(await unshareRedirect(form([["photoId", PHOTO_ID]]))).toBe(
      `/recap/${TOKEN}?photo=error`,
    );
  });

  /**
   * Taking a photo back is never refused for the recap's state: a seat that
   * leaves the boat already stops publishing, and withdrawing is the safe
   * direction, so it does not ask `isRecapOpen`.
   */
  it("works on a recap that is not open", async () => {
    vi.mocked(isRecapOpen).mockResolvedValue(false);
    expect(await unshareRedirect(form([["photoId", PHOTO_ID]]))).toBe(
      `/recap/${TOKEN}?photo=unshared`,
    );
  });
});
