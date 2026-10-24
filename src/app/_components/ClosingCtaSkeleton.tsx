/**
 * `ClosingCta`'s shape for a page's `loading.tsx`: the heading's two
 * lines, the support line and the pair's two 48px doors. Nothing in it is a
 * link or a form: a fallback holds shape, never interaction.
 */
export function ClosingCtaSkeleton() {
  const bar = "rounded bg-surface-sunken";
  return (
    <section className="border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-7xl animate-pulse px-6 py-20 lg:py-24">
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
