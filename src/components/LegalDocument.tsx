import type { ReactNode } from "react";
import { SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
import {
  BANNER_TITLE_CLASS,
  MARKETING_EYEBROW_CLASS,
  SUB_TITLE_CLASS,
} from "@/components/ui/typography";

/*
 * The document's boxes, named once because two things draw them: the document
 * and `LegalDocumentSkeleton`, whose bars stand in each one's own box so the
 * streamed page lands where they stood (K-411, K-407).
 *
 * `text-pretty` is on the column, not per paragraph: `text-wrap` inherits, and
 * a term list's inline `<dt>`/`<dd>` pair has no block of its own to carry it.
 * Without it the policy ended lines on "it." (K-484).
 */
const COLUMN_CLASS = "mx-auto w-full max-w-3xl px-6 py-16 text-pretty lg:py-24";
const TITLE_CLASS = `mt-4 ${BANNER_TITLE_CLASS} leading-tight sm:text-4xl`;
const DATELINE_CLASS = "mt-3 text-sm text-muted";
const INTRO_CLASS = "mt-8 text-base leading-7";
const SECTIONS_CLASS = "mt-12 flex flex-col gap-12";
const SECTION_BODY_CLASS = "mt-4 flex flex-col gap-4 text-base leading-7";
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
      <div className={COLUMN_CLASS}>
        <p className={MARKETING_EYEBROW_CLASS}>{eyebrow}</p>
        <h1 className={TITLE_CLASS}>{title}</h1>
        <p className={DATELINE_CLASS}>{updated}</p>
        <p className={INTRO_CLASS}>{intro}</p>
        <div className={SECTIONS_CLASS}>{children}</div>
      </div>
    </main>
  );
}

/** One numbered-in-spirit section: a heading and whatever prose or list it holds. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className={SUB_TITLE_CLASS}>{heading}</h2>
      <div className={SECTION_BODY_CLASS}>{children}</div>
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

/**
 * One block of a section's body, as the skeleton draws it: a paragraph's line
 * count, or a term list's, one count per term.
 */
export type LegalSkeletonBlock = SkeletonLines | { terms: ReadonlyArray<SkeletonLines> };

/**
 * **What a legal page paints while its words stream in**: the document's own
 * boxes, with a bar for each line (K-411, K-407).
 *
 * `/terms` and `/privacy` each typed a copy of one skeleton (two title bars,
 * three intro bars, three short bars per section) that neither page rendered:
 * bars 16px and 20px tall with 8px gaps standing in for 28px lines, so the
 * streamed page jumped 53px on a desk, and on a phone the second section's
 * heading stood where the first section's paragraph lands.
 *
 * Each block here wears the classes the document's element wears, so its type
 * and line height are the document's, and each line is a bar one line box tall
 * (`h-lh`) stacked with no gap, as a paragraph's line boxes are
 * (`SkeletonLineBars`). N lines are then exactly N line heights at every width,
 * the title's 37.5px and 45px included. What stays with each page is how far
 * its words wrap (one count, or one below `sm` and one from it) and roughly
 * how wide its eyebrow and title are. Nothing here is interactive, and nothing
 * is a heading or a paragraph: a fallback holds shape, never content (ADR
 * 20260804-instant-navigation's 2026-08-14 amendment).
 */
export function LegalDocumentSkeleton({
  eyebrowWidth = "w-40",
  titleWidth = "w-4/5",
  titleLines,
  introLines,
  sections,
}: {
  /** Tailwind width classes for the eyebrow's bar. */
  eyebrowWidth?: string;
  /** Tailwind width classes for the title's bars. */
  titleWidth?: string;
  /** How many lines the title wraps to. */
  titleLines: SkeletonLines;
  /** How many lines the intro wraps to. */
  introLines: SkeletonLines;
  /** Each section's body, block by block, as the page's `LegalSection`s hold it. */
  sections: ReadonlyArray<ReadonlyArray<LegalSkeletonBlock>>;
}) {
  return (
    <main className="flex-1 animate-pulse">
      <div className={COLUMN_CLASS}>
        <div className={MARKETING_EYEBROW_CLASS}>
          <SkeletonLineBars lines={1} height="h-lh" width={eyebrowWidth} />
        </div>
        <div className={TITLE_CLASS}>
          <SkeletonLineBars lines={titleLines} height="h-lh" width={titleWidth} />
        </div>
        <div className={DATELINE_CLASS}>
          <SkeletonLineBars lines={1} height="h-lh" width="w-60 max-w-full" />
        </div>
        <div className={INTRO_CLASS}>
          <SkeletonLineBars lines={introLines} height="h-lh" width="w-full" />
        </div>
        <div className={SECTIONS_CLASS}>
          {sections.map((blocks, section) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the section number is the only identity a placeholder section has
            <div key={section}>
              <div className={SUB_TITLE_CLASS}>
                <SkeletonLineBars lines={1} height="h-lh" width="w-1/2 sm:w-2/5" />
              </div>
              <div className={SECTION_BODY_CLASS}>
                {blocks.map((block, index) =>
                  typeof block === "object" && "terms" in block ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: as above
                    <div key={index} className={TERM_LIST_CLASS}>
                      {block.terms.map((lines, term) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: as above
                        <div key={term}>
                          <SkeletonLineBars lines={lines} height="h-lh" width="w-full" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: as above
                    <div key={index}>
                      <SkeletonLineBars lines={block} height="h-lh" width="w-full" />
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
