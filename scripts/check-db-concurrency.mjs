import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";

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
 * The fix is never "make it sequential" either. `queryAll` (`src/db/client.ts`)
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

/** `src/db/client.ts` is where `queryAll` decides this, so it is where the fan-out lives. */
const ALLOWED_FILES = new Set([path.normalize("src/db/client.ts")]);

async function walk(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
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
  // `SyntaxKind.EndOfFile`, not the classic `EndOfFileToken` — that name reads
  // `undefined` in TypeScript 7, and a loop testing against it never ends.
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
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
        if (parenGroups.pop()) armed = true;
        break;
      case SyntaxKind.OpenBraceToken:
        frames.push(armed || inTransaction());
        armed = false;
        break;
      case SyntaxKind.CloseBraceToken:
        if (frames.length > 1) frames.pop();
        // A `}` also ends a type alias or an interface body, the other way a
        // transaction type reaches a parameter list with no function under it.
        armed = false;
        break;
      case SyntaxKind.SemicolonToken:
        // An overload signature or an interface method: annotated, bodyless.
        armed = false;
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

  if (violations.length > 0) {
    console.error(
      `Concurrent queries on a database transaction:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      "A transaction is one checked-out pg client, so this fan-out is not parallel — pg queues it and warns that pg@9 will refuse it (issue #517, then the 2026-08-14 counter check-in).",
    );
    console.error(
      "Use `queryAll(db, [...])` from src/db/client.ts, which fans out on the pool and runs sequentially in a transaction — do not serialize a hot roster read by hand.",
    );
    console.error(
      "If the Promise.all is genuinely not over queries on that executor, say so on the line: `diveday:allow-db-concurrency: <why>`.",
    );
    process.exit(1);
  }

  console.log("db-concurrency: no Promise.all over queries on a transaction executor");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
