import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The booking transaction does not learn about interests** (ADR
 * 20261017-one-interest-with-a-scope, R1; dive-domain review of #2656, M2). An interest
 * reserves nothing, so the code that sells, moves and gates a seat must not
 * import an interest module or name the `interests` table: if it ever does, a wait list
 * or an offer could start deciding who boards.
 *
 * The modules are the booking door and the two gates it reads: the
 * transaction itself, the one seating path, the trip lock, the seat counts,
 * and admission and readiness. What each imports directly is read from source,
 * so a type-only import counts too. The wider graph does reach an interest module
 * (through `trip-rescheduled.ts`, its notices and the trips barrel), never on
 * the seat's path; that edge is not what this pins.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");

const BOOKING_PATH = [
  "src/db/bookings.ts",
  "src/db/seat-diver.ts",
  "src/db/seat-locks.ts",
  "src/db/trips-queries.ts",
  "src/db/readiness.ts",
  "src/lib/trip-admission.ts",
  "src/lib/readiness.ts",
];

/** `src/db/interests.ts`, `src/db/interest-*.ts`, `src/lib/interests.ts`, `src/db/schema/interests.ts`. */
const INTEREST_MODULE = /(^|\/)(interests|interest-[a-z-]+)(\.ts)?$/;

/** The schema bindings that are the interest tables. */
const INTEREST_TABLES = new Set([
  "interests",
  "Interest",
  "interestUnsubscribeTokens",
  "interestScope",
  "interestAskedBy",
]);

function importsOf(file: string): { spec: string; names: string[] }[] {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const found: { spec: string; names: string[] }[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?([^"';]*?)\s+from\s+"([^"]+)"/g)) {
    const names = (match[1] ?? "")
      .replace(/[{}]/g, " ")
      .split(/[\s,]+/)
      .map((name) => name.replace(/^type$/, ""))
      .filter(Boolean);
    found.push({ spec: match[2] ?? "", names });
  }
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
    found.push({ spec: match[1] ?? "", names: [] });
  }
  return found;
}

describe("the booking transaction and interests (R1)", () => {
  it.each(BOOKING_PATH)("%s imports no interest module", (file) => {
    const interestImports = importsOf(file)
      .map(({ spec }) => spec)
      .filter((spec) => INTEREST_MODULE.test(spec));
    expect(interestImports).toEqual([]);
  });

  it.each(BOOKING_PATH)("%s takes no interest table from the schema", (file) => {
    const fromSchema = importsOf(file)
      .filter(({ spec }) => /(^|\/)schema$/.test(spec))
      .flatMap(({ names }) => names);
    expect(fromSchema.filter((name) => INTEREST_TABLES.has(name))).toEqual([]);
  });

  it("reads every file it guards", () => {
    for (const file of BOOKING_PATH) expect(importsOf(file).length).toBeGreaterThan(0);
  });
});
