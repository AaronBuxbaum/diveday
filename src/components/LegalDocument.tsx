import type { ReactNode } from "react";
import { SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
import {
  BANNER_TITLE_CLASS,
  MARKETING_EYEBROW_CLASS,
  SUB_TITLE_CLASS,
} from "@/components/ui/typography";

/*
 * The document's measurements, named once because two things draw them: the
 * document, and `LegalDocumentFallback`, whose bars must land where the words
 * do (K-407).
 */
const COLUMN_CLASS = "mx-auto w-full max-w-3xl px-6 py-16 lg:py-24";
const TITLE_CLASS = `${BANNER_TITLE_CLASS} leading-tight sm:text-4xl`;
const META_CLASS = "text-sm text-muted";
/** The intro and every section's prose: 28px lines. */
const PROSE_CLASS = "text-base leading-7";
const SECTIONS_CLASS = "mt-12 flex flex-col gap-12";
const SECTION_BODY_CLASS = "mt-4 flex flex-col gap-4";
const TERM_LIST_CLASS = "flex flex-col gap-3";

/**
 * The shape both legal pages wear: `/privacy` and `/terms`.
 *
 * One component rather than two near-identical page bodies, because these two
 * pages differ only in their words. They are also the only pages on the
 * marketing surface that are *read* rather than scanned — a shop owner
 * evaluating DiveDay at 11pm goes looking for a specific paragraph — so the
 * measure is narrower than the marketing pages beside them and the type is
 * plain. No cards, no eyebrow-per-section, no illustrations: everything that
 * makes a landing page scannable makes a policy harder to read straight
 * through.
 *
 * Deliberately without a table of contents. Nine short sections is a page you
 * scroll, and an index that duplicates every heading is the second copy of the
 * same list that `docs/design/principles.md` #9 asks us not to write.
 */
export function LegalDocument({
  eyebrow,
  title,
  updated,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  /** "Describes DiveDay as it works today." — deliberately not a version number. */
  updated: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="flex-1">
      {/* `text-pretty` on the column, not per paragraph: `text-wrap` inherits,
          and a term list's inline `<dt>`/`<dd>` pair has no block of its own
          to carry it. Without it the policy ended lines on "it." (K-484). */}
      <div className={`${COLUMN_CLASS} text-pretty`}>
        <p className={MARKETING_EYEBROW_CLASS}>{eyebrow}</p>
        <h1 className={`mt-4 ${TITLE_CLASS}`}>{title}</h1>
        <p className={`mt-3 ${META_CLASS}`}>{updated}</p>
        <p className={`mt-8 ${PROSE_CLASS}`}>{intro}</p>
        <div className={SECTIONS_CLASS}>{children}</div>
      </div>
    </main>
  );
}

/**
 * One block of a section's body, as `LegalDocumentFallback` draws it: a
 * paragraph and the lines it wraps to, or a `LegalTermList` and the lines each
 * of its terms wraps to.
 */
export type LegalBlockShape = { paragraph: SkeletonLines } | { terms: readonly SkeletonLines[] };

/**
 * What a legal page paints while its localized body streams (its route's
 * `loading.tsx`, ADR 20260804-instant-navigation): the document's first screen
 * in bars, line for line.
 *
 * Each bar is one line box — `h-lh` in the type of the text it stands for,
 * stacked with no gap, a line one side of `sm` does not have hidden there
 * (`SkeletonLineBars`) — and each run of lines stands at the document's own
 * margins and gaps. `/privacy`'s hand-drawn copy of this layout had none of
 * that: two title bars for a one-line title, 20px bars with gaps for 28px
 * lines, 104px sections for 224px ones, so the page jumped 40px at 1280 and
 * its first heading 147px on a phone when the words landed (K-407).
 *
 * How far the words wrap is each page's own business, so the line counts are
 * the caller's: `titleLines`, `introLines`, and `sections` down to the fold —
 * each section a heading line over its blocks. Past the fold nothing is seen
 * landing, so nothing below it needs drawing.
 */
export function LegalDocumentFallback({
  titleLines,
  introLines,
  sections,
}: {
  titleLines: SkeletonLines;
  introLines: SkeletonLines;
  sections: readonly (readonly LegalBlockShape[])[];
}) {
  const prose = `h-lh ${PROSE_CLASS}`;
  return (
    <main className="flex-1 animate-pulse">
      <div className={COLUMN_CLASS}>
        <SkeletonLineBars lines={1} height={`h-lh ${MARKETING_EYEBROW_CLASS}`} width="w-48" />
        <div className="mt-4">
          <SkeletonLineBars lines={titleLines} height={`h-lh ${TITLE_CLASS}`} width="w-5/6" />
        </div>
        <div className="mt-3">
          <SkeletonLineBars lines={1} height={`h-lh ${META_CLASS}`} width="w-56" />
        </div>
        <div className="mt-8">
          <SkeletonLineBars lines={introLines} height={prose} width="w-full" />
        </div>
        <div className={SECTIONS_CLASS}>
          {sections.map((blocks, section) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the section's place is the only identity a placeholder has
            <div key={section}>
              <SkeletonLineBars lines={1} height={`h-lh ${SUB_TITLE_CLASS}`} width="w-2/5" />
              <div className={SECTION_BODY_CLASS}>
                {blocks.map((block, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above
                  <LegalBlockBars key={index} block={block} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/** One block of a fallback section: a paragraph's lines, or a term list's terms at the list's gap. */
function LegalBlockBars({ block }: { block: LegalBlockShape }) {
  const prose = `h-lh ${PROSE_CLASS}`;
  if ("terms" in block) {
    return (
      <div className={TERM_LIST_CLASS}>
        {block.terms.map((lines, term) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the term's place is the only identity a placeholder has
          <div key={term}>
            <SkeletonLineBars lines={lines} height={prose} width="w-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <SkeletonLineBars lines={block.paragraph} height={prose} width="w-full" />
    </div>
  );
}

/** One numbered-in-spirit section: a heading and whatever prose or list it holds. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className={SUB_TITLE_CLASS}>{heading}</h2>
      <div className={`${SECTION_BODY_CLASS} ${PROSE_CLASS}`}>{children}</div>
    </section>
  );
}

/**
 * The term-and-explanation list both pages lean on ("Stripe — payments, on the
 * shop's own connected account").
 *
 * A real `<dl>`, not a styled `<ul>`: a screen reader announcing "Stripe,
 * definition, payments on the shop's own connected account" is reading the
 * structure the sentence actually has. The term is bold and inline with its
 * body so the pair reads as one sentence rather than a label above a
 * paragraph — these are asides in a document, not cards in a grid.
 *
 * The dash between them is punctuation this component owns, not something each
 * message carries. Without it the pair reads as a run-on — "Keep the records
 * accurate a manifest is only as good as what was typed into it" — which is
 * exactly how it shipped to the first screenshot. Putting it in the copy
 * instead would mean 30-odd strings that each have to remember it, in every
 * locale, and one that forgot would look like a typo rather than a bug. It is
 * `aria-hidden` because it is a visual separator: the `<dt>`/`<dd>` boundary
 * already tells assistive tech where the term ends.
 */
export function LegalTermList({ items }: { items: ReadonlyArray<{ term: string; body: string }> }) {
  return (
    <dl className={TERM_LIST_CLASS}>
      {items.map((item) => (
        <div key={item.term}>
          <dt className="inline font-semibold">{item.term}</dt>
          <span aria-hidden="true"> — </span>
          <dd className="inline text-muted">{item.body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain bulleted list, for the retention windows — facts with no term to name. */
export function LegalList({ items }: { items: ReadonlyArray<string> }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
