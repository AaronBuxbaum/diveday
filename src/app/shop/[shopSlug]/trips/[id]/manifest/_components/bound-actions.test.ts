import { describe, expect, it, vi } from "vitest";
import { bindManifestActions } from "./bound-actions";

vi.mock("../actions", () => {
  const named = (name: string) => ({ bind: (_: unknown, context: unknown) => ({ name, context }) });
  return Object.fromEntries(
    [
      "addBuddyTeamMemberAction",
      "addManifestPrivateNoteAction",
      "crewRollCallAction",
      "dissolveBuddyTeamAction",
      "formBuddyTeamAction",
      "markTripCaughtUpAction",
      "preDepartureCheckAction",
      "removeBuddyTeamMemberAction",
      "rollCallAction",
      "saveExecutedDiveAction",
      "setTripStageAction",
    ].map((name) => [name, named(name)]),
  );
});

const context = { shopSlug: "blue-mantis", tripId: "trip-1", checkpoint: "after_dive_1" } as const;

describe("bindManifestActions", () => {
  it("binds the roll call, the dive log and the buddy teams to the open checkpoint", () => {
    const actions = bindManifestActions(context);
    expect(actions.rollCall).toEqual({ name: "rollCallAction", context });
    expect(actions.saveExecutedDive).toEqual({ name: "saveExecutedDiveAction", context });
    expect(actions.buddyTeams.formBuddyTeamAction).toEqual({
      name: "formBuddyTeamAction",
      context,
    });
  });

  it("binds the checkpoint-independent actions to the departure alone", () => {
    const actions = bindManifestActions(context);
    const narrow = { shopSlug: "blue-mantis", tripId: "trip-1" };
    for (const action of [
      actions.addPrivateNote,
      actions.markTripCaughtUp,
      actions.preDepartureCheck,
      actions.setTripStage,
    ]) {
      expect((action as unknown as { context: unknown }).context).toEqual(narrow);
    }
  });
});
