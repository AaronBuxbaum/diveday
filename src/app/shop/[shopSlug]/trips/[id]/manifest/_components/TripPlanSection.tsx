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
  meeting,
}: {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  heading: string;
  /**
   * One line per planned dive, already worded — "Dive 1 · Molasses Reef" —
   * and the site's last visit under it when a boat has been (fifth-loop
   * ideas, item 6).
   */
  dives: readonly { diveNumber: number; line: string; lastTime?: string }[];
  /**
   * **Where the boat meets** (UX review 2026-10-13, item 18), its word and the
   * place, already worded. First, because it is where the day starts: the
   * diver's `/ready` and every message say it, and the crew reading "The
   * meeting point moved." on the strip above had no staff page that did.
   */
  meeting?: { label: string; line: string };
}) {
  if (dives.length === 0 && !meeting) return null;
  return (
    <section className="print:hidden" aria-labelledby={scopedId(idPrefix, "trip-plan-heading")}>
      <h2 id={scopedId(idPrefix, "trip-plan-heading")} className={SECTION_TITLE_CLASS}>
        {heading}
      </h2>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {meeting ? (
          <li className="flex min-h-13 flex-col justify-center py-3 text-base">
            <span className="text-sm text-muted">{meeting.label}</span>
            <span>{meeting.line}</span>
          </li>
        ) : null}
        {dives.map((dive) => (
          <li
            key={dive.diveNumber}
            className="flex min-h-13 flex-col justify-center py-3 text-base"
          >
            <span>{dive.line}</span>
            {dive.lastTime ? <span className="text-sm text-muted">{dive.lastTime}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
