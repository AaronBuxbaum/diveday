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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/db/help-requests", () => ({
  assignHelpRequestHelper: vi.fn(),
  completeHelpRequest: vi.fn(),
  undoHelpRequestCompletion: vi.fn(),
}));
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
const { assignHelpRequestHelper, completeHelpRequest, undoHelpRequestCompletion } = await import(
  "@/db/help-requests"
);
const { revalidatePath } = await import("next/cache");
const { dismissOrientation } = await import("@/db/user-accounts");
const { revalidateAndRedirect } = await import("@/lib/navigation");
const { requireStaffSession } = await import("@/lib/session");
const {
  deleteCrewRecapPhotoAction,
  deleteRecapPhotoAction,
  dismissOrientationAction,
  helpRequestAction,
  saveRecapNoteAction,
  sendRecapAction,
  toggleRecapAutoSendPauseAction,
  uploadCrewRecapPhotoAction,
} = await import("./actions");

afterEach(() => vi.clearAllMocks());

describe("helpRequestAction", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    data.set("expectedRevision", "7");
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const signedIn = () =>
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: "shop-1", shopSlug: "blue-mantis", personId: "person-7" },
    } as never);

  it("rejects malformed request, helper, and expected status values before opening the db", async () => {
    signedIn();
    const previous = null;
    expect(
      await helpRequestAction(
        previous,
        form({
          requestId: "bad",
          helperPersonId: "bad",
          intent: "assign",
          expectedStatus: "requested",
        }),
      ),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await helpRequestAction(
        previous,
        form({
          requestId: "11111111-1111-4111-8111-111111111111",
          helperPersonId: "22222222-2222-4222-8222-222222222222",
          intent: "assign",
          expectedStatus: "anything",
        }),
      ),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each(["", "-1", "1.5", "1e2", "2147483648"])(
    "refuses malformed revision %s without opening the db",
    async (expectedRevision) => {
      signedIn();
      expect(
        await helpRequestAction(
          null,
          form({
            requestId: "11111111-1111-4111-8111-111111111111",
            helperPersonId: "22222222-2222-4222-8222-222222222222",
            intent: "complete",
            expectedRevision,
          }),
        ),
      ).toMatchObject({ ok: false, reason: "invalid" });
      expect(getDb).not.toHaveBeenCalled();
    },
  );

  it("assigns the submitted crew helper using the session tenant and revalidates Today", async () => {
    signedIn();
    vi.mocked(assignHelpRequestHelper).mockResolvedValue({
      ok: true,
      request: { revision: 8, helperPersonId: "22222222-2222-4222-8222-222222222222" },
    } as never);
    const result = await helpRequestAction(
      null,
      form({
        requestId: "11111111-1111-4111-8111-111111111111",
        helperPersonId: "22222222-2222-4222-8222-222222222222",
        intent: "assign",
        expectedStatus: "acknowledged",
        expectedRevision: "7",
      }),
    );
    expect(assignHelpRequestHelper).toHaveBeenCalledWith(
      { db: "handle" },
      expect.objectContaining({
        shopId: "shop-1",
        actorPersonId: "person-7",
        expectedStatus: "acknowledged",
        expectedRevision: 7,
      }),
    );
    expect(result).toMatchObject({ ok: true, effect: "assigned" });
    expect(revalidatePath).toHaveBeenCalledWith("/shop/blue-mantis");
  });

  it.each([
    ["complete", completeHelpRequest, "completed"],
    ["undo", undoHelpRequestCompletion, "undone"],
  ] as const)("routes %s through the named helper guard", async (intent, action, effect) => {
    signedIn();
    vi.mocked(action).mockResolvedValue({
      ok: true,
      request: { revision: 8, helperPersonId: "22222222-2222-4222-8222-222222222222" },
    } as never);
    const result = await helpRequestAction(
      null,
      form({
        requestId: "11111111-1111-4111-8111-111111111111",
        helperPersonId: "22222222-2222-4222-8222-222222222222",
        intent,
      }),
    );
    expect(action).toHaveBeenCalledWith(
      { db: "handle" },
      expect.objectContaining({
        shopId: "shop-1",
        actorPersonId: "person-7",
        expectedHelperPersonId: "22222222-2222-4222-8222-222222222222",
        expectedRevision: 7,
      }),
    );
    expect(result).toMatchObject({ ok: true, effect });
  });

  it("says an undo reopened the request when the helper no longer serves the departure", async () => {
    signedIn();
    vi.mocked(undoHelpRequestCompletion).mockResolvedValue({
      ok: true,
      request: { revision: 8, status: "requested", helperPersonId: null },
    } as never);
    const result = await helpRequestAction(
      null,
      form({
        requestId: "11111111-1111-4111-8111-111111111111",
        helperPersonId: "22222222-2222-4222-8222-222222222222",
        intent: "undo",
      }),
    );
    expect(result).toMatchObject({ ok: true, effect: "reopened" });
  });

  it("names the intent on a refusal, so a refused undo can be shown without its row", async () => {
    signedIn();
    vi.mocked(undoHelpRequestCompletion).mockResolvedValue({
      ok: false,
      reason: "invalid_transition",
    });
    const result = await helpRequestAction(
      null,
      form({
        requestId: "11111111-1111-4111-8111-111111111111",
        helperPersonId: "22222222-2222-4222-8222-222222222222",
        intent: "undo",
      }),
    );
    expect(result).toEqual({
      ok: false,
      requestId: "11111111-1111-4111-8111-111111111111",
      intent: "undo",
      reason: "stale",
    });
  });
});

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
