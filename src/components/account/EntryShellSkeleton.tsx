/**
 * Body-shaped skeleton matching `EntryShell` (design principle 1): centered
 * title and description bars, then either the form panel (borderless on a
 * phone, a bordered surface from `sm` up — the same responsive classes as the
 * real panel, so nothing shifts when the page streams in) or, for the
 * single-button doors (`panel={false}`), a centered button bar.
 *
 * `fields` is a list of slot names, one per stacked label+control pair, so
 * each page's skeleton carries the same number of rows as its real form.
 */
export function EntryShellSkeleton({
  wordmark = false,
  width = "sm",
  panel = true,
  fields = [],
  footnote = true,
}: {
  wordmark?: boolean;
  width?: "sm" | "lg";
  panel?: boolean;
  fields?: readonly string[];
  footnote?: boolean;
}) {
  return (
    <main
      className={`mx-auto flex w-full ${width === "lg" ? "max-w-xl" : "max-w-md"} flex-1 flex-col justify-center px-6 py-12 sm:py-16`}
    >
      <div className="animate-pulse">
        {wordmark ? <div className="mx-auto h-6 w-28 rounded bg-surface-sunken" /> : null}
        <div
          className={`mx-auto h-8 w-56 max-w-full rounded bg-surface-sunken ${wordmark ? "mt-8" : ""}`}
        />
        <div className="mx-auto mt-3 h-4 w-72 max-w-full rounded bg-surface-sunken" />
        {panel ? (
          <div className="mt-8 sm:rounded-2xl sm:border sm:border-border sm:bg-surface sm:p-8">
            {fields.map((slot, index) => (
              <div key={slot} className={index === 0 ? "" : "mt-4"}>
                <div className="h-4 w-28 rounded bg-surface-sunken" />
                <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
              </div>
            ))}
            <div className="mt-6 h-11 w-full rounded-lg bg-surface-sunken" />
          </div>
        ) : (
          <div className="mx-auto mt-8 h-11 w-44 rounded-lg bg-surface-sunken" />
        )}
        {footnote ? <div className="mx-auto mt-8 h-4 w-44 rounded bg-surface-sunken" /> : null}
      </div>
    </main>
  );
}
