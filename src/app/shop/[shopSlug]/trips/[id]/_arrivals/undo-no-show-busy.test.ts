import { expect, it, vi } from "vitest";

const undo = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/features/session", () => ({
  requireShopSurface: async () => ({ session: { user: { shopId: "shop", personId: "staff" } } }),
}));
vi.mock("@/features/no-show", () => ({ undoBookingNoShow: undo, markBookingNoShow: vi.fn() }));
vi.mock("../roster-booking", () => ({ requireRosterBooking: vi.fn() }));
const { undoNoShowAction } = await import("./actions");
const trip = "00000000-0000-4000-8000-000000000001";
const booking = "00000000-0000-4000-8000-000000000002";
function form() {
  const data = new FormData();
  data.set("bookingId", booking);
  return data;
}
it("returns a retry notice on lock timeout", async () => {
  undo.mockRejectedValue(Object.assign(new Error("lock wait"), { code: "55P03" }));
  await expect(undoNoShowAction("reef", trip, form())).rejects.toThrow("notice=schedule-busy");
});
it("does not disguise unrelated errors", async () => {
  undo.mockRejectedValue(new Error("unexpected"));
  await expect(undoNoShowAction("reef", trip, form())).rejects.toThrow("unexpected");
});
