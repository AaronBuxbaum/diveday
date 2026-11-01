import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";
import { filesUnder } from "./files-under.mjs";

/**
 * A function that can receive a database **transaction** may not fan its
 * queries out with `Promise.all`.
 *
 * A drizzle transaction is one checked-out `pg` client. Handing it concurrent
 * queries buys nothing — `pg` queues them behind each other — and it warns that
 * it will stop accepting them:
 *
 *   DeprecationWarning: Calling client.query() when the client is already
 *   executing a query is deprecated and will be removed in pg@9.
 *
 * This has reached production twice. Issue #517 found it in
 * `src/db/trips-schedule.ts`; it came back on 2026-08-14 in the counter
 * check-in, where `checkInBooking` → `getBookingReadiness(tx)` →
 * `listTripReadiness(tx)` ran a six-query `Promise.all` that had been written
 * for the pool. Both times the only symptom was a warning in a log nobody
 * reads — until pg@9, when it becomes an error on a booking or a check-in.
 *
 * ## Why the rule is this narrow
 *
 * "No `Promise.all` in `src/db`" would be wrong. A function that only ever
 * receives `AppDb` runs on the **pool**, where two queries really do run at
 * once on two connections, and serializing the hot roster/manifest/Today reads
 * would be a real regression. The hazard is only a function that *can* receive
 * a transaction, which in this codebase means a parameter typed `DbExecutor`
 * (the union) or `AppTransaction`.
 *
 * The fix is never "make it sequential" either. `queryAll` (`src/db/query-helpers.ts`)
 * asks the executor which one it is and fans out only when that is real, so a
 * reader shared between a page render and a transaction does not have to
 * choose. That is what this check points at.
 *
 * ## Reading the file
 *
 * Token-accurate rather than line-based: this walks TypeScript's own scanner,
 * so a `Promise.all` inside a string, a comment or a template literal is not a
 * match, and a function body is the real span between its braces rather than
 * whatever a regex guessed. A nested closure inside a transaction-taking
 * function inherits the rule, because closing over `tx` is exactly the shape
 * that reintroduced this.
 *
 * ## If a TypeScript upgrade just broke this
 *
 * The scanner comes from `typescript/unstable/ast`, and the package means the
 * word: TypeScript 7 is free to move that entry point in a major, so a bump can
 * take `pnpm check:repo` with it. That was weighed and accepted on 2026-08-15 —
 * see the amendment on `docs/architecture/decisions/20260718-typescript7-next-preview.md`
 * — because the failure is loud. The check throws, or the twelve cases in
 * `check-db-concurrency.test.mjs` go red; what it can never do is quietly stop
 * catching the fan-out it exists to catch. So this is the expected failure and
 * the decision is already made: the risk was accepted, not designed around.
 *
 * Two names have already moved from what an older TypeScript offered, and both
 * are load-bearing below. The end-of-file token is `SyntaxKind.EndOfFile`, not
 * the classic `EndOfFileToken` — reading the old name yields `undefined`, and a
 * `while (token !== undefined)` loop then spins forever rather than failing, so
 * the symptom is a hang rather than an error. And the scanner emits trivia
 * tokens rather than skipping them. The classic `ts.createSourceFile` /
 * `ts.forEachChild` AST API is gone from the package's exports altogether.
 *
 * The supported replacement, and the migration target when this does break, is
 * `typescript/unstable/sync`'s `Program`/`Project`. Measure before porting: it
 * wants a real project setup rather than the one string of source this file's
 * tests hand it, and it builds a program per run while this check reads every
 * file under `src/db` and `src/features`. If a program build over those two
 * directories comes in under a second, take it and this stops being a question.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** The two ways a signature says "this may be a transaction". */
const TRANSACTION_TYPES = new Set(["DbExecutor", "AppTransaction"]);
/** The two ways to fan out. `Promise.race`/`any` are not this hazard: they still queue, but nothing here uses them and a rule nobody can violate is noise. */
const FAN_OUT_MEMBERS = new Set(["all", "allSettled"]);

/**
 * For a `Promise.all` that is genuinely not over queries on that executor.
 * Nothing in the tree needs it today — `src/db/import.ts`'s bounded fetch pool
 * looked like the case for it, but `mapWithConcurrency` is generic and takes no
 * executor at all, so the rule never reaches it. Kept because the shape is real
 * (a fan-out over HTTP, or over an executor the function was handed twice), and
 * a check with no way out gets deleted the first time it is wrong.
 */
const ESCAPE_HATCH = /diveday:allow-db-concurrency:\s*\S/;

/** `src/db/query-helpers.ts` is where `queryAll` decides this, so it is where the fan-out lives. */
const ALLOWED_FILES = new Set([path.normalize("src/db/query-helpers.ts")]);

async function walk(relativeDirectory) {
  return filesUnder(
    relativeDirectory,
    (directory) => readdir(path.join(ROOT, directory), { withFileTypes: true }),
    (_relativePath, entry) => SOURCE_EXTENSIONS.has(path.extname(entry.name)),
  );
}

/**
 * Every `Promise.all`/`allSettled` reachable from a parameter that can be a
 * transaction, as `{ line, text }`.
 *
 * The state is three things: which open paren groups have seen one of the
 * transaction types (a signature's parameter list), whether the next `{` is
 * therefore a transaction-taking body, and a stack of brace frames that
 * inherit that flag downward into nested closures.
 */
export function findTransactionFanOut(contents, { jsx = false } = {}) {
  const scanner = createScanner();
  scanner.setText(contents);
  scanner.setLanguageVariant(jsx ? LanguageVariant.JSX : LanguageVariant.Standard);

  // Trivia is dropped rather than skipped in place: `Promise` and `.all` are
  // routinely separated by a line break once a call is long enough for the
  // formatter to break it, and a state machine that treated whitespace as an
  // intervening token would quietly stop matching the wrapped ones.
  const tokens = [];
  /**
   * Brace depth, and the depths at which an unfinished template substitution is
   * waiting for its `}`.
   *
   * A bare `scan()` loop does **not** get template literals right, and the way
   * it fails is quiet enough to have shipped: after `` `a ${x}` `` the scanner
   * hands back `TemplateHead`, the expression, then a plain `}` — and the
   * closing backtick then opens what it reads as a *new* template, which
   * swallows everything up to the next backtick anywhere in the file. In
   * `src/db/seed-trip-legs.ts` the next backtick was in a comment reading
   * "Sequential, never `Promise.all`", so this guard reported a violation
   * against a comment saying the opposite — with its own docblock promising
   * that a match inside a comment is impossible.
   *
   * The false positive is the visible half. The dangerous half is that every
   * brace after such a template is misattributed, so `inTransaction()` can be
   * wrong in *either* direction and a real fan-out can go unreported.
   *
   * `reScanTemplateToken(false)` is how TypeScript's own parser continues a
   * template: at the `}` that closes a substitution, re-read it as a
   * `TemplateMiddle` (another `${` follows) or a `TemplateTail` (the template
   * ends). Both are dropped from the token list, exactly like the head.
   */
  let braceDepth = 0;
  const templateBraces = [];
  // `SyntaxKind.EndOfFile`, not the classic `EndOfFileToken` — that name reads
  // `undefined` in TypeScript 7, and a loop testing against it never ends.
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.OpenBraceToken) {
      braceDepth += 1;
    } else if (kind === SyntaxKind.CloseBraceToken) {
      if (templateBraces[templateBraces.length - 1] === braceDepth) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templateBraces.pop();
        continue;
      }
      braceDepth -= 1;
    }
    if (kind === SyntaxKind.TemplateHead) {
      templateBraces.push(braceDepth);
      continue;
    }
    if (kind >= SyntaxKind.FirstTriviaToken && kind <= SyntaxKind.LastTriviaToken) continue;
    tokens.push({ kind, text: scanner.getTokenText(), start: scanner.getTokenStart() });
  }

  const lines = contents.split("\n");
  const lineStarts = [0];
  for (const line of lines) lineStarts.push(lineStarts[lineStarts.length - 1] + line.length + 1);
  const lineOf = (position) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };

  /** One entry per open `(`; true once its group has named a transaction type. */
  const parenGroups = [];
  /** Set when a transaction-taking parameter list just closed, so the body brace can claim it. */
  let armed = false;
  /**
   * Depth of `<…>` seen since the parameter list closed — i.e. inside the
   * return-type annotation.
   *
   * Without this, a `{` in the return type disarms the function before its
   * body ever opens, so the whole body is exempt. `createDemoShop(db:
   * DbExecutor): Promise<{ slug: string; ownerEmail: string }>` in
   * `src/db/seed.ts` was exempt exactly this way, and it is the common shape:
   * every async reader in `src/db` that returns an object is
   * `Promise<{ … }>`. The sibling with a `Promise<void>` return was caught,
   * which is what made the hole look like correct behaviour.
   *
   * A bare type-literal return (`): { a: string } {`) is still missed — telling
   * that `{` from a body `{` needs a real parser rather than a token stream.
   * Every function in the guarded roots returning an object is async and so
   * wraps it in `Promise<…>`, so the residue is narrow; it is written down in
   * the guard's tests rather than left as a surprise.
   */
  let returnTypeAngles = 0;
  /** Brace frames, outermost first. The file itself is not a transaction. */
  const frames = [false];
  const inTransaction = () => frames[frames.length - 1];

  const findings = [];
  for (const [index, token] of tokens.entries()) {
    switch (token.kind) {
      case SyntaxKind.OpenParenToken:
        parenGroups.push(false);
        break;
      case SyntaxKind.CloseParenToken:
        if (parenGroups.pop()) {
          armed = true;
          returnTypeAngles = 0;
        }
        break;
      case SyntaxKind.LessThanToken:
        if (armed) returnTypeAngles += 1;
        break;
      case SyntaxKind.GreaterThanToken:
        if (armed && returnTypeAngles > 0) returnTypeAngles -= 1;
        break;
      case SyntaxKind.OpenBraceToken:
        // A `{` inside the return type's `<…>` is a type literal, not the body:
        // it must not spend `armed`, or the function it belongs to goes unchecked.
        if (armed && returnTypeAngles > 0) {
          frames.push(inTransaction());
          break;
        }
        frames.push(armed || inTransaction());
        armed = false;
        break;
      case SyntaxKind.CloseBraceToken:
        if (frames.length > 1) frames.pop();
        // A `}` also ends a type alias or an interface body, the other way a
        // transaction type reaches a parameter list with no function under it.
        // Not while still inside the return type's angle brackets, though —
        // there the `}` is closing a type literal the body has not opened yet.
        if (!(armed && returnTypeAngles > 0)) armed = false;
        break;
      case SyntaxKind.SemicolonToken:
        // An overload signature or an interface method: annotated, bodyless.
        // Except inside the return type's `<…>`, where a `;` separates the
        // members of a type literal — `Promise<{ slug: string; count: number }>`
        // would otherwise disarm on its first member boundary, which is the
        // same hole the type literal's braces opened.
        if (!(armed && returnTypeAngles > 0)) armed = false;
        break;
      default:
        break;
    }

    if (token.kind !== SyntaxKind.Identifier) continue;
    if (parenGroups.length > 0 && TRANSACTION_TYPES.has(token.text)) {
      parenGroups[parenGroups.length - 1] = true;
    }
    if (token.text !== "Promise" || !inTransaction()) continue;
    if (tokens[index + 1]?.kind !== SyntaxKind.DotToken) continue;
    if (!FAN_OUT_MEMBERS.has(tokens[index + 2]?.text ?? "")) continue;
    const line = lineOf(token.start);
    const text = (lines[line - 1] ?? "").trim();
    if (ESCAPE_HATCH.test(text)) continue;
    findings.push({ line, text });
  }

  return findings;
}

/**
 * **The `shops` and `people` rows are locked `for no key update`, not `for update`.**
 *
 * Nearly every table names a shop (126 foreign keys) and many name a person, and
 * every insert into one of them takes `FOR KEY SHARE` on the parent row until
 * commit. `FOR UPDATE` conflicts with that; `FOR NO KEY UPDATE` does not, while
 * still conflicting with itself. So a `for update` on a shop queues every
 * booking, roll-call tap and activity line in that shop behind it, and a
 * transaction that inserted a child and then upgrades deadlocks on one row
 * (`self-declared-cards.ts` tells it; `bookings.ts` writes the same rule for
 * trips). Five shop locks and two card-write person locks took `update` until
 * 2026-10-13 (fourth review, row 16).
 *
 * A statement that really must exclude key-share holders, because it deletes the
 * row or changes its key, says `diveday:allow-update-lock: <why>` inside it.
 * Returns `{ line, text }` for the `.for("update")` of each unexplained one.
 */
const PARENT_FROM = /\.from\((shops|people)\)/g;
const UPDATE_LOCK = /\.for\(\s*"update"/;
const UPDATE_LOCK_REASON = /diveday:allow-update-lock:[ \t]*\S/;

export function findParentUpdateLocks(contents) {
  const lineOf = (position) => contents.slice(0, position).split("\n").length;
  const lines = contents.split("\n");
  const findings = [];
  for (const match of contents.matchAll(PARENT_FROM)) {
    const end = contents.indexOf(";", match.index);
    const statement = contents.slice(match.index, end === -1 ? undefined : end);
    const lock = UPDATE_LOCK.exec(statement);
    if (!lock) continue;
    // The reason may sit anywhere in the statement, including the lines of the
    // chain above `.from(...)`, so read back to the previous statement's end.
    const start = contents.lastIndexOf(";", match.index) + 1;
    if (UPDATE_LOCK_REASON.test(contents.slice(start, match.index + statement.length))) continue;
    const line = lineOf(match.index + lock.index);
    findings.push({ line, text: (lines[line - 1] ?? "").trim() });
  }
  return findings;
}

/**
 * **A real-Postgres suite lives in a `*.postgres.test.ts` file, or it runs nowhere.**
 *
 * `describePostgres` (`src/test/postgres.ts`) skips unless
 * `DIVEDAY_TEST_POSTGRES_URL` names a server, and only CI's `real-postgres` job
 * sets it for database and feature-module `*.postgres.test.ts` files (`ci.yml`). A
 * `describePostgres` block in any other file therefore skips in the unit shards
 * and is never selected by the job: the race tests of `lockSeatDeparture` sat in
 * `seat-locks.test.ts` that way, green and inert, until 2026-10-13. The job's
 * own comment records the first such case (a hand-kept list of file names).
 *
 * Returns `{ line, text }` for each use of either name outside that glob.
 * `src/test/postgres.ts` defines them and is the one other file allowed to.
 */
export const REAL_SERVER_SUITE = /^src\/(?:db|features\/[^/]+)\/[^/]+\.postgres\.test\.ts$/;
const REAL_SERVER_NAMES = /\b(describePostgres|postgresTestDb)\b/;
const REAL_SERVER_HOME = "src/test/postgres.ts";
// The real action race is listed explicitly in the real-postgres CI job.
const REAL_SERVER_ACTION =
  "src/app/shop/[shopSlug]/divers/[personId]/erasure-race.postgres.test.ts";

export function findMisplacedRealServerSuites(file, contents) {
  const normalized = file.split(path.sep).join("/");
  if (
    normalized === REAL_SERVER_HOME ||
    normalized === REAL_SERVER_ACTION ||
    REAL_SERVER_SUITE.test(normalized)
  )
    return [];
  const findings = [];
  for (const [index, raw] of contents.split("\n").entries()) {
    const text = raw.trim();
    if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) continue;
    if (REAL_SERVER_NAMES.test(text)) findings.push({ line: index + 1, text });
  }
  return findings;
}

async function main() {
  const violations = [];
  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      if (ALLOWED_FILES.has(path.normalize(file))) continue;
      const contents = await readFile(path.join(ROOT, file), "utf8");
      if (!contents.includes("Promise.all")) continue;
      const jsx = path.extname(file) === ".tsx";
      for (const finding of findTransactionFanOut(contents, { jsx })) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  const parentLocks = [];
  for (const root of [...GUARDED_ROOTS, "src/lib"]) {
    for (const file of await walk(root)) {
      if (file.endsWith(".test.ts")) continue;
      const contents = await readFile(path.join(ROOT, file), "utf8");
      if (!UPDATE_LOCK.test(contents)) continue;
      for (const finding of findParentUpdateLocks(contents)) {
        parentLocks.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }
  if (parentLocks.length > 0) {
    console.error(
      `A shops or people row locked for update:\n${parentLocks.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      'Every insert naming that row holds FOR KEY SHARE on it, which FOR UPDATE waits on and can deadlock with. Take .for("no key update"): it still serializes with itself. If the statement deletes the row or changes its key, say so inside it: `diveday:allow-update-lock: <why>`.',
    );
  }

  const misplaced = [];
  for (const file of await walk("src")) {
    const contents = await readFile(path.join(ROOT, file), "utf8");
    if (!REAL_SERVER_NAMES.test(contents)) continue;
    for (const finding of findMisplacedRealServerSuites(file, contents)) {
      misplaced.push(`${file}:${finding.line}: ${finding.text}`);
    }
  }
  if (misplaced.length > 0) {
    console.error(
      `A real-Postgres suite outside the database or feature-module PostgreSQL globs:\n${misplaced.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      "describePostgres skips without DIVEDAY_TEST_POSTGRES_URL, and CI's real-postgres job runs db and feature suites plus its explicitly listed action race, so this suite runs nowhere. Move it into a <module>.postgres.test.ts file beside the module.",
    );
  }

  if (violations.length > 0) {
    console.error(
      `Concurrent queries on a database transaction:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      "A transaction is one checked-out pg client, so this fan-out is not parallel — pg queues it and warns that pg@9 will refuse it (issue #517, then the 2026-08-14 counter check-in).",
    );
    console.error(
      "Use `queryAll(db, [...])` from src/db/query-helpers.ts, which fans out on the pool and runs sequentially in a transaction — do not serialize a hot roster read by hand.",
    );
    console.error(
      "If the Promise.all is genuinely not over queries on that executor, say so on the line: `diveday:allow-db-concurrency: <why>`.",
    );
  }
  if (violations.length > 0 || misplaced.length > 0 || parentLocks.length > 0) process.exit(1);

  console.log(
    "db-concurrency: no Promise.all over queries on a transaction executor; no shops or people row locked for update unexplained; every real-Postgres suite is a *.postgres.test.ts",
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
