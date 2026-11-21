import { describe, expect, it } from "vitest";
import { summarizeRequestDay } from "./rules";

describe("summarizeRequestDay", () => {
  it("keeps first choices, alternatives and unknown party sizes separate", () => {
    expect(
      summarizeRequestDay([
        {
          match: "preferred",
          request: {
            partySize: 3,
            courseId: null,
            courseTitle: null,
            interest: "Reef",
            charter: false,
          },
        },
        {
          match: "alternate",
          request: {
            partySize: null,
            courseId: null,
            courseTitle: null,
            interest: "Reef",
            charter: false,
          },
        },
        {
          match: "nearby",
          request: {
            partySize: 2,
            courseId: "course",
            courseTitle: "Open water",
            interest: null,
            charter: true,
          },
        },
      ]),
    ).toEqual({
      choices: { preferred: 1, alternate: 1, nearby: 1 },
      knownDivers: 5,
      unknownParties: 1,
      charterParties: 1,
      interests: [
        { key: "interest:Reef", title: "Reef", count: 2 },
        { key: "course:course", title: "Open water", count: 1 },
      ],
    });
  });
  it("does not merge courses with free text or invent interests", () => {
    expect(
      summarizeRequestDay([
        {
          match: "preferred",
          request: {
            partySize: 1,
            courseId: "c",
            courseTitle: "Reef",
            interest: null,
            charter: false,
          },
        },
        {
          match: "preferred",
          request: {
            partySize: 1,
            courseId: null,
            courseTitle: null,
            interest: "Reef",
            charter: false,
          },
        },
      ]).interests,
    ).toHaveLength(2);
    expect(summarizeRequestDay([]).knownDivers).toBe(0);
  });
});
