// The areas where a mistake hurts, in the words Aaron reads them in, and which file belongs to which.
//
// Aaron does not read agent-written code, so every guardrail that reports on a change (the risk
// card, the referee guard) sorts the changed files into the same few areas and names them the same
// way. The dive-safety and privacy areas are the reviewer patterns `scripts/check-pr-body.mjs`
// already holds a pull request to, imported rather than copied, so a file that needs the
// `dive-domain-expert` is a dive-safety file here too. Money, offline, database, outside code and
// deploy are named here because no reviewer owns them.
//
// The breakage drills decide which files are money and safety logic (`scripts/mutation/scope.mjs`);
// a file the drills break on purpose is always in the matching area here, so the card never calls a
// drilled change "fine" without naming the area. A file may belong to several areas (a refund
// webhook is money and privacy); `areasOf` returns all.

import { REVIEWS, reviewPath } from "./check-pr-body.mjs";
import { classifyScope } from "./mutation/scope.mjs";

const DOMAIN_EXPERT = REVIEWS.find((review) => review.agent === "dive-domain-expert");
const SECURITY = REVIEWS.find((review) => review.agent === "security-reviewer");

/** A test or spec file, anywhere. */
export const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Not product behavior: tests, type declarations, fixtures, seed scenarios and copy resolvers. */
const NOT_LOGIC = [
  TEST_FILE,
  /\.d\.ts$/,
  /(^|\/)test-fixtures?\//,
  /-fixtures\.tsx?$/,
  /^src\/test\//,
  /^src\/db\/seed\//,
  /\.test-support\.tsx?$/,
];

/** True for a file whose change can change what the product does, as opposed to how it is tested. */
export function isLogicFile(file) {
  return /^src\/.+\.tsx?$/.test(file) && !NOT_LOGIC.some((re) => re.test(file));
}

/** True for a test file. */
export function isTestFile(file) {
  return TEST_FILE.test(file);
}

/** The files that decide whether a change is fine, with the plain words for each kind. */
const RULE_FILES = [
  ["check", "a repository check", /^scripts\/check-[^/]+\.mjs$/],
  [
    "registry",
    "the list of repository checks",
    /^scripts\/(?:rules-registry|ratchet|coverage-floors|coverage-safety-files|coverage-relevant)\.mjs$/,
  ],
  [
    "floors",
    "a coverage floor or allowance",
    /^scripts\/(?:coverage-floors|ratchets|cross-shop-coverage|mutation\/floors)\.json$/,
  ],
  ["mutation", "the breakage drills", /^scripts\/mutation\/[^/]+\.(?:mjs|json)$/],
  [
    "verdict",
    "what makes CI fail or the risk card speak",
    /^scripts\/(?:ci-merge-verdict|risk-card|guardrail-areas)\.mjs$/,
  ],
  ["lint", "a lint rule", /^(?:biome\.json|scripts\/lint-rules\/.*)$/],
  ["types", "the type checker's settings", /^tsconfig\.json$/],
  [
    "test-config",
    "a test or build setting",
    /^(?:vitest[\w.-]*\.config\.ts|playwright[\w.-]*\.config\.ts|regconfig[\w.]*\.json)$/,
  ],
  ["ci", "the CI workflow", /^\.github\/(?:workflows|actions)\//],
  [
    "harness",
    "the shared test harness",
    /^(?:src\/test\/(?:setup|projects|frozen-clock|fakes|global-setup|shard-sequencer)[^/]*\.ts|e2e\/(?:fixtures|helpers)\.ts)$/,
  ],
  [
    "agent-rules",
    "the rules agents follow",
    /^(?:AGENTS\.md|CLAUDE\.md|\.claude\/(?:rules|agents)\/.*)$/,
  ],
];

/** `{ kind, words }` for a rule file, or null. A test file is never a rule file (tests are read separately). */
export function ruleFileKind(file) {
  if (isTestFile(file)) return null;
  for (const [kind, words, re] of RULE_FILES) if (re.test(file)) return { kind, words };
  return null;
}

const MONEY = [
  /^src\/lib\/(?:payments|billing)\//,
  /^src\/lib\/(?:money|collection-money)\.tsx?$/,
  /^src\/features\/money\//,
  /^src\/db\/(?:checkouts?|checkout-purpose|refunds?|promo-caps|shop-promos|payments?|payment-operations|orders?|seat-payments|stripe-[^/]*|trip-credit[^/]*|counter-payment-hold)\b/,
  /^src\/db\/schema\/(?:payments|billing|trip-credit)\.ts$/,
  /^src\/app\/api\/(?:webhooks\/(?:stripe|billing)|stripe)\//,
  /^src\/(?:lib|db|features)\/.*(?:refund|invoice|payout|pricing|discount|trip-credit)/,
];

const OFFLINE = [
  /offline-?manifest/,
  /offline-roll-call/,
  /roll-call-offline/,
  /background-flush/,
  /service-?worker/,
  /^src\/worker\//,
  /^src\/app\/api\/offline-manifests\//,
];

const DATABASE = [/^src\/db\/schema\//, /^drizzle\//];

const OUTSIDE_CODE = [/^package\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/];

const DEPLOY = [
  /^\.github\/(?:workflows|actions)\//,
  /^infra\//,
  /^vercel\.json$/,
  /^cdk\.json$/,
  /^next\.config\.ts$/,
  /^src\/proxy\.ts$/,
];

const SCREENS = [
  /^src\/app\/.*\.tsx$/,
  /^src\/components\//,
  /^src\/app\/globals\.css$/,
  /^src\/i18n\/locales\//,
];

/**
 * Every area, in the order a card lists them. `sentence` finishes "<n> file(s) changed in …".
 * `weighty` areas are the ones where a mistake hurts a person or money, so a card asks what
 * protects them; the rest are listed for completeness.
 */
export const AREAS = [
  {
    id: "money",
    label: "Money",
    sentence: "prices, payments, refunds, credits and fees",
    weighty: true,
    match: (file, lower) =>
      MONEY.some((re) => re.test(file) || re.test(lower)) || classifyScope(file) === "money",
  },
  {
    id: "safety",
    label: "Dive safety",
    sentence:
      "who may board, roll call, medical answers, certifications, waivers, nitrox and erasure",
    weighty: true,
    match: (file, lower) =>
      (/^src\//.test(file) && DOMAIN_EXPERT.patterns.some((re) => re.test(lower))) ||
      classifyScope(file) === "safety",
  },
  {
    id: "privacy",
    label: "Privacy and sign-in",
    sentence: "sign-in, links and tokens, personal and medical data, exports",
    weighty: true,
    match: (file, lower) => /^src\//.test(file) && SECURITY.patterns.some((re) => re.test(lower)),
  },
  {
    id: "offline",
    label: "Offline roll call",
    sentence: "the saved copy of the manifest and syncing it back",
    weighty: true,
    match: (file) => OFFLINE.some((re) => re.test(file)),
  },
  {
    id: "database",
    label: "Database",
    sentence: "tables, columns and migrations",
    weighty: true,
    match: (file) => DATABASE.some((re) => re.test(file)),
  },
  {
    id: "outside-code",
    label: "Outside code",
    sentence: "libraries the product is built on",
    weighty: false,
    match: (file) => OUTSIDE_CODE.some((re) => re.test(file)),
  },
  {
    id: "deploy",
    label: "Building and shipping",
    sentence: "CI, hosting and the sign-in gate",
    weighty: false,
    match: (file) => DEPLOY.some((re) => re.test(file)),
  },
  {
    id: "rules",
    label: "The rules that judge changes",
    sentence: "tests, checks, floors, CI settings and the rules agents follow",
    weighty: false,
    match: (file) => ruleFileKind(file) !== null,
  },
  {
    id: "screens",
    label: "What people see",
    sentence: "pages, components, words and styles",
    weighty: false,
    match: (file) => SCREENS.some((re) => re.test(file)),
  },
];

/** The ids of every area a changed file belongs to. Tests and docs belong to the area they test. */
export function areasOf(file) {
  const lower = reviewPath(file);
  return AREAS.filter((area) => area.match(file, lower)).map((area) => area.id);
}

/** `true` when the area is one where a mistake hurts a person or money. */
export function isWeighty(id) {
  return AREAS.find((area) => area.id === id)?.weighty === true;
}
