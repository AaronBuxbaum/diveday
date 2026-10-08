/**
 * The thread under `/ready`'s masthead, as bars: the status figure, the step
 * spine as hairline rows on the page background, and what to pack.
 *
 * Two callers, one shape. `loading.tsx` draws it under the masthead's bars
 * while the token is still being verified, and the page draws it under the
 * real masthead and the "You're on the boat" moment while the spine's own
 * reads stream in (UX audit #5), so the confirmation is never held behind a
 * skeleton of itself. The third row stands tall because one step is open at
 * rest with its form inline, and a skeleton of five equal rows would collapse
 * the instant the real one arrived.
 */
export function ReadyThreadBodySkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      {/* The one status statement: a figure, and what is next. */}
      <div className="mt-8 flex items-baseline gap-3">
        <div className="h-8 w-10 rounded bg-surface-sunken" />
        <div className="h-5 w-24 rounded bg-surface-sunken" />
        <div className="ms-auto h-4 w-32 rounded bg-surface-sunken" />
      </div>
      <div className="mt-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="border-t border-border py-4 last:border-b">
            <div className="flex items-center gap-3">
              <div className="size-5 shrink-0 rounded-full bg-surface-sunken" />
              <div className="h-5 w-40 max-w-full rounded bg-surface-sunken" />
            </div>
            {i === 2 ? <div className="mt-4 h-40 w-full rounded-inset bg-surface-sunken" /> : null}
          </div>
        ))}
      </div>
      {/* What to pack, below the spine. */}
      <div className="mt-10 h-6 w-48 rounded bg-surface-sunken" />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
