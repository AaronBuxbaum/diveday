import { describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
vi.mock("../notes-actions", () => {
  const door =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    addInternalNoteAction: door("add"),
    deleteInternalNoteAction: door("delete"),
    restoreInternalNoteAction: door("restore"),
  };
});

const { noteRosterActions } = await import("./note-roster-actions");

describe("noteRosterActions", () => {
  it("binds all three note doors to this shop and departure", async () => {
    const actions = noteRosterActions("blue-mantis", "trip-1");
    const form = new FormData();
    await actions.addInternalNoteAction(form);
    await actions.deleteInternalNoteAction(form);
    await actions.restoreInternalNoteAction(form);
    expect(calls).toEqual([
      ["add", "blue-mantis", "trip-1", form],
      ["delete", "blue-mantis", "trip-1", form],
      ["restore", "blue-mantis", "trip-1", form],
    ]);
  });
});
