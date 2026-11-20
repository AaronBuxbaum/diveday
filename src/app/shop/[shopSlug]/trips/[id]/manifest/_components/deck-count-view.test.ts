import { describe, expect, it } from "vitest";
import { deckCountView } from "./deck-count-view";
import { diver, notBackAt } from "./diver-roll-call-test-fixtures";
import { crewMember, tripManifest } from "./manifest-page-test-fixtures";

const aboard = {
  state: "boarded" as const,
  occurredAt: new Date(0),
  recordedByName: "Sol",
  note: null,
};

/** Three divers and two crew; who is aboard varies by test. */
function manifest(options: { diversAboard: number; crewAboard: number; missing?: boolean }) {
  return tripManifest({
    divers: Array.from({ length: 3 }, (_, index) =>
      diver({
        bookingId: `b-${index}`,
        personId: `p-${index}`,
        rollCall:
          options.missing && index === 2
            ? notBackAt()
            : index < options.diversAboard
              ? aboard
              : undefined,
      }),
    ),
    crew: [
      crewMember({ id: "c-1", rollCall: options.crewAboard > 0 ? aboard : undefined }),
      crewMember({ id: "c-2", rollCall: options.crewAboard > 1 ? aboard : undefined }),
    ] as ReturnType<typeof crewMember>[],
  });
}

describe("deckCountView", () => {
  it("does not call a deck count a match while a person needs recounting", () => {
    const view = manifest({ diversAboard: 1, crewAboard: 1 });
    const person = view.divers[1];
    if (!person) throw new Error("fixture missing diver");
    view.divers[1] = { ...person, recountRequired: true };
    expect(deckCountView(view, "departure", new Map([["departure", 2]])).comparison).toBeNull();
  });
  it("says nothing until a count is entered at this checkpoint", () => {
    const view = deckCountView(
      manifest({ diversAboard: 3, crewAboard: 2 }),
      "departure",
      new Map([["after_dive_1", 4]]),
    );
    expect(view).toEqual({ counted: null, aboard: 5, comparison: null });
  });

  it("matches when the deck count is divers and crew marked aboard", () => {
    expect(
      deckCountView(
        manifest({ diversAboard: 3, crewAboard: 2 }),
        "departure",
        new Map([["departure", 5]]),
      ).comparison,
    ).toEqual({ kind: "matches", counted: 5 });
  });

  it("names both numbers when the deck counts one fewer than the screen", () => {
    expect(
      deckCountView(
        manifest({ diversAboard: 3, crewAboard: 2 }),
        "departure",
        new Map([["departure", 4]]),
      ).comparison,
    ).toEqual({ kind: "differs", counted: 4, aboard: 5 });
  });

  it("never counts somebody awaiting a call or recorded not back as aboard", () => {
    const view = deckCountView(
      manifest({ diversAboard: 1, crewAboard: 1, missing: true }),
      "departure",
      new Map([["departure", 2]]),
    );
    expect(view.aboard).toBe(2);
    expect(view.comparison).toEqual({ kind: "matches", counted: 2 });
  });
});
