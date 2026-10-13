import { describe, expect, it } from "vitest";
import { dockRiderDoorOpen } from "./dock-rider-door";

const atTheDock = { isDeparture: true, sailed: false, stage: null, cancelled: false };

describe("dockRiderDoorOpen", () => {
  it("is open at the departure checkpoint until the boat leaves", () => {
    expect(dockRiderDoorOpen(atTheDock)).toBe(true);
    expect(dockRiderDoorOpen({ ...atTheDock, stage: { stage: "boarding" } })).toBe(true);
  });

  it("is shut once the boat has sailed or the crew says it left", () => {
    expect(dockRiderDoorOpen({ ...atTheDock, sailed: true })).toBe(false);
    expect(dockRiderDoorOpen({ ...atTheDock, stage: { stage: "underway" } })).toBe(false);
  });

  it("is shut after a dive", () => {
    expect(dockRiderDoorOpen({ ...atTheDock, isDeparture: false })).toBe(false);
  });

  /**
   * **A cancelled departure takes nobody** (#2394). The server refuses the
   * seat, but the form used to show, so a captain filled it in first.
   */
  it("is shut on a cancelled departure", () => {
    expect(dockRiderDoorOpen({ ...atTheDock, cancelled: true })).toBe(false);
  });
});
