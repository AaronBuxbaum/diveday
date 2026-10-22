import { describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { BENCH_NOTE_SYSTEM, benchNote } from "./bench-note";
import {
  DESCRIPTION_DRAFT_SYSTEM,
  descriptionDraft,
  descriptionDraftCall,
} from "./description-draft";
import { mondayRead } from "./monday-read";
import { shopTranslation, sourceDigest } from "./shop-translate";
import { SITE_BRIEF_SYSTEM, siteBrief, siteBriefCall } from "./site-brief";

describe("copywriter", () => {
  const input = {
    kind: "trip" as const,
    words: { title: "North Wall two-tank" },
    requirement: { minCert: "Advanced Open Water", specialties: "Deep", nitrox: "required" },
    facts: { maxDepth: "30 m", price: "$140" },
    locale: "en-US",
  };

  it("is told never to say who it suits or name a level", () => {
    expect(DESCRIPTION_DRAFT_SYSTEM).toContain(
      "Write two or three sentences a diver reads before booking: what it is and what the day is like. Never say who it suits or who may come, never name a certification, a level, an age, a prerequisite or a depth limit, and never say a course certifies anyone or that no experience is needed: the page shows the requirement from the record.",
    );
    expect(DESCRIPTION_DRAFT_SYSTEM).not.toContain("who it suits.");
  });

  it("sends the record's requirement so a draft cannot contradict it", () => {
    const sent = JSON.parse(String(descriptionDraftCall(input).content));
    expect(sent.requirement).toEqual(input.requirement);
  });

  it("refuses a draft that names a level, an audience or a certification", () => {
    for (const primary of [
      "Two dives on the Spiegel Grove, a great day out for Open Water divers.",
      "A wall to {maxDepth} that suits newly certified divers.",
      "Perfect for beginners.",
    ]) {
      expect(descriptionDraft({ primary, spanish: null }, input)).toBeNull();
    }
    const course = {
      kind: "course" as const,
      words: { title: "Discover Scuba Diving", agency: "PADI" },
      facts: {},
      locale: "en-US",
    };
    for (const primary of [
      "Earn your PADI certification in a single morning, no experience needed.",
      "A first breath underwater, ages twelve and up.",
    ]) {
      expect(descriptionDraft({ primary, spanish: null }, course)).toBeNull();
    }
    expect(
      descriptionDraft(
        { primary: "Discover Scuba Diving with PADI in the calm of the bay.", spanish: null },
        course,
      )?.primary,
    ).toBe("Discover Scuba Diving with PADI in the calm of the bay.");
    expect(
      descriptionDraft(
        { primary: "A wall to {maxDepth}.", spanish: "Ideal para principiantes." },
        input,
      ),
    ).toEqual({ primary: "A wall to 30 m.", spanish: null });
  });

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
  const pinnacle = {
    locale: "en-US",
    words: {
      name: "The Pinnacle",
      difficulty: "advanced",
      current:
        "Strong current on the outgoing tide, up to 3 knots. Drift only, no swimming back to the boat.",
      plan: "Negative entry, descend straight to 25 m",
    },
    requirement: { minCert: "Advanced Open Water", specialties: "Deep" },
    facts: { maxDepth: "40 m" },
  };

  it("is told to keep every hazard as strong as given and never to say who it suits", () => {
    expect(SITE_BRIEF_SYSTEM).toContain(
      "description: two to four sentences on what the dive is like: the entry, the route and what you see. Never say who the dive suits or is for, never name a certification, a level or an amount of experience, and never call a dive easy, gentle or for beginners unless the difficulty given says so: the page shows the site's requirement itself.",
    );
    expect(SITE_BRIEF_SYSTEM).toContain(
      "Keep every current, entry and hazard you were given, as strongly as it was given: never soften one. Where the shop's words hold a number you have no placeholder for, say it is in the plan rather than writing the number in words.",
    );
    expect(JSON.parse(String(siteBriefCall(pinnacle).content)).requirement).toEqual(
      pinnacle.requirement,
    );
  });

  it("refuses a softened hazard, an audience, or a number in words", () => {
    for (const description of [
      "A dramatic pinnacle that drops to {maxDepth}, with a gentle drift that suits newly certified divers ready for a bigger dive.",
      "A relaxed wreck that suits Open Water divers comfortable at {maxDepth}.",
      "A drift of up to three knots past the pinnacle.",
      "An easy drift along the pinnacle.",
    ]) {
      expect(siteBrief({ description, marineLife: null }, pinnacle)).toBeNull();
    }
    expect(
      siteBrief(
        {
          description:
            "A negative entry and a strong drift on the outgoing tide down the pinnacle to {maxDepth}. The plan has the details.",
          marineLife: null,
        },
        pinnacle,
      )?.description,
    ).toMatch(/^A negative entry/);
    expect(
      siteBrief(
        { description: "An easy reef along the sand.", marineLife: null },
        { ...input, words: { name: "Molasses", difficulty: "beginner" } },
      )?.description,
    ).toBe("An easy reef along the sand.");
  });

  it("quotes the field's number and refuses an invented one", () => {
    expect(siteBrief({ description: "Shallow, to {maxDepth}.", marineLife: null }, input)).toEqual({
      description: "Shallow, to 12 m.",
      marineLifeDescription: null,
    });
    expect(siteBrief({ description: "Current of 2 knots.", marineLife: null }, input)).toBeNull();
    expect(
      siteBrief({ description: "Shallow.", marineLife: "Rays at 5 m." }, input)
        ?.marineLifeDescription,
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

  it("is told to say only what was done and to keep every warning", () => {
    expect(BENCH_NOTE_SYSTEM).toContain(
      "Say only what was done. Never say the gear is safe, ready to dive, certified or that it passed. Keep every recommendation, declined repair or do-not-use the notes give, as plainly as the notes say it.",
    );
  });

  it("refuses a safety claim, and a line that drops a do-not-use", () => {
    expect(
      benchNote(
        { message: "Your regulator has had its full annual service and is safe to dive." },
        input,
      ),
    ).toBeNull();
    expect(benchNote({ message: "Service done, it passed every test." }, input)).toBeNull();
    const warned = {
      ...input,
      technicianNotes:
        "Annual service. Tank valve leaking at the burst disk: do not use until replaced.",
    };
    expect(benchNote({ message: "Annual service done." }, warned)).toBeNull();
    expect(
      benchNote(
        {
          message:
            "Annual service done. The valve leaks: do not use the tank until it is replaced.",
        },
        warned,
      ),
    ).toMatch(/do not use/);
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
