// Mutation testing (ADR 20261015-coverage-and-mutation-testing; test review 2026-10-14,
// decision 7). Stryker changes one operator, condition or literal at a time in the module under
// test and runs the tests that cover it; a mutant no test notices "survived", and names an
// assertion the suite is missing.
//
// One module a run, named on the command line: `pnpm test:mutation --mutate src/lib/readiness.ts`.
// Weekly in .github/workflows/mutation.yml, which files the survivors as one issue per module
// (scripts/mutation-issues.mjs). Never on a pull request: a module is minutes of reruns.
//
// **Not trustworthy yet under Vitest 5.** The trial run on src/lib/trip-admission.ts (2026-10-15)
// scored 7.5%: the 13 killed mutants were all module-level (static, switched on by an environment
// variable), and every mutant inside a function "survived" with its tests green, under both
// 9.6.1 and 10.0.0 and both coverage modes. Forcing one of those survivors on by hand
// (`__STRYKER_ACTIVE_MUTANT__=5` in a kept sandbox) fails 16 tests, so the tests do catch it and
// the runner's runtime switch is what never reaches the module. Until a run kills a known
// in-function mutant, the weekly schedule in mutation.yml stays off.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  // The `lib` project's files only (stryker.vitest.config.ts): pure, so a mutant is judged by
  // the domain tests that pin the module, and no PGlite file runs under the threads pool the
  // runner forces (vitest.config.ts says why this suite left threads).
  vitest: { configFile: "stryker.vitest.config.ts", related: true },
  coverageAnalysis: "perTest",
  // Stryker rewrites the sandbox's tsconfig through the `typescript` package's JS API, which the
  // TypeScript 7 native preview this repo runs (ADR 20260718-typescript7-next-preview) does not
  // have, so it crashes before the dry run. The rewrite only fixes `extends` and `references`
  // that point outside the sandbox, and tsconfig.json has neither; naming a file that does not
  // exist skips it, and the real tsconfig.json is still copied into the sandbox unchanged.
  tsconfigFile: "stryker-skips-tsconfig-rewrite.json",
  mutate: [],
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  clearTextReporter: { allowColor: false, logTests: false, maxTestsToLog: 0 },
  concurrency: 2,
  tempDirName: ".stryker-tmp",
  // The sandbox is a copy of the files the `lib` tests load, not of the repository: the whole
  // tree is 7,000 files, and the symlinked skill folders under `.claude/` stop the copy outright.
  ignorePatterns: [
    "/*",
    "!/src",
    "!/package.json",
    "!/tsconfig.json",
    "!/vitest.config.ts",
    "!/stryker.vitest.config.ts",
    "!/scripts",
  ],
  cleanTempDir: "always",
  // A survivor is a finding to read, not a failed build: the weekly job files it.
  thresholds: { high: 90, low: 75, break: null },
};
