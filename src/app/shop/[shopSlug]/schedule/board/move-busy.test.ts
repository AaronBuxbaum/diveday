import { expect, it, vi } from "vitest";

const move = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/trips", async (original) => ({
  ...(await original<typeof import("@/db/trips")>()),
  moveTrip: move,
}));
vi.mock("@/db/authz", async (original) => ({
  ...(await original<typeof import("@/db/authz")>()),
  canPersonConfigureTrips: async () => true,
}));
vi.mock("@/features/session", () => ({
  requireShopSurface: async () => ({
    db: {},
    shop: { id: "shop", timezone: "UTC" },
    session: { user: { shopId: "shop", personId: "staff" } },
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
const { moveDepartureAction } = await import("./actions");
function form() {
  const data = new FormData();
  data.set("tripId", "00000000-0000-4000-8000-000000000001");
  data.set("date", "2035-08-04");
  data.set("startTime", "09:00");
  return data;
}
it("says to retry when the schedule lock times out", async () => {
  move.mockRejectedValue(Object.assign(new Error("lock wait"), { code: "55P03" }));
  await expect(moveDepartureAction("reef", form())).rejects.toThrow("builder=schedule-busy");
});
it("does not disguise unrelated failures as contention", async () => {
  move.mockRejectedValue(new Error("unexpected"));
  await expect(moveDepartureAction("reef", form())).rejects.toThrow("unexpected");
});
