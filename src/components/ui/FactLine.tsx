import { Fragment, type ReactNode } from "react";

/**
 * One fact on a `FactLine`.
 *
 * - **A string** is our own bounded copy — "Metres (m)", "No pool diving",
 *   "6:1 divers per divemaster", a phone number, a price — and is kept whole.
 * - **An object** carries a fact that needs its own ink (`className`: the
 *   name `font-medium`, an id `font-mono`), or free text a shop typed
 *   (`wraps`: a tagline, a fee's name), which wraps like prose because glued
 *   whole it could run off a 390px row.
 *
 * A missing or blank fact is dropped rather than printed as an empty dot.
 */
export type Fact =
  | string
  | { value: ReactNode; className?: string; wraps?: boolean }
  | null
  | undefined
  | false;

/**
 * Between two facts: a no-break space, the dot, then the line's one ordinary
 * space. The dot is glued to the fact before it, so no line opens with "·",
 * and the space after it is the only place the line may wrap.
 */
export const FACT_SEPARATOR = " · ";

/**
 * **A line of facts that wraps only between them** — "hello@… · +1 305 555
 * 0142", "Metres (m) · Celsius (°C) · USD", "Stripe customer · cus_123 ·
 * raised Sep 3".
 *
 * A fact line spelled as one `.join(" · ")` string breaks at every space in
 * every fact: the settings hub's contact row ended a line on "+1" with the rest
 * of the number under it, Diving options broke "6:1 divers / per divemaster",
 * and the data-job items opened a line with the "·" (K-235, K-341). Here each
 * fact is its own `whitespace-nowrap` span unless it is marked `wraps`.
 *
 * It renders inline content and no box of its own, so it sits inside whatever
 * the caller's line is — a row's value, a paragraph. `joinFacts` in
 * `src/lib/format.ts` is the string twin, for a meta line whose facts are the
 * shop's own free text (a course's duration) and so keep their word breaks;
 * reach for this one when the facts are ours and must stay whole, or carry
 * their own ink.
 */
export function FactLine({
  facts,
  empty = null,
}: {
  facts: readonly Fact[];
  /** What the line says when no fact survives — a settings row's "Not set". */
  empty?: ReactNode;
}) {
  const kept = facts.flatMap((fact) => {
    if (fact === null || fact === undefined || fact === false) return [];
    if (typeof fact === "string") return fact.trim() ? [{ value: fact }] : [];
    return fact.value === null || fact.value === undefined || fact.value === "" ? [] : [fact];
  });
  if (kept.length === 0) return <>{empty}</>;
  return (
    <>
      {kept.map((fact, index) => {
        const nowrap = "wraps" in fact && fact.wraps ? "" : "whitespace-nowrap";
        const ink = "className" in fact && fact.className ? fact.className : "";
        const className = `${nowrap} ${ink}`.trim();
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: facts are positional and never reordered
          <Fragment key={index}>
            {index > 0 ? FACT_SEPARATOR : null}
            <span className={className || undefined}>{fact.value}</span>
          </Fragment>
        );
      })}
    </>
  );
}
