import { type BadgeTone, badgeToneGlyph } from "@/components/ui/badge";

/**
 * A held card's status, as a mark beside the card rather than a pill beside
 * the buttons.
 *
 * Every certification list on the diver record used to end its row with a
 * `<Badge>` — "Pending", "Certified", "Expired" — sitting first in the same
 * flex row as "Mark certified" and "Delete". Those are `min-h-11` controls and
 * the badge is a ~28px pill, so the row read as three buttons, one of them
 * shrunk and unclickable. The status was also the furthest thing on the row
 * from the card it describes: a staffer scanning "is this diver's Open Water
 * verified?" read the agency and level on the left and then travelled the full
 * width of the card to find out.
 *
 * So it moves to the front of the card's own title line. The mark is the app's
 * existing status vocabulary (`Badge`'s tone glyphs, shared here rather than
 * copied), never colour alone, with the word carried for screen readers and on
 * hover. Nothing is lost by dropping the visible word: a pending card is the
 * only one that renders "Mark certified", and an expired one already says
 * "Refresher overdue <date>" on the line below.
 */
export function CardStatusMark({ tone, label }: { tone: BadgeTone; label: string }) {
  const glyph = badgeToneGlyph(tone);
  if (!glyph) return null;
  return (
    <span className="shrink-0 leading-none" title={label}>
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
