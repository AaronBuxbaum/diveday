import { describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { RECAP_LINE_SYSTEM, recapLine, recapLineCall } from "./recap-line";
import { sightingMatches, sightingsMatchCall } from "./sightings-match";

const chips = [
  { slug: "green-sea-turtle", name: "Green sea turtle" },
  { slug: "spotted-eagle-ray", name: "Spotted eagle ray" },
];

describe("sightings match", () => {
  it("proposes offered chips with counts", async () => {
    const provider = fakeClaude({
      reply: () =>
        fakeClaudeMessage({
          text: JSON.stringify({
            species: [
              { slug: "green-sea-turtle", count: 2 },
              { slug: "spotted-eagle-ray", count: 1 },
            ],
          }),
        }),
    });
    const result = await callStructured(
      provider,
      sightingsMatchCall("two turtles and an eagle ray", chips),
    );
    expect(sightingMatches(result.value, chips)).toEqual([
      { slug: "green-sea-turtle", count: 2 },
      { slug: "spotted-eagle-ray", count: 1 },
    ]);
  });

  it("cannot answer a species the reef does not offer", async () => {
    const provider = fakeClaude({
      reply: () =>
        fakeClaudeMessage({
          text: JSON.stringify({ species: [{ slug: "whale-shark", count: 1 }] }),
        }),
    });
    const result = await callStructured(provider, sightingsMatchCall("a whale shark!", chips));
    expect(result.value).toBeNull();
    // And the mapping refuses it again, whatever the schema let through.
    expect(sightingMatches({ species: [{ slug: "whale-shark", count: 1 }] }, chips)).toEqual([]);
  });

  it("clamps counts to a whole 1 to 20 and merges repeats", () => {
    expect(
      sightingMatches(
        {
          species: [
            { slug: "green-sea-turtle", count: 0 },
            { slug: "green-sea-turtle", count: 2.6 },
            { slug: "spotted-eagle-ray", count: 500 },
          ],
        },
        chips,
      ),
    ).toEqual([
      { slug: "green-sea-turtle", count: 4 },
      { slug: "spotted-eagle-ray", count: 20 },
    ]);
  });
});

describe("recap line", () => {
  const log = {
    locale: "en-US",
    sites: [
      {
        name: "North Wall",
        species: [{ slug: "green-sea-turtle", name: "Green sea turtle", count: 2 }],
      },
    ],
    conditions: { waterTemp: "26°C" },
  };
  const catalog = [
    { slug: "green-sea-turtle", names: ["Green sea turtle", "Tortuga verde"] },
    { slug: "spotted-eagle-ray", names: ["Spotted eagle ray", "Raya águila"] },
    { slug: "whale-shark", names: ["Whale shark", "Tiburón ballena"] },
    { slug: "sea-turtle-hawksbill", names: ["Turtle"] },
  ];

  it("fills sites, species, counts and conditions from the log", () => {
    expect(
      recapLine(
        {
          text: "{count:1:green-sea-turtle} {species:1:green-sea-turtle} at {site1}, {waterTemp} water.",
        },
        log,
        catalog,
      ),
    ).toBe("2 green sea turtle at North Wall, 26°C water.");
  });

  it("sends the sightings grouped by the site they were logged at", () => {
    const call = recapLineCall(twoSites);
    expect(JSON.parse(String(call.content))).toMatchObject({
      sites: [
        {
          placeholder: "{site1}",
          name: "North Wall",
          sightings: [
            { species: "{species:1:green-sea-turtle}", count: "{count:1:green-sea-turtle}" },
          ],
        },
        {
          placeholder: "{site2}",
          name: "The Pinnacle",
          sightings: [
            { species: "{species:2:spotted-eagle-ray}", count: "{count:2:spotted-eagle-ray}" },
          ],
        },
      ],
    });
    expect(call.content).not.toMatch(/"count":\s*\d/);
  });

  const twoSites = {
    locale: "en-US",
    sites: [
      {
        name: "North Wall",
        species: [{ slug: "green-sea-turtle", name: "Green sea turtle", count: 1 }],
      },
      {
        name: "The Pinnacle",
        species: [{ slug: "spotted-eagle-ray", name: "Spotted eagle ray", count: 1 }],
      },
    ],
    conditions: {},
  };

  it("refuses a species put at a site it was not logged at", () => {
    expect(
      recapLine(
        { text: "{species:1:green-sea-turtle} at {site2} and {species:2:spotted-eagle-ray}." },
        twoSites,
        catalog,
      ),
    ).toBeNull();
    expect(
      recapLine(
        {
          text: "{species:1:green-sea-turtle} at {site1}. {species:2:spotted-eagle-ray} at {site2}.",
        },
        twoSites,
        catalog,
      ),
    ).toBe("Green sea turtle at North Wall. Spotted eagle ray at The Pinnacle.");
  });

  it("refuses a count written as a word, in either language", () => {
    for (const text of [
      "Two {species:1:green-sea-turtle} at {site1}.",
      "A dozen {species:1:green-sea-turtle} at {site1}.",
      "Tres {species:1:green-sea-turtle} en {site1}.",
      "Una docena de {species:1:green-sea-turtle} en {site1}.",
    ]) {
      expect(recapLine({ text }, twoSites, catalog)).toBeNull();
    }
  });

  it("refuses a species nobody logged, in either language", () => {
    expect(recapLine({ text: "A whale shark at {site1}." }, log, catalog)).toBeNull();
    expect(recapLine({ text: "Un tiburón ballena en {site1}." }, log, catalog)).toBeNull();
    expect(recapLine({ text: "{species:1:whale-shark} at {site1}." }, log, catalog)).toBeNull();
  });

  it("does not read a logged name's own words as another species", () => {
    expect(recapLine({ text: "{species:1:green-sea-turtle} at {site1}." }, log, catalog)).toBe(
      "Green sea turtle at North Wall.",
    );
  });

  it("refuses a number the crew did not record", () => {
    expect(recapLine({ text: "Turtles at {site1}, 20 m visibility." }, log, catalog)).toBeNull();
  });

  it("is told to say what was seen and never to judge the day", () => {
    expect(RECAP_LINE_SYSTEM).toContain(
      "Say what was seen and where. Never judge the day or the conditions (good, great, perfect, calm).",
    );
    expect(RECAP_LINE_SYSTEM).not.toContain("Warm and specific");
  });
});
