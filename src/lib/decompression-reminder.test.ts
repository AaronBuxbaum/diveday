import { describe, expect, it } from "vitest";
import { crewDives, needsDecompressionCardReminder } from "./decompression-reminder";

const marked = { exceedsNoDecoLimits: true };

describe("needsDecompressionCardReminder", () => {
  it("fires on a decompression departure with a diver aboard", () => {
    expect(
      needsDecompressionCardReminder({ ...marked, seats: [{ participantType: "diver" }] }),
    ).toBe(true);
    expect(
      needsDecompressionCardReminder({
        ...marked,
        seats: [
          { participantType: "rider" },
          { participantType: "snorkeler" },
          { participantType: "diver" },
        ],
      }),
    ).toBe(true);
  });

  it("reads an absent type as a diver, the stricter reading", () => {
    expect(needsDecompressionCardReminder({ ...marked, seats: [{}] })).toBe(true);
    expect(needsDecompressionCardReminder({ ...marked, seats: [{ participantType: null }] })).toBe(
      true,
    );
  });

  it("stays silent on a departure nobody marked as decompression diving", () => {
    expect(
      needsDecompressionCardReminder({ exceedsNoDecoLimits: false, seats: [{}], divingCrew: true }),
    ).toBe(false);
    expect(needsDecompressionCardReminder({ exceedsNoDecoLimits: undefined, seats: [{}] })).toBe(
      false,
    );
  });

  it("stays silent when only snorkelers and riders are booked and no guide dives", () => {
    expect(
      needsDecompressionCardReminder({
        ...marked,
        seats: [{ participantType: "snorkeler" }, { participantType: "rider" }],
      }),
    ).toBe(false);
  });

  it("fires for a guide in the water even when every guest is a snorkeler or rider", () => {
    expect(
      needsDecompressionCardReminder({
        ...marked,
        seats: [{ participantType: "snorkeler" }, { participantType: "rider" }],
        divingCrew: true,
      }),
    ).toBe(true);
  });

  it("goes silent once the last diver is released", () => {
    expect(
      needsDecompressionCardReminder({
        ...marked,
        seats: [{ participantType: "diver", released: true }, { participantType: "rider" }],
      }),
    ).toBe(false);
    expect(
      needsDecompressionCardReminder({
        ...marked,
        seats: [{ participantType: "diver", released: true }, { participantType: "diver" }],
      }),
    ).toBe(true);
  });

  it("stays silent on an empty boat", () => {
    expect(needsDecompressionCardReminder({ ...marked, seats: [] })).toBe(false);
  });
});

describe("crewDives", () => {
  it("counts instructors, assistant instructors and divemasters", () => {
    expect(crewDives([{ roles: ["divemaster"] }])).toBe(true);
    expect(crewDives([{ roles: ["captain"] }, { roles: ["instructor"] }])).toBe(true);
    expect(crewDives([{ roles: ["assistant_instructor"] }])).toBe(true);
  });

  it("does not count a captain or a deckhand", () => {
    expect(crewDives([{ roles: ["captain"] }, { roles: ["crew"] }, { roles: [] }])).toBe(false);
    expect(crewDives([])).toBe(false);
  });
});
