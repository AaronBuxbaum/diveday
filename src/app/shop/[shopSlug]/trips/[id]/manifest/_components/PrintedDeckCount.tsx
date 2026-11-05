import { groupLabelClass } from "@/components/ui/group-label";
import type { printedDeckCountLines } from "./deck-count-view";

/**
 * **The deck count's lines on paper**: one per checkpoint, blank to write on
 * or filled with the newest count (`printedDeckCountLines`). Print only: the
 * screen has the form (`DeckCount`). A static sheet, no control on it.
 */
export function PrintedDeckCount({ heading, lines }: ReturnType<typeof printedDeckCountLines>) {
  return (
    <section aria-label={heading} data-print-only className="hidden print:block">
      <h2 className={groupLabelClass()}>{heading}</h2>
      <ul className="mt-2 space-y-2 text-base tabular-nums">
        {lines.map((line) => (
          <li key={line.checkpoint}>{line.text}</li>
        ))}
      </ul>
    </section>
  );
}
