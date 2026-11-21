import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/features/after-the-dive/dive-participation", () => ({
  recordDiveParticipation: vi.fn(),
}));
vi.mock("@/features/accounts/session", () => ({ requireShopSurface: vi.fn() }));

const { revalidatePath } = await import("next/cache");
const { recordDiveParticipation } = await import("@/features/after-the-dive/dive-participation");
const { requireShopSurface } = await import("@/features/accounts/session");
const { recordDiveParticipationAction } = await import("./dive-participation-action");

const SHOP_ID = "00000000-0000-4000-8000-000000000001";
const PERSON_ID = "00000000-0000-4000-8000-0000000000c1";
const TRIP_ID = "00000000-0000-4000-8000-0000000000aa";
const SEAT = "00000000-0000-4000-8000-0000000000b1";
const ctx = { shopSlug: "blue-mantis", tripId: TRIP_ID, checkpoint: "after_dive_2" } as const;

/** Issue #4307: the action re-proves everything on the server and says only ok or not. */
describe("recordDiveParticipationAction", () => {
  beforeEach(() => {
    vi.mocked(recordDiveParticipation).mockReset();
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(requireShopSurface).mockReset();
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: { user: { shopId: SHOP_ID, personId: PERSON_ID } },
    } as never);
  });

  it("writes the note for the dive the checkpoint follows, as the session's staffer and shop", async () => {
    vi.mocked(recordDiveParticipation).mockResolvedValue({ ok: true });
    await expect(recordDiveParticipationAction(ctx, SEAT, "sat_out")).resolves.toEqual({
      ok: true,
    });
    expect(recordDiveParticipation).toHaveBeenCalledWith(
      { db: "handle" },
      {
        shopId: SHOP_ID,
        tripId: TRIP_ID,
        bookingId: SEAT,
        diveNumber: 2,
        participation: "sat_out",
        recordedByPersonId: PERSON_ID,
      },
    );
    expect(revalidatePath).toHaveBeenCalledOnce();
  });

  it("turns away a caller who is not this shop's staff before any write", async () => {
    vi.mocked(requireShopSurface).mockRejectedValue(new Error("REDIRECT:/sign-in"));
    await expect(recordDiveParticipationAction(ctx, SEAT, "sat_out")).rejects.toThrow("REDIRECT");
    expect(recordDiveParticipation).not.toHaveBeenCalled();
  });

  for (const [what, args, checkpoint] of [
    ["a seat that is not an id", ["not-an-id", "sat_out"], "after_dive_2"],
    ["a state it does not know", [SEAT, "maybe"], "after_dive_2"],
    ["the dock, which has no dive", [SEAT, "sat_out"], "departure"],
  ] as const) {
    it(`refuses ${what} without touching the store`, async () => {
      await expect(
        recordDiveParticipationAction({ ...ctx, checkpoint }, args[0], args[1]),
      ).resolves.toEqual({ ok: false });
      expect(recordDiveParticipation).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  }

  for (const reason of ["seat_not_found", "dive_invalid", "trip_not_found", "staff_not_found"]) {
    it(`says not ok when the store refuses with ${reason}, and refreshes nothing`, async () => {
      vi.mocked(recordDiveParticipation).mockResolvedValue({ ok: false, reason } as never);
      await expect(recordDiveParticipationAction(ctx, SEAT, "dived")).resolves.toEqual({
        ok: false,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  }

  it("says not ok, never a crash page, when the write throws", async () => {
    vi.mocked(recordDiveParticipation).mockRejectedValue(new Error("lock timeout"));
    await expect(recordDiveParticipationAction(ctx, SEAT, "dived")).resolves.toEqual({
      ok: false,
    });
  });
});
