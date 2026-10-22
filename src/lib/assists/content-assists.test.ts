import { describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { benchNote } from "./bench-note";
import { descriptionDraft, descriptionDraftCall } from "./description-draft";
import { mondayRead } from "./monday-read";
import { shopTranslation, sourceDigest } from "./shop-translate";
import { siteBrief } from "./site-brief";

describe("copywriter", () => {
  const input = {
    kind: "trip" as const,
    words: { title: "North Wall two-tank", minCert: "Advanced Open Water" },
    facts: { maxDepth: "30 m", price: "$140" },
    locale: "en-US",
  };

  it("fills the record's facts into both languages", async () => {
    const provider = fakeClaude({
      reply: () =>
        fakeClaudeMessage({
          text: JSON.stringify({
            primary: "A wall to {maxDepth} for {price}.",
            spanish: "Una pared hasta {maxDepth}.",
          }),
        }),
    });
    const result = await callStructured(provider, descriptionDraftCall(input));
    expect(descriptionDraft(result.value, input)).toEqual({
      primary: "A wall to 30 m for $140.",
      spanish: "Una pared hasta 30 m.",
    });
    const sent = JSON.stringify(provider.requests[0]?.messages);
    expect(sent).toContain("maxDepth");
    expect(sent).not.toContain("30 m");
  });

  it("refuses a draft that writes its own number", () => {
    expect(descriptionDraft({ primary: "Dives to 40 m.", spanish: null }, input)).toBeNull();
    expect(descriptionDraft({ primary: "Fine.", spanish: "Hasta 40 m." }, input)).toEqual({
      primary: "Fine.",
      spanish: null,
    });
  });
});

describe("site brief", () => {
  const input = { locale: "en-US", words: { name: "Molasses" }, facts: { maxDepth: "12 m" } };
  it("quotes the field's number and refuses an invented one", () => {
    expect(siteBrief({ description: "Shallow, to {maxDepth}.", marineLife: null }, input)).toEqual({
      description: "Shallow, to 12 m.",
      marineLifeDescription: null,
    });
    expect(siteBrief({ description: "Current of 2 knots.", marineLife: null }, input)).toBeNull();
    expect(
      siteBrief({ description: "Easy.", marineLife: "Rays at 5 m." }, input)?.marineLifeDescription,
    ).toBeNull();
  });
});

describe("shop translate", () => {
  it("keeps every number and depth marker", () => {
    const source = "Two dives to {depth18}, 9 am, 4 hours.";
    expect(
      shopTranslation({ text: "Dos inmersiones hasta {depth18}, 9 h, 4 horas." }, source),
    ).toBe("Dos inmersiones hasta {depth18}, 9 h, 4 horas.");
    expect(
      shopTranslation({ text: "Dos inmersiones hasta {depth30}, 9 h, 4 horas." }, source),
    ).toBeNull();
    expect(shopTranslation({ text: "Hasta {depth18}, 10 h, 4 horas." }, source)).toBeNull();
    expect(shopTranslation({ text: "Hasta {depth18}, 4 horas." }, source)).toBeNull();
  });

  it("fingerprints the source so an old translation is never shown", () => {
    expect(sourceDigest("A reef")).toBe(sourceDigest(" A reef "));
    expect(sourceDigest("A reef")).not.toBe(sourceDigest("A wreck"));
  });
});

describe("monday read", () => {
  const sections: { kind: string; facts: Record<string, string> }[] = [
    { kind: "this_week", facts: { departures: "6", seatsFilled: "40" } },
    { kind: "waivers", facts: { divers: "3" } },
  ];
  it("quotes only the section's own numbers, one sentence per section", () => {
    expect(
      mondayRead(
        {
          sentences: [
            { section: "this_week", text: "{this_week.departures} boats go out." },
            { section: "this_week", text: "Busy." },
            {
              section: "waivers",
              text: "{this_week.seatsFilled} seats, {waivers.divers} waivers.",
            },
            { section: "reviews", text: "Reviews came in." },
          ],
        },
        sections,
      ),
    ).toEqual([{ section: "this_week", text: "6 boats go out." }]);
  });

  it("drops a sentence with a number of its own", () => {
    expect(
      mondayRead({ sentences: [{ section: "waivers", text: "3 divers owe waivers." }] }, sections),
    ).toEqual([]);
  });
});

describe("bench note", () => {
  const input = {
    reportedProblem: "Free-flows",
    technicianNotes: "Replaced mouthpiece, IP 9.5 bar",
    outcome: null,
    locale: "en-US",
  };
  it("refuses a number the bench notes do not hold", () => {
    expect(benchNote({ message: "New mouthpiece, tested at 9.5 bar." }, input)).toBe(
      "New mouthpiece, tested at 9.5 bar.",
    );
    expect(benchNote({ message: "Tested at 10 bar." }, input)).toBeNull();
  });
});

describe("monday facts", () => {
  it("formats the section's numbers and leaves out nested parts", async () => {
    const { mondaySectionFacts } = await import("./monday-read");
    expect(
      mondaySectionFacts(
        {
          kind: "money",
          revenueCents: 124_000,
          lastYearRevenueCents: null,
          tipsCents: 0,
          owed: { count: 2 },
          currency: "usd",
        },
        "en-US",
      ),
    ).toEqual({ kind: "money", facts: { revenueCents: "$1,240.00", tipsCents: "$0.00" } });
    expect(
      mondaySectionFacts({ kind: "waivers", divers: 1200, departures: 3 }, "es-ES").facts,
    ).toEqual({
      divers: "1200",
      departures: "3",
    });
  });
});
