import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { scopedId } from "@/lib/element-id";

/**
 * **The plan** (issue #1184, delight report D24; ADR
 * 20260904-reef-all-the-way-down, slice 16d).
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
 * the sheet a crew carries to the boat prints the dive plan twice.
 *
 * **No door to the dive log under it** (UX audit 2026-10-07, item 3). "Changed
 * the plan? Say why in the dive log after each dive." sat under the plan at the
 * dock, a sentence about work that happens after a dive, on the screen a crew
 * reads in motion. The log is where a change is recorded, and it is one tap
 * away on the checkpoint switch above, at the checkpoint it belongs to.
 */
export function TripPlanSection({
  idPrefix,
  heading,
  dives,
}: {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  heading: string;
  /** One line per planned dive, already worded — "Dive 1 · Molasses Reef". */
  dives: readonly { diveNumber: number; line: string }[];
}) {
  if (dives.length === 0) return null;
  return (
    <section className="print:hidden" aria-labelledby={scopedId(idPrefix, "trip-plan-heading")}>
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
    </section>
  );
}
