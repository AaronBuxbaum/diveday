import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The shop home's actions, by the one that used to be an inline closure in
 * `page.tsx` and so could not be imported: "Got it" on the first-week
 * orientation (2026-10-11 review, item 34) — and by the trip id every
 * evening act takes, which is a claim and is shape-checked before any query.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/db/user-accounts", () => ({ dismissOrientation: vi.fn() }));
vi.mock("@/db/recap", () => ({
  addCrewRecapPhoto: vi.fn(),
  canAddCrewRecapPhoto: vi.fn(),
  deleteCrewRecapPhoto: vi.fn(),
  deleteRecapPhoto: vi.fn(),
  hasSentTripRecap: vi.fn(),
  pauseTripRecapAutoSend: vi.fn(),
  sendTripRecaps: vi.fn(),
  setTripRecapShoutout: vi.fn(),
  unpauseTripRecapAutoSend: vi.fn(),
}));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((path: string, to: string = path) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { dismissOrientation } = await import("@/db/user-accounts");
const { revalidateAndRedirect } = await import("@/lib/navigation");
const { requireStaffSession } = await import("@/lib/session");
const {
  deleteCrewRecapPhotoAction,
  deleteRecapPhotoAction,
  dismissOrientationAction,
  saveRecapNoteAction,
  sendRecapAction,
  toggleRecapAutoSendPauseAction,
  uploadCrewRecapPhotoAction,
} = await import("./actions");

afterEach(() => vi.clearAllMocks());

describe("dismissOrientationAction", () => {
  it("dismisses it for the session's own person and lands back on the home", async () => {
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: "shop-1", shopSlug: "blue-mantis", personId: "person-7" },
    } as never);

    await expect(dismissOrientationAction()).rejects.toThrow("REDIRECT:/shop/blue-mantis");
    expect(dismissOrientation).toHaveBeenCalledWith({ db: "handle" }, "person-7");
    expect(revalidateAndRedirect).toHaveBeenCalledWith("/shop/blue-mantis");
  });

  it("writes nothing for a caller with no staff session", async () => {
    vi.mocked(requireStaffSession).mockRejectedValue(new Error("REDIRECT:/sign-in"));

    await expect(dismissOrientationAction()).rejects.toThrow("REDIRECT:/sign-in");
    expect(dismissOrientation).not.toHaveBeenCalled();
  });
});

/**
 * **A trip id that is not a uuid never reaches a query** (security review of
 * layer C2). A bound argument is not encrypted, so a crafted id is possible;
 * it gets the act's own refusal rather than a Postgres cast error.
 */
describe("the evening acts, given a trip id that is not a uuid", () => {
  const CRAFTED = "1 OR 1=1";
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const signedIn = () =>
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: "shop-1", shopSlug: "blue-mantis", personId: "person-7" },
    } as never);
  const INVALID = "REDIRECT:/shop/blue-mantis?notice=invalid";
  const HOME = "REDIRECT:/shop/blue-mantis";

  it.each([
    [
      "saveRecapNoteAction",
      () => saveRecapNoteAction(CRAFTED, form({ recapShoutout: "Mantas" })),
      INVALID,
    ],
    [
      "deleteRecapPhotoAction",
      () => deleteRecapPhotoAction(CRAFTED, form({ photoId: "p-1" })),
      HOME,
    ],
    ["uploadCrewRecapPhotoAction", () => uploadCrewRecapPhotoAction(CRAFTED, form({})), INVALID],
    [
      "deleteCrewRecapPhotoAction",
      () => deleteCrewRecapPhotoAction(CRAFTED, form({ photoId: "p-1" })),
      HOME,
    ],
    ["sendRecapAction", () => sendRecapAction(CRAFTED), INVALID],
    [
      "toggleRecapAutoSendPauseAction",
      () => toggleRecapAutoSendPauseAction(form({ tripId: CRAFTED, paused: "true" })),
      HOME,
    ],
  ] as const)("%s refuses it and opens no database", async (_name, act, refusal) => {
    signedIn();
    await expect(act()).rejects.toThrow(refusal);
    expect(getDb).not.toHaveBeenCalled();
  });
});
