import { COVERAGE_PROMISE, type CoverageDenominator, coverageOf } from "./coverage";
import type { DiveSiteTemplate } from "./dive-sites/types";

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
