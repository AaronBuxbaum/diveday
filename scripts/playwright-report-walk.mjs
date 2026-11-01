/**
 * The Playwright JSON report's specs in report order, with both file scopes and
 * the suite-title path kept separate for consumers that interpret them differently.
 */
export function* playwrightReportSpecs(suites) {
  for (const root of suites) {
    yield* walk(root, root, []);
  }
}

function* walk(suite, root, suiteTitles) {
  for (const spec of suite.specs ?? []) {
    yield {
      rootFile: root.file,
      rootTitle: root.title,
      suiteFile: suite.file,
      suiteTitles,
      spec,
    };
  }
  for (const child of suite.suites ?? []) {
    yield* walk(child, root, [...suiteTitles, child.title]);
  }
}
