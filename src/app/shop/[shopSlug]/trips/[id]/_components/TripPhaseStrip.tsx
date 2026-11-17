import Link from "next/link";
import { shopPath } from "@/lib/staff-notices";
import { CLOCK_PHASES, type ClockPhase, phaseStanding } from "@/lib/trip-clock";
import type { PhaseStripCopy } from "./trip-clock-copy";

/**
 * **The five phases of one trip, one at a time** (ADR 20261117-trip-page-clock).
 *
 * Five links, `?phase=`: phases behind the current one are done (green), the
 * current one is teal, those ahead are quiet. The phase on screen carries
 * `aria-current`. When someone is looking at another phase than the current
 * one, a line under the strip takes them back in one tap; the current phase's
 * own link does too, since it carries no `?phase=`.
 *
 * The strip names the kind of work, never where people are: that comes only
 * from recorded roll-call evidence and the crew's taps, in the sentence below.
 * At 390 px all five fit as short labels, the "when" under each left to wider
 * screens.
 */
export function TripPhaseStrip({
  shopSlug,
  tripId,
  current,
  shown,
  copy,
}: {
  shopSlug: string;
  tripId: string;
  /** The phase the trip is in now; `null` for a cancelled trip. */
  current: ClockPhase | null;
  /** The phase on screen, or `null` when the screen is not a phase (Gear, Edit trip). */
  shown: ClockPhase | null;
  copy: PhaseStripCopy;
}) {
  const root = shopPath(shopSlug, "trips", tripId);
  const hrefOf = (phase: ClockPhase) => (phase === current ? root : `${root}?phase=${phase}`);
  return (
    <div data-trip-phases="">
      <nav aria-label={copy.label}>
        <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {CLOCK_PHASES.map((phase) => {
            const standing = phaseStanding(phase, current);
            const onScreen = phase === shown;
            const words = copy.phases[phase];
            return (
              <li key={phase} className="flex min-w-0">
                <Link
                  href={hrefOf(phase)}
                  aria-current={onScreen ? "page" : undefined}
                  data-phase={phase}
                  data-standing={standing}
                  className="group flex min-h-11 min-w-0 grow flex-col gap-2 rounded-sm pb-1 focus-visible:focus-ring"
                >
                  <span
                    aria-hidden="true"
                    className={`h-1 w-full rounded-full ${
                      standing === "done"
                        ? "bg-success"
                        : standing === "now"
                          ? "bg-primary"
                          : "bg-border group-hover:bg-border-strong"
                    }`}
                  />
                  <span
                    className={`text-center text-xs sm:text-start sm:text-sm ${
                      onScreen
                        ? "font-semibold text-primary"
                        : standing === "ahead"
                          ? "text-muted group-hover:text-foreground"
                          : "font-medium text-foreground"
                    }`}
                  >
                    <span aria-hidden="true" className="sm:hidden">
                      {words.short}
                    </span>
                    <span className="sr-only sm:not-sr-only">{words.name}</span>
                  </span>
                  {words.when ? (
                    <span className="hidden truncate text-xs text-muted tabular-nums sm:block">
                      {words.when}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      {current && shown !== current ? (
        <p className="mt-2 text-sm">
          <Link href={root} className="font-medium text-primary hover:underline">
            {copy.backToNow(copy.phases[current].name)}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
