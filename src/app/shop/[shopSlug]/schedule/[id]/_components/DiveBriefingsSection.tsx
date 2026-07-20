import { DiveBriefingCard } from "@/components/DiveBriefingCard";
import type { DiveBriefing, Trip } from "./types";

export function DiveBriefingsSection({
  briefings,
  trip,
}: {
  briefings: DiveBriefing[];
  trip: Trip;
}) {
  if (briefings.length === 0) return null;
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            Dive briefings
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {trip.plannedDives === 2 ? "Your two-tank plan" : `Your ${trip.plannedDives}-dive plan`}
          </h2>
        </div>
        {briefings.length > 1 ? (
          <p className="text-sm font-medium text-muted sm:hidden">Swipe to explore each dive →</p>
        ) : null}
      </div>
      {/* Dives stack in one column on larger screens: a two-tank day often
          pairs one richly-briefed site with a sparse second tank, and a
          multi-column grid would strand a tall card beside a near-empty one.
          Full-width cards size to their own content, so there is no blank box. */}
      <div className="-mx-6 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-3 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-1 sm:overflow-visible sm:px-0">
        {briefings.map(({ dive, diveSite, creatures, moments }) => (
          <DiveBriefingCard
            key={dive.id}
            diveNumber={dive.diveNumber}
            title={dive.title}
            description={dive.description}
            site={diveSite}
            creatures={creatures}
            moments={moments}
          />
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">
        Conditions and timing apply to the whole boat day. Sites can change, and the crew makes the
        final call at the dock.
      </p>
    </section>
  );
}
