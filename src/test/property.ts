import path from "node:path";
import fc from "fast-check";
import { expect, it } from "vitest";
import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  SpecialtyCertification,
} from "@/db/schema";
import { type CalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { CERTIFICATION_LEVELS, type CertificationLevel } from "@/lib/certification-levels";
import type { Requirement } from "@/lib/requirement";
import { TEST_FROZEN_CLOCK } from "./frozen-clock";

/**
 * **Property tests: a rule stated once, attacked with generated cases.**
 *
 * A thin wrapper over fast-check (ADR 20261122-property-tests-with-fast-check)
 * so every property in the repository behaves the same way:
 *
 * - 300 runs by default, `runs` per test, and `FC_RUNS` multiplies every count
 *   for a longer hunt (`FC_RUNS=20 pnpm test src/lib/money.properties.test.ts`).
 * - `FC_SEED` replays one exact sequence; without it each run draws a fresh
 *   seed. On failure the message carries fast-check's shrunk counterexample and
 *   the exact command that reruns it. A property that fails once is a real
 *   counterexample, never a flake to retry.
 */

const DEFAULT_RUNS = 300;

export type PropertyOptions = {
  /** Generated cases for this property; multiplied by `FC_RUNS`. */
  runs?: number;
};

type Arbitraries<Ts extends [unknown, ...unknown[]]> = { [K in keyof Ts]: fc.Arbitrary<Ts[K]> };

/** A positive integer environment knob, or the fallback. */
function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

/** An integer seed from `FC_SEED`, or undefined for a fresh one. */
function envSeed(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`FC_SEED must be an integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

export type CheckSettings = {
  runs: number;
  seed: number | undefined;
  /** The repo-relative test file, named in the rerun command. */
  file: string;
};

/**
 * Run one property and throw on a counterexample. Separate from `property`
 * only so the helper's own test can call it outside a registered `it`.
 */
export function checkProperty<Ts extends [unknown, ...unknown[]]>(
  arbitraries: Arbitraries<Ts>,
  predicate: (...args: Ts) => boolean | undefined,
  settings: CheckSettings,
): void {
  const details = fc.check(fc.property(...arbitraries, predicate), {
    numRuns: settings.runs,
    seed: settings.seed,
    verbose: 1,
  });
  if (!details.failed) return;
  const report = fc.defaultReportMessage(details) ?? "Property failed.";
  throw new Error(`${report}\n\nRerun: FC_SEED=${details.seed} pnpm test ${settings.file}`);
}

/** The settings a registered property reads from the environment. */
export function settingsFromEnv(
  env: Record<string, string | undefined>,
  options: PropertyOptions,
  file: string,
): CheckSettings {
  return {
    runs: (options.runs ?? DEFAULT_RUNS) * positiveInteger(env.FC_RUNS, 1),
    seed: envSeed(env.FC_SEED),
    file,
  };
}

/** The test file Vitest is running, relative to the repository root. */
function currentTestFile(): string {
  const testPath = expect.getState().testPath;
  return testPath ? path.relative(process.cwd(), testPath) : "<this file>";
}

/**
 * Register a Vitest test asserting `predicate` holds for every generated case.
 * The predicate returns false or throws (an `expect`) to fail.
 */
export function property<Ts extends [unknown, ...unknown[]]>(
  name: string,
  arbitraries: Arbitraries<Ts>,
  predicate: (...args: Ts) => boolean | undefined,
  options: PropertyOptions = {},
): void {
  it(name, () => {
    checkProperty(arbitraries, predicate, settingsFromEnv(process.env, options, currentTestFile()));
  });
}

/** The frozen instant every unit test reads as "now" (`src/test/frozen-clock.ts`). */
export const PROPERTY_NOW = new Date(TEST_FROZEN_CLOCK);

/** A shop-local calendar day within two years either side of the frozen clock. */
export const arbDay: fc.Arbitrary<CalendarDate> = fc
  .integer({ min: -730, max: 730 })
  .map((offset) => shiftCalendarDate(TEST_FROZEN_CLOCK.slice(0, 10), offset));

/** An amount of money in integer minor units, zero included, up to a million major units. */
export const arbCents: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100_000_000 });

/** An instant within a year either side of the frozen clock, at millisecond precision. */
export const arbMoment: fc.Arbitrary<Date> = fc
  .integer({ min: -365 * 24 * 60 * 60 * 1000, max: 365 * 24 * 60 * 60 * 1000 })
  .map((offset) => new Date(PROPERTY_NOW.getTime() + offset));

const SPECIALTY_CODES: Record<DiveSpecialty, true> = {
  deep: true,
  wreck: true,
  night: true,
  drysuit: true,
  cavern: true,
};

/** Every rung of the certification ladder. */
export const arbLevel: fc.Arbitrary<CertificationLevel> = fc.constantFrom(...CERTIFICATION_LEVELS);

/** Every specialty a requirement can demand (exhaustive by the `Record` above). */
export const arbSpecialty: fc.Arbitrary<DiveSpecialty> = fc.constantFrom(
  ...(Object.keys(SPECIALTY_CODES) as DiveSpecialty[]),
);

const arbStatus = fc.constantFrom<"pending" | "verified">("pending", "verified");
const arbStamp = fc.option(arbMoment, { nil: null });

/**
 * A level card in any state the readiness ladder distinguishes: verified or
 * pending, with or without a number, staff-typed or the diver's own claim.
 */
export const arbCertification: fc.Arbitrary<Certification> = fc
  .record({
    level: arbLevel,
    status: arbStatus,
    identifier: fc.option(fc.constant("CARD-1"), { nil: null }),
    selfDeclaredAt: arbStamp,
  })
  .map((card) => card as Certification);

/** A specialty card in any state: pending, verified, imported and reviewed or not. */
export const arbSpecialtyCertification: fc.Arbitrary<SpecialtyCertification> = fc
  .record({
    specialty: arbSpecialty,
    status: arbStatus,
    importedAt: arbStamp,
    reviewedAt: arbStamp,
    selfDeclaredAt: arbStamp,
  })
  .map((card) => card as SpecialtyCertification);

/** A nitrox card in any state, including a bare self-declared tick. */
export const arbNitroxCertification: fc.Arbitrary<NitroxCertification> = fc
  .record({ status: arbStatus, selfDeclaredAt: arbStamp })
  .map((card) => card as NitroxCertification);

/** What a trip or a site can demand, including nothing at all. */
export const arbRequirement: fc.Arbitrary<Requirement> = fc.record({
  minimumCertificationLevel: fc.option(arbLevel, { nil: null }),
  requiredSpecialties: fc.uniqueArray(arbSpecialty, { maxLength: 3 }),
  requiresNitrox: fc.boolean(),
});
