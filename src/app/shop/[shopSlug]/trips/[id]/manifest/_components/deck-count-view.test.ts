import { describe, expect, it } from "vitest";
import { deckCountView } from "./deck-count-view";
import { boardedAt, diver, notBackAt, t } from "./diver-roll-call-test-fixtures";
import { deckCountFacts } from "./head-count-view";
import { tripManifest } from "./manifest-page-test-fixtures";

const view = (overrides: Partial<Parameters<typeof deckCountView>[0]> = {}) =>
  deckCountView({
    t,
    locale: "en-US",
    timeZone: "America/New_York",
    record: null,
    facts: { expected: 12, markedAboard: 12, unmarked: [], notBackAboard: [], latestMarkAt: null },
    ...overrides,
  });

const counted = (n: number) => ({
  counted: n,
  recordedAt: new Date("2026-09-11T12:30:00.000Z"),
  recordedByName: "Keiko Tanaka",
});

describe("deckCountFacts", () => {
  it("expects who went out, marks who is aboard, and names who has no mark", () => {
    const manifest = tripManifest({
      checkpoint: "after_dive_1",
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz", rollCall: boardedAt() }),
        diver({ bookingId: "b-2", fullName: "Diego Marín", rollCall: notBackAt() }),
        diver({ bookingId: "b-3", fullName: "Omar Haddad" }),
        // Released by the desk with no word from the boat: not expected.
        diver({ bookingId: "b-4", fullName: "Lena Vogt", notHere: true }),
      ],
    });
    expect(deckCountFacts(manifest, "after_dive_1")).toMatchObject({
      expected: 3,
      markedAboard: 1,
      unmarked: ["Omar Haddad"],
      notBackAboard: ["Diego Marín"],
    });
  });

  it("after a dive, expects only who boarded: a no-show nobody tapped is not a head at sea (S3)", () => {
    const departure = tripManifest({
      checkpoint: "departure",
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz", rollCall: boardedAt() }),
        diver({ bookingId: "b-2", fullName: "Omar Haddad" }),
      ],
    });
    const dive1 = tripManifest({
      checkpoint: "after_dive_1",
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz", rollCall: boardedAt() }),
        diver({ bookingId: "b-2", fullName: "Omar Haddad" }),
      ],
    });
    const facts = deckCountFacts(dive1, "after_dive_1", [departure, dive1]);
    expect(facts.expected).toBe(1);
    expect(facts.unmarked).toEqual([]);
    // At the dock, the same untapped seat is still expected and named.
    expect(deckCountFacts(departure, "departure", [departure, dive1]).unmarked).toEqual([
      "Omar Haddad",
    ]);
  });

  it("knows the newest mark at the checkpoint, so a count before it is stale", () => {
    const manifest = tripManifest({
      checkpoint: "after_dive_1",
      divers: [diver({ bookingId: "b-1", rollCall: notBackAt() })],
    });
    expect(deckCountFacts(manifest, "after_dive_1").latestMarkAt).toEqual(notBackAt().occurredAt);
  });
});

describe("deckCountView", () => {
  it("says nothing about the deck before anybody counted", () => {
    expect(view().reading).toBeUndefined();
  });

  it("agrees in a quiet line when the deck matches", () => {
    const reading = view({ record: counted(12) }).reading;
    expect(reading).toEqual({
      tone: "agrees",
      lines: ["You count 12. The manifest agrees."],
      recordedLine: expect.stringContaining("Keiko Tanaka"),
    });
  });

  it("names the gap and the person with no mark, the loop's own example", () => {
    const reading = view({
      record: counted(11),
      facts: {
        expected: 12,
        markedAboard: 11,
        unmarked: ["Omar Haddad"],
        notBackAboard: [],
        latestMarkAt: null,
      },
    }).reading;
    expect(reading?.tone).toBe("differs");
    expect(reading?.lines).toEqual([
      "You count 11. The manifest says 12.",
      "No mark: Omar Haddad.",
    ]);
  });

  it("says the marks are ahead of the deck when a mark may be on the wrong person", () => {
    const reading = view({ record: counted(11) }).reading;
    expect(reading?.lines).toEqual([
      "You count 11. The manifest says 12.",
      "12 are marked aboard. A mark may be on the wrong person.",
    ]);
  });

  it("names five people and counts the rest", () => {
    const unmarked = ["A", "B", "C", "D", "E", "F", "G"];
    const reading = view({
      record: counted(5),
      facts: { expected: 12, markedAboard: 5, unmarked, notBackAboard: [], latestMarkAt: null },
    }).reading;
    expect(reading?.lines[1]).toBe("No mark: A, B, C, D, E and 2 more.");
  });

  it("never agrees while somebody is recorded not back aboard, and names them (M1)", () => {
    const reading = view({
      record: counted(12),
      facts: {
        expected: 12,
        markedAboard: 11,
        unmarked: [],
        notBackAboard: ["Diego Marín"],
        latestMarkAt: null,
      },
    }).reading;
    expect(reading?.tone).toBe("differs");
    expect(reading?.lines).toEqual([
      "You count 12. The manifest says 12.",
      "Recorded not back aboard: Diego Marín.",
    ]);
  });

  it("asks for a recount, with no verdict, when a mark is newer than the count (M2)", () => {
    const reading = view({
      record: counted(12),
      facts: {
        expected: 12,
        markedAboard: 12,
        unmarked: [],
        notBackAboard: [],
        latestMarkAt: new Date("2026-09-11T12:41:00.000Z"),
      },
    }).reading;
    expect(reading?.tone).toBe("stale");
    expect(reading?.lines).toHaveLength(1);
    expect(reading?.lines[0]).toMatch(/^You counted 12 at .*before the last mark\. Count again\.$/);
  });
});
