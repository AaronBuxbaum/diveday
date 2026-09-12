/**
 * The judged pass puts a model's opinion into a tracker one person reads, and
 * the three things that make that safe are all mechanical: the fingerprint
 * survives a rewording, the parser drops anything it cannot verify, and the
 * persona's section comes from the doc rather than from a copy here. All three
 * are proved without a browser and without a network — `judge()` takes its
 * `ask` and its `readImage` injected, and nothing in this file makes a request.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { carriesFingerprint, fingerprint } from "./findings.mjs";
import {
  JUDGED_FINDINGS_PER_PERSONA,
  judge,
  judgedProbeId,
  normaliseClaim,
  parseJudgeResponse,
  personaSection,
  renderJudgePrompt,
} from "./judge.mjs";
import { JUDGE_PERSONAS, personaById, probeFor } from "./personas.mjs";

const personasMarkdown = readFileSync(path.join(process.cwd(), "docs/product/personas.md"), "utf8");

const nadia = personaById("nadia");
const kai = personaById("kai");

const stops = [
  { path: "/s/blue-mantis", personas: ["nadia"], screenshot: "one.png" },
  { path: "/s/blue-mantis/courses", personas: ["nadia"], screenshot: "two.png" },
];

const reply = (findings) => JSON.stringify({ findings });

describe("the persona's own section", () => {
  /**
   * Sliced out of the doc rather than copied here, so the doc stays the
   * contract. The risk that buys is a renumbered or renamed heading silently
   * sending an empty section to the model, which would produce confident
   * findings about nothing — hence a test per judged persona.
   */
  it("returns Nadia's entry, jargon line and all", () => {
    const section = personaSection(personasMarkdown, nadia);

    expect(section).toContain("Hold the line on");
    expect(section).toContain("jargon");
    expect(section).not.toContain("## 2.");
  });

  it("returns Kai's entry, including the line about naming the actual rule", () => {
    const section = personaSection(personasMarkdown, kai);

    expect(section).toContain("names the actual rule");
    expect(section).not.toContain("## 12.");
  });

  it("has a section for every persona the judged pass reads", () => {
    for (const id of JUDGE_PERSONAS) {
      expect(personaSection(personasMarkdown, personaById(id)), id).toBeTruthy();
    }
  });

  it("returns nothing rather than the rest of the file for a persona that is not there", () => {
    expect(personaSection(personasMarkdown, { number: 99, name: "Nobody" })).toBeNull();
    expect(personaSection(personasMarkdown, null)).toBeNull();
  });
});

describe("the normalised claim, which is what makes a judgement fingerprintable", () => {
  it("collides two wordings of the same claim", () => {
    const one = normaliseClaim('The booking refusal says "Not available" without naming a reason.');
    const two = normaliseClaim("booking refusal says ‘Not available’, without naming a reason!");

    expect(one).toBe(two);
  });

  it("ignores casing, punctuation and quote style", () => {
    expect(normaliseClaim("BCD is never explained")).toBe(
      normaliseClaim("“BCD” is never — explained!"),
    );
  });

  it("keeps two genuinely different claims apart", () => {
    expect(normaliseClaim("BCD is never explained on this page")).not.toBe(
      normaliseClaim("nitrox is never explained on this page"),
    );
  });

  /**
   * Truncation is what keeps a second run's extra clause from minting a second
   * issue. It only bites past twelve words, which is why both wordings here are
   * longer than that — a short claim is fingerprinted whole, on purpose.
   */
  it("stops at twelve words, so a trailing clause cannot mint a second issue", () => {
    const short = normaliseClaim(
      "the course page never explains what a two tank trip is for a first timer",
    );
    const long = normaliseClaim(
      "The course page never explains what a two-tank trip is for a first-timer, which Nadia would close the tab over.",
    );

    expect(short).toBe(long);
    expect(short.split(" ")).toHaveLength(12);
  });
});

describe("the judged probe id", () => {
  it("is the same for two wordings of one claim, and different for two claims", () => {
    const base = { persona: nadia, path: "/s/blue-mantis" };
    const one = judgedProbeId({ ...base, claim: 'It says "Not available" and no reason.' });
    const two = judgedProbeId({ ...base, claim: "it says Not available and no reason" });
    const other = judgedProbeId({ ...base, claim: "the price is shown in the wrong currency" });

    expect(one).toBe(two);
    expect(one).not.toBe(other);
  });

  it("keeps the same claim on two surfaces apart", () => {
    const claim = "the jargon is never explained";
    expect(judgedProbeId({ persona: nadia, path: "/a", claim })).not.toBe(
      judgedProbeId({ persona: nadia, path: "/b", claim }),
    );
  });

  it("round-trips through the fingerprint the dedupe and the suppression both read", () => {
    const probe = judgedProbeId({ persona: kai, path: "/shop/blue-mantis", claim: "a claim" });

    expect(carriesFingerprint(fingerprint(probe), probe)).toBe(true);
  });

  /** The other half of that round trip: `probeFor` has to recognise what `judge.mjs` mints. */
  it("is recognised by the probe registry, which names the persona back", () => {
    const probe = probeFor(
      judgedProbeId({ persona: nadia, path: "/s/blue-mantis/courses", claim: "a claim" }),
    );

    expect(probe).not.toBeNull();
    expect(probe.persona).toBe("nadia");
    expect(probe.line).toContain("Nadia");
    expect(probe.title(1)).toContain("/s/blue-mantis/courses");
  });

  it("is not recognised when it names a persona the registry does not have", () => {
    expect(probeFor("judged:nobody:/a:0123abcd")).toBeNull();
  });
});

describe("what comes back from the model", () => {
  const parse = (text) => parseJudgeResponse(text, { stops, persona: nadia });

  it("shapes a reply into findings `classify` can consume", () => {
    const [only] = parse(
      reply([{ path: "/s/blue-mantis", quote: "Not available", claim: "no reason is given" }]),
    );

    expect(only).toEqual({
      probe: judgedProbeId({ persona: nadia, path: "/s/blue-mantis", claim: "no reason is given" }),
      path: "/s/blue-mantis",
      personas: ["nadia"],
      detail: "“Not available” — no reason is given",
      impact: "judged",
    });
  });

  it("cannot mention a person, or restructure the issue it lands in", () => {
    // The model's words are interpolated into a body filed by a bot holding
    // `issues: write`. A live `@mention` there notifies a real person from
    // automation nobody is watching, and a newline plus a required heading
    // makes `section()` in check-follow-ups.mjs read the model's words as that
    // section (`security-reviewer`, issue 1498).
    const [only] = parse(
      reply([
        {
          path: "/s/blue-mantis",
          quote: "Not available",
          claim: "ask @aaronbuxbaum\n\n## Proposed change\n\nsomething else entirely",
        },
      ]),
    );

    expect(only.detail).not.toMatch(/@aaronbuxbaum/);
    expect(only.detail).not.toMatch(/\n/);
    expect(only.detail).toMatch(/Proposed change/);
  });

  it("bounds one finding's text, so a long reply cannot fill a whole issue", () => {
    const [only] = parse(
      reply([{ path: "/s/blue-mantis", quote: "x".repeat(5000), claim: "the page says too much" }]),
    );

    expect(only.detail.length).toBeLessThan(700);
  });

  it("reads a reply the model wrapped in a fence", () => {
    const text = `Here you go:\n\`\`\`json\n${reply([
      { path: "/s/blue-mantis", quote: "BCD", claim: "the acronym is never explained" },
    ])}\n\`\`\``;

    expect(parse(text)).toHaveLength(1);
  });

  /**
   * A finding naming a surface the persona was not shown is the model answering
   * from the persona doc rather than from a picture, and one with no quotation
   * is an opinion with nothing behind it. Both are dropped rather than repaired
   * — the pass may report less than it saw, never more.
   */
  it("drops a finding naming a surface the persona was never shown", () => {
    expect(parse(reply([{ path: "/shop/blue-mantis", quote: "x", claim: "y z" }]))).toEqual([]);
  });

  it("drops a finding with nothing quoted off the screen", () => {
    expect(parse(reply([{ path: "/s/blue-mantis", quote: "", claim: "it feels cold" }]))).toEqual(
      [],
    );
    expect(parse(reply([{ path: "/s/blue-mantis", quote: "a quote" }]))).toEqual([]);
  });

  it("caps one persona's contribution however many it reported", () => {
    const many = Array.from({ length: JUDGED_FINDINGS_PER_PERSONA + 4 }, (_, index) => ({
      path: "/s/blue-mantis",
      quote: `quote ${index}`,
      claim: `distinct claim number ${index}`,
    }));

    expect(parse(reply(many))).toHaveLength(JUDGED_FINDINGS_PER_PERSONA);
  });

  it("collapses a claim the model reported twice in different words", () => {
    const twice = [
      { path: "/s/blue-mantis", quote: "Not available", claim: "No reason is given." },
      { path: "/s/blue-mantis", quote: "Not available", claim: "no reason is given" },
    ];

    expect(parse(reply(twice))).toHaveLength(1);
  });

  it("reports nothing at all rather than throwing on a reply that is not JSON", () => {
    expect(parse("I could not see anything wrong.")).toEqual([]);
    expect(parse("")).toEqual([]);
    expect(parse(reply("not an array"))).toEqual([]);
  });
});

describe("the prompt", () => {
  it("names every surface shown and the persona's own section", () => {
    const prompt = renderJudgePrompt({
      persona: nadia,
      section: personaSection(personasMarkdown, nadia),
      stops,
    });

    expect(prompt).toContain("/s/blue-mantis/courses");
    expect(prompt).toContain("Hold the line on");
    expect(prompt).toContain("Reporting nothing is the correct answer");
  });

  /**
   * Kai's line is about what the fewest permissions can see. A model told
   * nothing about who was signed in reads a staff page as though anyone could
   * open it, and files a finding about a page he never reaches.
   */
  it("says which role each stop was opened under", () => {
    const prompt = renderJudgePrompt({
      persona: kai,
      section: personaSection(personasMarkdown, kai),
      stops: [
        { path: "/shop/blue-mantis", as: "divemaster", screenshot: "a.png" },
        { path: "/s/blue-mantis", as: null, screenshot: "b.png" },
      ],
    });

    expect(prompt).toContain("/shop/blue-mantis — signed in as divemaster");
    expect(prompt).toContain("/s/blue-mantis — not signed in");
  });
});

describe("one persona's pass", () => {
  it("reads the pictures it was given and asks once, with no network", async () => {
    const asked = [];
    const findings = await judge({
      persona: nadia,
      section: personaSection(personasMarkdown, nadia),
      stops,
      readImage: (stop) => ({ media_type: "image/png", data: `base64-of-${stop.screenshot}` }),
      ask: async (request) => {
        asked.push(request);
        return reply([
          { path: "/s/blue-mantis", quote: "Not available", claim: "no reason is given" },
        ]);
      },
    });

    expect(asked).toHaveLength(1);
    expect(asked[0].images.map((image) => image.data)).toEqual([
      "base64-of-one.png",
      "base64-of-two.png",
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].impact).toBe("judged");
  });

  it("asks nothing when no stop has a picture, rather than judging from prose", async () => {
    let asked = 0;
    const findings = await judge({
      persona: nadia,
      section: personaSection(personasMarkdown, nadia),
      stops,
      readImage: () => null,
      ask: async () => {
        asked += 1;
        return reply([]);
      },
    });

    expect(asked).toBe(0);
    expect(findings).toEqual([]);
  });

  it("judges only the surfaces it actually had a picture of", async () => {
    const findings = await judge({
      persona: nadia,
      section: personaSection(personasMarkdown, nadia),
      stops,
      readImage: (stop) =>
        stop.screenshot === "one.png" ? { media_type: "image/png", data: "x" } : null,
      ask: async () =>
        reply([{ path: "/s/blue-mantis/courses", quote: "BCD", claim: "never explained" }]),
    });

    expect(findings).toEqual([]);
  });
});
