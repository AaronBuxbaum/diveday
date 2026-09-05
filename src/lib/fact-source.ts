/**
 * **Where a mutable fact came from** — ADR 20260904-reef-all-the-way-down,
 * decision 2, Budget rule 5 (D51):
 *
 * > A mutable fact says where it came from (D51): Forecast (hollow), Plan
 * > (lagoon), Crew with a time (ink), Observed (success). Only Observed may
 * > print on a recap as what happened.
 *
 * Four codes and no words, like every other union in this directory: the chip
 * that draws them is `src/components/ui/FactSource.tsx` and the one place a
 * code becomes a sentence is `src/i18n/fact-source-labels.ts`.
 *
 * The distinction the four exist to keep is between what somebody *stood
 * behind* and what a model guessed. A forecast is hollow because nobody did:
 * it is a machine's read of the weather at a moment, and a diver deciding
 * whether to drive two hours deserves to see that it is not the shop
 * promising. A plan is what the shop wrote down. Crew is what somebody on the
 * boat said, which is why it is the one that always carries a time — a stage
 * called at 07:40 stops being news by noon. Observed is the record of a thing
 * that actually happened, and Budget rule 5's last clause is a floor rather
 * than a preference: a recap prints Observed and nothing else as what
 * happened, so a forecast can never be laundered into an outcome.
 *
 * **This does not answer who may change a fact** (issue #1211's third
 * question). Authority lives in `src/db/authz.ts` behind `requireShopSurface`,
 * and a presentational chip must never become a second answer to it — a
 * surface that reads a source code to decide whether to render a control is
 * reading the wrong thing.
 */
export const FACT_SOURCES = ["forecast", "plan", "crew", "observed"] as const;

export type FactSource = (typeof FACT_SOURCES)[number];

/**
 * A `trip_change_events` row's own provenance, in this vocabulary.
 *
 * The distinction already existed in that table — the shop edited the plan, or
 * the crew changed something on the day — and the ledger has been rendering it
 * as two hand-written sentences since before the chip existed. `shop` is the
 * plan; `crew` is the crew.
 *
 * The parameter is spelled structurally rather than imported from
 * `src/db/trip-change-events.ts`: the dependency runs `app → features →
 * lib/db`, and `trip_change_event_source`'s two values are the whole of what
 * this needs to know.
 */
export function factSourceFromChangeEvent(source: "shop" | "crew"): FactSource {
  return source === "crew" ? "crew" : "plan";
}
