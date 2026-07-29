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
      {briefings.filter(({ diveSite }) => diveSite).length > 1 ? (
        <details className="mt-5 rounded-xl border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">Compare the sites</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-lg text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2">Site</th>
                  <th className="p-2">Depth</th>
                  <th className="p-2">Experience</th>
                  <th className="p-2">Water movement</th>
                  <th className="p-2">Likely life</th>
                </tr>
              </thead>
              <tbody>
                {briefings
                  .filter(({ diveSite }) => diveSite)
                  .map(({ dive, diveSite }) => (
                    <tr key={dive.id} className="border-b border-border/60">
                      <th className="p-2 font-semibold">{diveSite?.name}</th>
                      <td className="p-2 text-muted">{diveSite?.depthRange ?? "Varies"}</td>
                      <td className="p-2 text-muted">{diveSite?.difficulty ?? "Crew-led"}</td>
                      <td className="p-2 text-muted">
                        {diveSite?.currentNote ?? "Confirmed at dock"}
                      </td>
                      <td className="p-2 text-muted">
                        {diveSite?.marineLife ?? diveSite?.marineLifeDescription ?? "Ask the crew"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Typical site facts, not a promise of the route, wildlife, or conditions on the day.
          </p>
        </details>
      ) : null}
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
