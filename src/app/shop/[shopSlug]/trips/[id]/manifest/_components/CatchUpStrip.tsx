import { buttonClass } from "@/components/ui/button";

/**
 * **The shift catch-up strip** — what the desk did while this crew member was
 * not looking, in one paragraph, above the instrument (issues #1202 and #1187,
 * delight report D42 with D27 folded in; ADR 20260904-reef-all-the-way-down,
 * slice 16d, "the manifest keeps every rule it has and gains two strips at its
 * top").
 *
 * **The three bans this keeps, because it lives on a manifest** (Budget rule 8
 * of that ADR): *no drawing* — there is no `<svg>` in this file and none may be
 * added; *no coral* — the strip is lagoon-toned `bg-primary-tint`, which is a
 * wash rather than a status; *no motion* — nothing here transitions, animates,
 * or moves. `CatchUpStrip.test.tsx` pins all three.
 *
 * Two more properties are load-bearing rather than incidental:
 *
 * - **It renders nothing when there is nothing new.** Not an empty state, not a
 *   "you are up to date" line: a panel that is always present on the busiest
 *   safety screen in the app is a panel a crew learns to scroll past.
 * - **It never prints.** The printed manifest is the document that goes ashore
 *   or into a coastguard's hands, and a paragraph about what the desk did at
 *   06:40 is neither current nor evidence by the time it is read.
 *
 * It is deliberately **not** a `SectionCard`. The card is the object a page's
 * sections are made of; this is an inset carved into the page above them, the
 * same shape the offline group's sunken blocks use, and giving it a panel's
 * border and elevation would make a transient notice look like a section of the
 * manifest.
 *
 * Every string arrives as a prop: `staffTranslator` is server-side only, and
 * the sentences interpolate names through `Intl.ListFormat` in the reader's
 * locale, which the page does once.
 */
export function CatchUpStrip({
  label,
  sentences,
  dismissLabel,
  dismissAction,
}: {
  /** "Since you looked at 6:10 · from the desk" — composed with the shop's zone. */
  label: string;
  /** One per kind that has something to say, already worded and ordered. */
  sentences: readonly string[];
  dismissLabel: string;
  dismissAction: () => Promise<void>;
}) {
  if (sentences.length === 0) return null;
  return (
    <section
      aria-labelledby="catch-up-label"
      className="mt-4 rounded-inset bg-primary-tint p-4 print:hidden"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="catch-up-label" className="flex-1 text-base font-semibold">
          {label}
        </h2>
        <form action={dismissAction}>
          <button type="submit" className={buttonClass({ variant: "ghost" })}>
            {dismissLabel}
          </button>
        </form>
      </div>
      {/* One paragraph, one sentence per kind. Sentences rather than a bulleted
          list because this is a person telling you what happened, and a list of
          three bullets on a phone costs three lines of vertical space above the
          head count for the same words. */}
      <p className="mt-2 text-base">{sentences.join(" ")}</p>
    </section>
  );
}
