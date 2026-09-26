import Link from "next/link";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { scopedId } from "@/lib/element-id";

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
 *
 * **`print:hidden`, like the catch-up strip above it.** The printed trip packet
 * renders this whole manifest *and* its own `PacketDives` list, so without this
 * the sheet a crew carries to the boat prints the dive plan twice — and the
 * door beside it is a link to a screen nobody can tap on paper.
 */
export function TripPlanSection({
  idPrefix,
  heading,
  dives,
  doorLabel,
  doorNote,
  doorHref,
}: {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
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
    <section
      className="mt-8 print:hidden"
      aria-labelledby={scopedId(idPrefix, "trip-plan-heading")}
    >
      <h2 id={scopedId(idPrefix, "trip-plan-heading")} className={SECTION_TITLE_CLASS}>
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
          for the one thing a crew is doing at the dock.

          **The link's words sit at the foot of its 44px box** (`items-end`).
          Centred, the box's lower 10px pushed a phone's wrapped note down to
          38px from the link, baseline to baseline, against the body's 24
          (K-497), and hung an unseen 10px under the section's last words (K-189).
          Below `sm` the pair is a column, so the note follows the link at body
          spacing; from `sm` it is one baseline row. The box's unseen 20px is
          above the words, in the 8px under the list and what the words would
          have had anyway: `mt-2` keeps its ring 3px clear of the list's rule. */}
      <div className="mt-2 flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
        <Link
          href={doorHref}
          className="inline-flex min-h-11 items-end text-base font-semibold text-primary hover:underline"
        >
          {doorLabel}
        </Link>
        <span className="text-base text-muted">{doorNote}</span>
      </div>
    </section>
  );
}
