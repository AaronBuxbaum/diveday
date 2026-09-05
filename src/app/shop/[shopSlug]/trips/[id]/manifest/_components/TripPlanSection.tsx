import Link from "next/link";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/**
 * **The plan, and the door to saying it changed** (issue #1184, delight report
 * D24; ADR 20260904-reef-all-the-way-down, slice 16d).
 *
 * Rendered at the departure checkpoint only, where nothing else on the page
 * says what the boat is going out to do — after a dive the executed-dive log
 * owns that ground and this would be a second, quieter copy of it.
 *
 * **Read-only. It writes nothing, and it never touches `trip_dives`.** That is
 * D24's boundary made structural rather than enforced: what happened is
 * recorded on `executed_dives`, in a different table, so the plan a shop
 * published cannot be overwritten by a crew recording a change to it.
 *
 * No drawing, no coral, no motion — it is on the manifest (Budget rule 8). No
 * provenance chip either: the canvas draws one beside each planned site, and
 * that is D51, which lands in slice 16g.
 */
export function TripPlanSection({
  heading,
  dives,
  doorLabel,
  doorNote,
  doorHref,
}: {
  heading: string;
  /** One line per planned dive, already worded — "Dive 1 · Molasses Reef". */
  dives: readonly { diveNumber: number; line: string }[];
  doorLabel: string;
  doorNote: string;
  /** The dive log, at the first after-dive checkpoint. */
  doorHref: string;
}) {
  if (dives.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="trip-plan-heading">
      <h2 id="trip-plan-heading" className={SECTION_TITLE_CLASS}>
        {heading}
      </h2>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {dives.map((dive) => (
          <li key={dive.diveNumber} className="flex min-h-13 items-center py-3 text-base">
            {dive.line}
          </li>
        ))}
      </ul>
      {/* A quiet link, not a button: the act it leads to happens after a dive,
          and a filled control here would compete with the roll call above it
          for the one thing a crew is doing at the dock. */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={doorHref}
          className="inline-flex min-h-11 items-center text-base font-semibold text-primary hover:underline"
        >
          {doorLabel}
        </Link>
        <span className="text-base text-muted">{doorNote}</span>
      </div>
    </section>
  );
}
