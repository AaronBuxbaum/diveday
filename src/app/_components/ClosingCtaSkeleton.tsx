/**
 * `ClosingCta`'s shape for a page's `loading.tsx`: the heading's two
 * lines, the support line and the pair's two 48px doors. Nothing in it is a
 * link or a form: a fallback holds shape, never interaction.
 */
/**
 * The close's measure. `shell` is the marketing shell's (`max-w-7xl`), the
 * nav's and the footer's, for pages whose bands run that wide. `column` is a
 * page that keeps one narrower column (`/switching`'s `max-w-4xl`), so its
 * close starts on that column's left edge rather than 130px left of it
 * (visual review 2026-10-24, B15 review).
 */
export type ClosingCtaMeasure = "shell" | "column";

const CLOSING_CTA_MEASURE: Record<ClosingCtaMeasure, string> = {
  shell: "max-w-7xl",
  column: "max-w-4xl",
};

/** The close's inner box, shared by `ClosingCta` and this skeleton. */
export function closingCtaBoxClass(measure: ClosingCtaMeasure): string {
  return `mx-auto w-full ${CLOSING_CTA_MEASURE[measure]} px-6 py-20 lg:py-24`;
}

export function ClosingCtaSkeleton({ measure = "shell" }: { measure?: ClosingCtaMeasure }) {
  const bar = "rounded bg-surface-sunken";
  return (
    <section className="border-t border-border bg-surface">
      <div className={`${closingCtaBoxClass(measure)} animate-pulse`}>
        <div className={`h-9 w-full max-w-2xl sm:h-10 ${bar}`} />
        <div className={`mt-4 h-7 w-full max-w-xl ${bar}`} />
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <div className={`h-12 w-full sm:w-40 ${bar}`} />
          <div className={`h-12 w-full sm:w-28 ${bar}`} />
        </div>
      </div>
    </section>
  );
}
