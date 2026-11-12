import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ crew: vi.fn(), assign: vi.fn() }));
vi.mock("@/db/trips", () => ({ getTripCrewAssignments: mocks.crew, setTripCrew: mocks.assign }));
const { copyCrewIfAsked } = await import("./copy-departure");
it("reports the committed copy as missing crew when assignment times out", async () => {
  mocks.crew.mockResolvedValue([{ personId: "crew", tripRole: null }]);
  mocks.assign.mockRejectedValue(Object.assign(new Error("busy"), { code: "55P03" }));
  await expect(
    copyCrewIfAsked({} as never, "shop", { tripId: "source", sameCrew: "on" }, "copy", "actor"),
  ).resolves.toBe("busy");
});
it("does not hide unrelated assignment failures", async () => {
  mocks.crew.mockResolvedValue([{ personId: "crew", tripRole: null }]);
  mocks.assign.mockRejectedValue(new Error("unexpected"));
  await expect(
    copyCrewIfAsked({} as never, "shop", { tripId: "source", sameCrew: "on" }, "copy", "actor"),
  ).rejects.toThrow("unexpected");
});
