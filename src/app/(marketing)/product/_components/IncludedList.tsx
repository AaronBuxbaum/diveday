"use client";

import { useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";

/** How many lines a phone shows before "Show all". */
export const INCLUDED_PREVIEW_COUNT = 5;

/**
 * One row: a rule under every row, and over the first row of each column (the
 * second row is the right column's first from `sm`).
 */
const ROW_CLASS =
  "flex gap-3 border-b border-border py-3.5 leading-6 first:border-t sm:[&:nth-child(2)]:border-t";

/**
 * **A feature page's "What's in it" list** (#4320). The list is the whole
 * group from the capability index, ten to sixteen lines, and on a phone it ran
 * for two screens between the steps and the first question. Below `sm` it
 * shows its first five lines and a button that names the full count; from `sm`
 * up, where it sets in two columns, every line is always shown and the button
 * is gone. The hidden lines stay in the document, so the page reads the same
 * to a search engine and nothing loads on the tap.
 *
 * The words arrive translated from the server page, so this needs no provider.
 */
export function IncludedList({ items, showAllLabel }: { items: string[]; showAllLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = items.length > INCLUDED_PREVIEW_COUNT;
  return (
    <>
      <ul className="grid gap-x-10 sm:grid-cols-2">
        {items.map((item, index) => (
          <li
            key={item}
            className={
              !expanded && index >= INCLUDED_PREVIEW_COUNT
                ? `${ROW_CLASS} max-sm:hidden`
                : ROW_CLASS
            }
          >
            <DiveDayIcon name="check" className="mt-1 size-4 shrink-0 text-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {collapsible && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={buttonClass({ variant: "secondary", className: "mt-4 w-full sm:hidden" })}
        >
          {showAllLabel}
        </button>
      ) : null}
    </>
  );
}
