import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { scopedId } from "@/lib/element-id";

export type BoatSafetyLine = {
  /** One sentence, composed server-side ("AED: pads expire in 12 days"). */
  text: string;
  /** Has already gone wrong (too many aboard, a lapsed date, kit ashore). */
  urgent: boolean;
};

/**
 * **What this departure's boat carries, and what it holds**, beside the boat
 * check (roadmap N-08, N-10): the people booked aboard against the Coast
 * Guard certificate, the boat's papers, and every clock on the safety kit
 * assigned aboard it that has run out or will within 30 days.
 *
 * Informs, never gates, like the check it sits above — the crew decide at the
 * dock. Opt-in by presence: a boat with nothing to say renders nothing, not
 * an empty card, so a shop that never dates a paper or registers an AED sees
 * the manifest exactly as before.
 *
 * Always open and always printed, unlike the boat check's own list: a lapsed
 * flare date is the one line that must not be a tap away, and the sheet the
 * boat carries has to say it too.
 */
export function BoatSafetyNotices({
  idPrefix,
  heading,
  lines,
}: {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  heading: string;
  lines: readonly BoatSafetyLine[];
}) {
  if (lines.length === 0) return null;
  const urgent = lines.some((line) => line.urgent);
  const headingId = scopedId(idPrefix, "boat-safety-heading");
  return (
    <section
      aria-labelledby={headingId}
      className={`${TONE_PANEL_CLASS} ${urgent ? "border-warning/50 bg-warning/10" : "border-border bg-surface"}`}
    >
      <h2 id={headingId} className="text-base font-semibold text-balance">
        {heading}
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <li
            key={line.text}
            className={line.urgent ? "font-medium text-warning-strong" : "text-muted"}
          >
            {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
