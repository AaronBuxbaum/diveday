// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaffList } from "./types";
import { useCrewRoster } from "./use-crew-roster";

afterEach(cleanup);

const staff = [
  { person: { id: "dana", fullName: "Dana Reef" }, roles: ["divemaster"] },
  { person: { id: "omar", fullName: "Omar Keel" }, roles: ["captain"] },
] as unknown as StaffList;
// Stable references, as the server hands them: the hook resyncs whenever these change.
const crewRoles = { dana: null };
const crewOfDana = ["dana"];

function roster(
  updateCrewAction: Parameters<typeof useCrewRoster>[0]["updateCrewAction"],
  crewIds: string[] = crewOfDana,
) {
  return renderHook(
    (props: { crewIds: string[] }) =>
      useCrewRoster({
        tripId: "trip-1",
        staff,
        crewIds: props.crewIds,
        crewRoles,
        updateCrewAction,
      }),
    { initialProps: { crewIds } },
  );
}

describe("useCrewRoster", () => {
  it("adds a person only once the write stood", async () => {
    const write = vi.fn(async () => ({ ok: true }));
    const { result } = roster(write);
    await act(async () => result.current.handleAssign("omar"));
    expect(write).toHaveBeenCalledWith("trip-1", { personId: "omar", operation: "assign" });
    expect(result.current.localCrew.map((entry) => entry.id)).toEqual(["dana", "omar"]);
    expect(result.current.assignRefusal).toBeNull();
  });

  it("names a crew clash as its own refusal and keeps the crew as it was", async () => {
    const { result } = roster(async () => ({ ok: false, refusal: "crew_clash" as const }));
    await act(async () => result.current.handleAssign("omar"));
    expect(result.current.localCrew.map((entry) => entry.id)).toEqual(["dana"]);
    expect(result.current.assignRefusal).toEqual({ code: "crew_clash", name: "Omar Keel" });
  });

  it("reads a write that throws as the general refusal", async () => {
    const { result } = roster(async () => {
      throw new Error("offline");
    });
    await act(async () => result.current.handleAssign("omar"));
    expect(result.current.assignRefusal).toEqual({ code: "refused", name: "Omar Keel" });
  });

  it("does not write for someone already on the crew", async () => {
    const write = vi.fn(async () => ({ ok: true }));
    const { result } = roster(write);
    await act(async () => result.current.handleAssign("dana"));
    expect(write).not.toHaveBeenCalled();
  });

  it("sets a job on this sailing only once the write stood", async () => {
    const write = vi.fn(async () => ({ ok: true }));
    const { result } = roster(write);
    await act(async () => result.current.handleRole("dana", "divemaster"));
    expect(write).toHaveBeenCalledWith("trip-1", {
      personId: "dana",
      operation: "assign",
      tripRole: "divemaster",
    });
    expect(result.current.localRoles.dana).toBe("divemaster");
  });

  it("keeps an unassign's refusal general, whatever the outcome carries", async () => {
    const { result } = roster(async () => ({ ok: false, refusal: "crew_clash" as const }));
    await act(async () => result.current.handleUnassign("dana"));
    expect(result.current.localCrew.map((entry) => entry.id)).toEqual(["dana"]);
    expect(result.current.assignRefusal).toEqual({ code: "refused", name: "Dana Reef" });
  });

  it("takes a person off once the unassign stood", async () => {
    const { result } = roster(async () => ({ ok: true }));
    await act(async () => result.current.handleUnassign("dana"));
    expect(result.current.localCrew).toEqual([]);
  });

  it("resyncs from the server's crew and drops a stale refusal", async () => {
    const { result, rerender } = roster(async () => ({ ok: false }));
    await act(async () => result.current.handleAssign("omar"));
    expect(result.current.assignRefusal).not.toBeNull();
    rerender({ crewIds: ["dana", "omar"] });
    expect(result.current.localCrew.map((entry) => entry.id)).toEqual(["dana", "omar"]);
    expect(result.current.assignRefusal).toBeNull();
  });
});
