import { TONE_PANEL_CLASS } from "@/components/ui/card";
import type { BoatSafetySection } from "@/lib/boat-safety";
import { scopedId } from "@/lib/element-id";

type BoatSafetyLine = BoatSafetySection["lines"][number];

const PANEL_TONE: Record<BoatSafetyLine["tone"], string> = {
  danger: "border-danger/50 bg-danger/10",
  warning: "border-warning/50 bg-warning/10",
  neutral: "border-border bg-surface",
};

const LINE_TONE: Record<BoatSafetyLine["tone"], string> = {
  danger: "font-semibold text-danger-strong",
  warning: "font-medium text-warning-strong",
  neutral: "text-muted",
};

/**
 * **What this departure's boat carries, and what it holds**, beside the boat
 * check (roadmap N-08, N-10): the O2 kit or AED a hull should carry and does
 * not, the people aboard against the boat's certificate, its papers, and every
 * clock on the safety kit assigned aboard it that has run out or will soon.
 *
 * Informs, never gates, like the check it sits above — the crew decide at the
 * dock. Opt-in by presence: a boat with nothing to say renders nothing, not
 * an empty card, so a shop that never dates a paper or registers an AED sees
 * the manifest exactly as before.
 *
 * Always open and **always printed** (no `print:hidden`, unlike the
 * after-dive controls around it): a lapsed flare date is the one line that
 * must not be a tap away, and the sheet the boat carries has to say it too.
 * Shared by the live manifest and the offline copy, so the two read the same.
 */
export function BoatSafetyNotices({
  idPrefix,
  heading,
  lines,
  className = "",
}: BoatSafetySection & {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  className?: string;
}) {
  if (lines.length === 0) return null;
  const tone = lines.some((line) => line.tone === "danger")
    ? "danger"
    : lines.some((line) => line.tone === "warning")
      ? "warning"
      : "neutral";
  const headingId = scopedId(idPrefix, "boat-safety-heading");
  return (
    <section
      aria-labelledby={headingId}
      data-boat-safety
      className={`${TONE_PANEL_CLASS} ${PANEL_TONE[tone]} ${className}`.trim()}
    >
      <h2 id={headingId} className="text-base font-semibold text-balance">
        {heading}
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <li key={line.text} className={LINE_TONE[line.tone]}>
            {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
