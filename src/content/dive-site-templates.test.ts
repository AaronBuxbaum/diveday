import { describe, expect, it } from "vitest";
import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import { DIVE_AREA_BY_CODE } from "./dive-areas";
import { DIVE_SITE_TEMPLATES } from "./dive-site-templates";

/**
 * The catalog's facts, checked as facts. Every template is real starting
 * content a shop may publish under its own name, so a number that contradicts
 * itself, an uncited site or a field-guide slug the import would silently drop
 * is caught here rather than on a diver's briefing.
 */
describe("the dive-site catalog", () => {
  it("gives every template a unique slug in a known area", () => {
    const slugs = DIVE_SITE_TEMPLATES.map((template) => template.slug);
    expect(slugs.filter((slug, index) => slugs.indexOf(slug) !== index)).toEqual([]);
    expect(
      DIVE_SITE_TEMPLATES.filter((template) => !DIVE_AREA_BY_CODE.has(template.area)).map(
        (template) => template.slug,
      ),
    ).toEqual([]);
  });

  it("cites at least two independent public sources for every template", () => {
    const thin = DIVE_SITE_TEMPLATES.filter((template) => {
      const hosts = new Set(
        template.sources.map((source) => {
          const url = new URL(source);
          if (url.protocol !== "https:") return "insecure";
          return url.hostname.replace(/^www\./, "");
        }),
      );
      return hosts.has("insecure") || hosts.size < 2;
    }).map((template) => template.slug);
    expect(thin).toEqual([]);
  });

  it("says safety stop only at 5 m, never at the top of a wreck", () => {
    // A safety stop is 5 m / 15 ft. The catalog once called the Duane's 18 m
    // crow's nest "where the safety stop happens", which a feet shop's
    // divemaster then read aloud as a stop at 60 ft.
    // A sentence may name the dive's depth limit and end on the safety stop;
    // what must never happen is a depth other than 5 m sitting in the same
    // clause as the stop, or a place "where the safety stop happens".
    const atDepth = (text: string) => /\d\s?m\b/.test(text) && !/\b5 m\b/.test(text);
    const placesStop = (sentence: string) =>
      sentence
        .split(/,|;|\band\b|\bthen\b/)
        .some((clause) => /safety stop/i.test(clause) && atDepth(clause)) ||
      (/where (?:the|you make the|you do the) safety stop/i.test(sentence) && atDepth(sentence));
    expect(placesStop("The crow's nest at 18 m is where the safety stop happens.")).toBe(true);
    expect(placesStop("Up the line to the 18 m crow's nest, where the safety stop happens.")).toBe(
      true,
    );
    expect(placesStop("Do the safety stop at 6 m on the line.")).toBe(true);
    expect(
      placesStop("Along the wall no deeper than 18 m, and back up the line for the safety stop."),
    ).toBe(false);
    const misplaced = DIVE_SITE_TEMPLATES.flatMap(({ slug, briefing }) =>
      [briefing.divePlan, briefing.description, ...(briefing.landmarks ?? []).map((l) => l.note)]
        .flatMap((text) => (text ?? "").split(/(?<=\.)\s/))
        .filter(placesStop)
        .map((sentence) => `${slug}: ${sentence}`),
    );
    expect(misplaced).toEqual([]);
  });

  it("places every site and states a depth that agrees with itself", () => {
    const problems = DIVE_SITE_TEMPLATES.flatMap(({ slug, briefing }) => {
      const found: string[] = [];
      if (briefing.forecastLatitude == null || briefing.forecastLongitude == null) {
        found.push(`${slug}: no position`);
      }
      if (briefing.maxDepthMeters == null) {
        found.push(`${slug}: no depth`);
        return found;
      }
      // The depth is two numbers in metres (issue #2426); a shop reads them in
      // its own unit, so the template carries no prose that could name another.
      if (briefing.depthRange !== undefined) found.push(`${slug}: depth prose, not numbers`);
      const min = briefing.depthMinMeters;
      if (min != null && !(min >= 0 && min < briefing.maxDepthMeters)) {
        found.push(`${slug}: depthMinMeters ${min} vs maxDepthMeters ${briefing.maxDepthMeters}`);
      }
      return found;
    });
    expect(problems).toEqual([]);
  });

  /**
   * The catalog's own convention (`./dive-site-templates.ts`): a site whose
   * `maxDepthMeters` is past 30 m carries Advanced Open Water and the Deep
   * specialty, because that is what its depth demands of a diver in open
   * water. A reef that slopes past 18 m is still run as an Open Water dive
   * that stays shallow, so it is not gated by its depth alone.
   */
  it("gates every site at least as strictly as its depth demands", () => {
    const under = DIVE_SITE_TEMPLATES.flatMap(({ slug, briefing }) => {
      const depth = briefing.maxDepthMeters ?? 0;
      const level = briefing.minimumCertificationLevel;
      const deep = briefing.requiredSpecialties?.includes("deep") ?? false;
      const problems: string[] = [];
      if (depth > 30 && (!level || level === "open_water")) {
        problems.push(`${slug}: ${depth} m needs Advanced Open Water`);
      }
      if (depth > 30 && !deep) problems.push(`${slug}: ${depth} m needs the Deep specialty`);
      return problems;
    });
    expect(under).toEqual([]);
  });

  /**
   * `maxDepthMeters` is the only number readiness's depth advisory and the
   * >30 m gate read, so a briefing whose own words put a mooring barrel, a
   * wreck's sand or a slope's foot deeper than it has silently dropped both
   * (the Caribbean adversarial review, 2026-10-15: a 43 m mooring under a
   * 30 m cap). A depth the prose says lies *past* the plan (a wall that keeps
   * falling, sand beyond the briefed dive) is the walls rule working, not a
   * contradiction, so a sentence that says so is left alone, and so is the sand
   * under a wreck capped at the 40 m recreational limit.
   */
  it("never describes a reachable depth deeper than its maxDepthMeters", () => {
    const beyondThePlan =
      /\b(past|beyond|below|deeper than|outside)\b[^.]*\b(plan|floor|limit|turn|recreational)\b|\b(plan|floor)\b[^.]*\b(past|beyond|above)\b|\bfalls? away\b|\bdrops? (off |away )?(past|beyond)\b|\bnever\b|\bstay (off|above|out)\b|\bno-go\b|\btechnical\b|\bcave (training|certification)\b/i;
    // A named structure with a foot (a pinnacle's base, a wreck's sand, a chute's
    // exit, a mooring) is reachable however the sentence frames it.
    const bounded =
      /\b(base|sand|bottom|foot|exit|exits|mooring|barrel|stern|bow|deck|chute|pinnacle|seamount|ledge|cut|cuts)\b/i;
    const deeper = DIVE_SITE_TEMPLATES.flatMap(({ slug, briefing }) => {
      const max = briefing.maxDepthMeters ?? 0;
      const prose = [
        briefing.description,
        briefing.currentNote,
        briefing.fitNote,
        briefing.divePlan,
        briefing.marineLifeDescription,
        ...(briefing.landmarks ?? []).map((landmark) => landmark.note),
      ];
      return prose.flatMap((text) =>
        (text ?? "")
          .split(/(?<=[.;])\s+/)
          .filter((sentence) => bounded.test(sentence) || !beyondThePlan.test(sentence))
          .flatMap((sentence) =>
            [
              ...sentence.matchAll(
                /(?<!\d\s)\b(?:at|to|in|reaches|down|near|beyond)\s+(?:about\s+|around\s+|roughly\s+|some\s+)?(\d+)(?:(?:–|\s+to\s+)(\d+))? m\b(?!\s*(?:\(\d+(?:–\d+)? ft\)\s*)?(?:long|wide|high|tall|across|of\b))/g,
              ),
            ]
              .map((match) => Number(match[2] ?? match[1]))
              .filter((metres) => metres > max && max < 40)
              .map((metres) => `${slug}: “${sentence}” says ${metres} m, max is ${max}`),
          ),
      );
    });
    expect(deeper).toEqual([]);
  });

  it("names only catalog species in its field guides, which the import would otherwise drop", () => {
    const unknown = DIVE_SITE_TEMPLATES.flatMap(({ slug, briefing }) =>
      (briefing.creatureSlugs ?? [])
        .filter((creature) => !isMarineLifeSlug(creature))
        .map((creature) => `${slug}: ${creature}`),
    );
    expect(unknown).toEqual([]);
  });
});
