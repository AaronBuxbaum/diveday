import { describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { recapLine } from "./recap-line";
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
    sites: ["North Wall"],
    species: [{ slug: "green-sea-turtle", name: "Green sea turtle", count: 2 }],
    conditions: { waterTemp: "26°C" },
  };
  const catalog = [
    { slug: "green-sea-turtle", names: ["Green sea turtle", "Tortuga verde"] },
    { slug: "whale-shark", names: ["Whale shark", "Tiburón ballena"] },
    { slug: "sea-turtle-hawksbill", names: ["Turtle"] },
  ];

  it("fills sites, species and conditions from the log", () => {
    expect(
      recapLine(
        { text: "{species:green-sea-turtle} at {site1}, {waterTemp} water." },
        log,
        catalog,
      ),
    ).toBe("Green sea turtle at North Wall, 26°C water.");
  });

  it("refuses a species nobody logged, in either language", () => {
    expect(recapLine({ text: "A whale shark at {site1}." }, log, catalog)).toBeNull();
    expect(recapLine({ text: "Un tiburón ballena en {site1}." }, log, catalog)).toBeNull();
    expect(recapLine({ text: "{species:whale-shark} at {site1}." }, log, catalog)).toBeNull();
  });

  it("does not read a logged name's own words as another species", () => {
    expect(recapLine({ text: "{species:green-sea-turtle} at {site1}." }, log, catalog)).toBe(
      "Green sea turtle at North Wall.",
    );
  });

  it("refuses a number the crew did not record", () => {
    expect(
      recapLine({ text: "Two turtles at {site1}, 20 m visibility." }, log, catalog),
    ).toBeNull();
  });
});
