import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";

/**
 * **One row of the switching hub's index**: the guide's name, why a reader
 * would stop, and an arrow — the whole row one link.
 *
 * The rule is the item's and the fill is the link's, so the hover chip can take
 * 16px of room around the words — paid back as a negative margin, so the title
 * stays on the heading's column — without dragging the rules out past the
 * list's own top rule. 8px of the row's 24px above and below sits on the item,
 * which keeps the chip off both rules; the words do not move.
 *
 * Not a ledger row, on purpose. This is a marketing index on a 24px rhythm
 * with no `LedgerRow` anywhere on its page: its rules share their length with
 * the list's own top rule and the closing band's rule beneath it, both on the
 * column, and a rounded chip clear of both rules is the fill that suits a
 * spaced list (the pixel probe measured the old fill at 0px from the title,
 * 2026-09-25).
 */
export function HubGuideRow({
  href,
  title,
  summary,
}: {
  href: string;
  title: string;
  summary: string;
}) {
  return (
    <li className="border-b border-border py-2">
      <Link
        href={href}
        className="group -mx-4 flex items-start gap-6 rounded-lg px-4 py-4 transition-colors hover:bg-surface"
      >
        <div className="min-w-0 flex-1">
          <h2 className={`${SUB_TITLE_CLASS} group-hover:text-primary`}>{title}</h2>
          <p className="mt-1.5 leading-7 text-muted">{summary}</p>
        </div>
        <DiveDayIcon
          name="arrow-right"
          className="mt-1 size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary motion-reduce:transition-none"
        />
      </Link>
    </li>
  );
}
