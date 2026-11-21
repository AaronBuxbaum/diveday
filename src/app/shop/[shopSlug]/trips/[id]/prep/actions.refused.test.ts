// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **A gear form that fails its checks lands back where it was, saying so**
 * (layer E; inventory item 22). A refused parse that still names its
 * departure returns to that departure's packing list with `?notice=invalid`,
 * which the list words ("That didn't save."); only a post that names no
 * departure falls back to the register.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/platform/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("../../../../../../features/accounts/session", () => ({
  requireStaffSession: vi.fn(async () => ({ user: { shopSlug: "reef", shopId: "shop" } })),
}));

const { releaseGearUnitAction, returnTripGearSetAction } = await import("./actions");
const tripId = "33333333-3333-4333-8333-333333333333";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

afterEach(() => vi.clearAllMocks());

describe("a refused gear form", () => {
  it("returns to the departure's packing list with the refusal", async () => {
    await expect(releaseGearUnitAction(form({ tripId, reservationId: "nope" }))).rejects.toThrow(
      `redirect:/shop/reef/trips/${tripId}/prep?notice=invalid#`,
    );
    await expect(returnTripGearSetAction(form({ tripId }))).rejects.toThrow(
      `redirect:/shop/reef/trips/${tripId}/prep?notice=invalid#`,
    );
  });

  it("falls back to the register when the post names no departure", async () => {
    await expect(releaseGearUnitAction(form({ reservationId: "nope" }))).rejects.toThrow(
      "redirect:/shop/reef/gear?notice=invalid",
    );
  });
});
