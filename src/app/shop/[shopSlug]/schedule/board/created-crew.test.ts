import { expect, it, vi } from "vitest";

const assign = vi.hoisted(() => vi.fn());
vi.mock("@/db/trips", () => ({ setTripCrew: assign }));
vi.mock("@/features/navigation", () => ({
  revalidateAndRedirect: (_path: string, url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
const { assignCrewAfterCreate } = await import("./created-crew");
it("states that the departure exists when its crew assignment times out", async () => {
  assign.mockRejectedValue(Object.assign(new Error("busy"), { code: "55P03" }));
  await expect(
    assignCrewAfterCreate(
      {} as never,
      "shop",
      "trip",
      ["crew"],
      "actor",
      "/shop/reef/schedule/board",
    ),
  ).rejects.toThrow("builder=added-crew-busy");
});
it("does not hide unrelated assignment errors", async () => {
  assign.mockRejectedValue(new Error("unexpected"));
  await expect(
    assignCrewAfterCreate({} as never, "shop", "trip", ["crew"], "actor", "/board"),
  ).rejects.toThrow("unexpected");
});
