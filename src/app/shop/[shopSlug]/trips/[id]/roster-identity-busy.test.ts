import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), split: vi.fn(), repoint: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/bookings", () => ({
  confirmBookingIdentity: mocks.confirm,
  splitBookingIdentity: mocks.split,
}));
vi.mock("@/features/identity-repoint", () => ({ repointHeldBooking: mocks.repoint }));
vi.mock("@/features/session", () => ({
  requireShopSurface: async () => ({ session: { user: { shopId: "shop", personId: "staff" } } }),
}));
vi.mock("./roster-booking", () => ({ requireRosterBooking: vi.fn(), tripPath: () => "/trip" }));
const actions = await import("./roster-identity-actions");
const id = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
function form() {
  const data = new FormData();
  data.set("bookingId", id);
  data.set("toPersonId", target);
  data.set("fullName", "Diver");
  return data;
}
it("returns a retry notice when confirmation is busy", async () => {
  mocks.confirm.mockResolvedValue("busy");
  await expect(actions.confirmDiverIdentityAction("reef", id, form())).rejects.toThrow(
    "notice=schedule-roster-busy",
  );
});
it("returns a retry notice when splitting is busy", async () => {
  mocks.split.mockResolvedValue({ ok: false, reason: "busy" });
  await expect(actions.splitDiverIdentityAction("reef", id, form())).rejects.toThrow(
    "notice=schedule-roster-busy",
  );
});
it("returns a retry notice when repointing is busy", async () => {
  mocks.repoint.mockResolvedValue({ ok: false, reason: "busy" });
  await expect(actions.repointDiverIdentityAction("reef", id, form())).rejects.toThrow(
    "notice=schedule-roster-busy",
  );
});
