import type { FactSource } from "@/lib/fact-source";
import type { DiverMessageKey } from "./messages";

/**
 * **Where a fact came from, in words** — ADR 20260904-reef-all-the-way-down,
 * decision 2, Budget rule 5 (D51).
 *
 * `src/lib/fact-source.ts` returns four codes and no copy, exactly as
 * `thread-steps.ts` and `readiness-summary.ts` do; this is the one place a
 * source becomes a word, so the chip beside a change-ledger entry and the chip
 * beside a departure's site list cannot end up saying different things about
 * the same provenance.
 *
 * Diver keys only. The staff surfaces that will name a source next (the boat's
 * stage strip on the manifest, the evening board) take a staff map beside this
 * one when they arrive — never a second spelling of these four in
 * `staff/*.json` reached from here.
 */
export const DIVER_FACT_SOURCE_KEYS: Record<FactSource, DiverMessageKey> = {
  forecast: "factSource.forecast",
  plan: "factSource.plan",
  crew: "factSource.crew",
  observed: "factSource.observed",
};
