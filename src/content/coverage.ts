import type { DiveSiteTemplate } from "./dive-sites/types";

/**
 * **A coverage denominator**: the named sites shops in one dive area actually
 * run, written down from public sources so "the catalog covers 80% of them"
 * is a measurement rather than a feeling.
 *
 * One file per area, `src/content/coverage/<area>.json`, written by the
 * **expand-content** skill and checked by `./coverage.test.ts`. A site is in
 * the denominator when it is named, recreationally divable, and on at least
 * two independent lists (an official marine-park or mooring list counts as
 * one; an operator's published site list as another). `method` says how the
 * list was drawn up, in a sentence a reviewer can repeat.
 *
 * `template` is the catalog slug that defines the site, or null while none
 * does. `excluded` takes a site out of the count with its reason — closed to
 * diving, technical-only, a duplicate name — so dropping one is reviewable
 * rather than silent.
 */
export type CoverageSite = {
  name: string;
  template: string | null;
  /** Latitude, longitude, as the listing source gives it. */
  position?: [number, number];
  /** The lists the site was found on. */
  listedBy?: string[];
  excluded?: string;
};

export type CoverageDenominator = {
  area: string;
  /** How the list was drawn up. */
  method: string;
  /** The lists themselves. */
  sources: string[];
  /** The day it was counted (YYYY-MM-DD). */
  counted: string;
  /**
   * Whether the catalog promises this area: a promised area's coverage may
   * not fall below `COVERAGE_PROMISE`. An area is promised in the change that
   * reaches it, never before.
   */
  promised: boolean;
  sites: CoverageSite[];
};

/** The share of an area's denominator the catalog promises to define. */
export const COVERAGE_PROMISE = 0.8;

export type AreaCoverage = {
  area: string;
  counted: number;
  defined: number;
  share: number;
  missing: string[];
};

export function coverageOf(denominator: CoverageDenominator): AreaCoverage {
  const counted = denominator.sites.filter((site) => !site.excluded);
  const defined = counted.filter((site) => site.template !== null);
  return {
    area: denominator.area,
    counted: counted.length,
    defined: defined.length,
    share: counted.length ? defined.length / counted.length : 0,
    missing: counted.filter((site) => site.template === null).map((site) => site.name),
  };
}

/** Every way a denominator and the catalog disagree, as sentences. */
export function coverageProblems(
  denominator: CoverageDenominator,
  templates: readonly DiveSiteTemplate[],
): string[] {
  const bySlug = new Map(templates.map((template) => [template.slug, template]));
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const site of denominator.sites) {
    if (!site.template) continue;
    const template = bySlug.get(site.template);
    if (!template) problems.push(`${site.name}: no template ${site.template}`);
    else if (template.area !== denominator.area) {
      problems.push(
        `${site.name}: ${site.template} is in ${template.area}, not ${denominator.area}`,
      );
    }
    const twice = seen.get(site.template);
    if (twice) problems.push(`${site.template} stands for both ${twice} and ${site.name}`);
    seen.set(site.template, site.name);
  }
  const coverage = coverageOf(denominator);
  if (denominator.promised && coverage.share < COVERAGE_PROMISE) {
    problems.push(
      `${denominator.area}: ${coverage.defined} of ${coverage.counted} defined (${Math.round(coverage.share * 100)}%), below the ${COVERAGE_PROMISE * 100}% promise`,
    );
  }
  return problems;
}
