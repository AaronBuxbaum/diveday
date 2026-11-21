// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../../../../features/accounts/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/db/fly-safe-correction", () => ({ acknowledgeFlySafeFollowUp: vi.fn() }));

const { acknowledgeFlySafeFollowUp } = await import("@/db/fly-safe-correction");
const { revalidatePath } = await import("next/cache");
const { requireShopSurface } = await import("../../../../../features/accounts/session");
const { acknowledgeFlySafeAction } = await import("./fly-safe-follow-up-actions");
const shopId = "11111111-1111-4111-8111-111111111111";
const actorPersonId = "22222222-2222-4222-8222-222222222222";
const tripId = "33333333-3333-4333-8333-333333333333";
const bookingId = "44444444-4444-4444-8444-444444444444";

describe("flying guidance acknowledgement", () => {
  it("requires the staff shop and records the signed-in actor", async () => {
    vi.mocked(requireShopSurface).mockResolvedValue({
      db: {},
      shop: { id: shopId },
      session: { user: { personId: actorPersonId } },
    } as never);
    await acknowledgeFlySafeAction("reef", tripId, bookingId, "a".repeat(64));
    expect(requireShopSurface).toHaveBeenCalledWith("reef");
    // Today and the follow-up's own trip, whose Wrapped up lists it.
    expect(revalidatePath).toHaveBeenCalledWith("/shop/reef");
    expect(revalidatePath).toHaveBeenCalledWith(`/shop/reef/trips/${tripId}`);
    expect(acknowledgeFlySafeFollowUp).toHaveBeenCalledWith(
      {},
      { shopId, actorPersonId, bookingId, fingerprint: "a".repeat(64) },
    );
  });
  it("rejects an invalid acknowledgement token", async () => {
    vi.mocked(acknowledgeFlySafeFollowUp).mockClear();
    await acknowledgeFlySafeAction("reef", tripId, bookingId, "invalid");
    expect(acknowledgeFlySafeFollowUp).not.toHaveBeenCalled();
  });
});
