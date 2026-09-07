import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LENS_IDS, LENSES, lensesFor, PERSONAS, personaLabel, stopCount } from "./personas.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FRAME = path.join(ROOT, "docs/product/personas.md");

/**
 * The itinerary is derived from a document, and a document drifts. These pin
 * the two together: a persona renamed, renumbered or added in `personas.md`
 * fails here rather than being quietly walked as somebody else, and a route
 * that moves takes the `Touches:` line of every issue this bot would file with
 * it — which is the exact staleness `pnpm check:follow-ups` refuses on the way
 * out.
 */
describe("the roster matches docs/product/personas.md", () => {
  it("walks fifteen personas and no sixteenth", () => {
    expect(PERSONAS).toHaveLength(15);
    expect(PERSONAS.map((persona) => persona.number)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    );
  });

  it("names each of them the way the frame does", async () => {
    const frame = await readFile(FRAME, "utf8");
    for (const persona of PERSONAS) {
      const heading = new RegExp(`^## ${persona.number}\\. ${persona.name} —`, "m");
      expect(frame, personaLabel(persona)).toMatch(heading);
    }
  });

  it("gives every persona somewhere to go", () => {
    for (const persona of PERSONAS) {
      expect(persona.stops.length, persona.id).toBeGreaterThan(0);
      for (const stop of persona.stops) {
        expect(Boolean(stop.path) !== Boolean(stop.flow), `${persona.id}/${stop.id}`).toBe(true);
      }
    }
    expect(stopCount()).toBe(PERSONAS.reduce((total, persona) => total + persona.stops.length, 0));
  });

  it("uses ids that are unique inside a persona, since a fingerprint is built from them", () => {
    expect(new Set(PERSONAS.map((persona) => persona.id)).size).toBe(PERSONAS.length);
    for (const persona of PERSONAS) {
      const ids = persona.stops.map((stop) => stop.id);
      expect(new Set(ids).size, persona.id).toBe(ids.length);
    }
  });
});

describe("the lenses", () => {
  it("are declared by name, so a typo cannot silently read nothing", () => {
    for (const persona of PERSONAS) {
      for (const lens of persona.lenses ?? []) {
        expect(LENS_IDS, `${persona.id} reads ${lens}`).toContain(lens);
      }
    }
  });

  it("every persona reads the four that need no declaring", () => {
    for (const persona of PERSONAS) {
      expect(lensesFor(persona)).toEqual(
        expect.arrayContaining([
          "stop-unreachable",
          "blank-render",
          "request-failed",
          "console-error",
        ]),
      );
    }
  });

  it("orders every lens distinctly, so a capped run has a total order to file by", () => {
    const severities = Object.values(LENSES).map((lens) => lens.severity);
    expect(new Set(severities).size).toBe(severities.length);
  });

  it("reads the tap-target floor only where a persona is on a phone", () => {
    for (const persona of PERSONAS) {
      if ((persona.lenses ?? []).includes("tap-target")) continue;
      expect(persona.viewport === "phone" && persona.actor !== "public").toBe(false);
    }
  });
});

describe("the paths a filed issue would name", () => {
  it("all exist in this repository today", async () => {
    for (const persona of PERSONAS) {
      for (const stop of persona.stops) {
        expect((stop.touches ?? []).length, `${persona.id}/${stop.id}`).toBeGreaterThan(0);
        for (const target of stop.touches) {
          await access(path.join(ROOT, target));
        }
      }
    }
  });
});
