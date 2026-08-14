import type { ReactNode } from "react";

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
      <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-24">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">{eyebrow}</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-muted">{updated}</p>
        <p className="mt-8 text-base leading-7">{intro}</p>
        <div className="mt-12 flex flex-col gap-12">{children}</div>
      </div>
    </main>
  );
}

/** One numbered-in-spirit section: a heading and whatever prose or list it holds. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{heading}</h2>
      <div className="mt-4 flex flex-col gap-4 text-base leading-7">{children}</div>
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
    <dl className="flex flex-col gap-3">
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
