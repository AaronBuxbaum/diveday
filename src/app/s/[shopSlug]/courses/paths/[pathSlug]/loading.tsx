/**
 * Skeleton for one certification path (design principle 1) — title block plus
 * the ordered steps, which is the whole page.
 */
export default function PublicCoursePathLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 animate-pulse">
        <div className="h-3 w-24 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-full max-w-2xl rounded bg-surface-sunken" />
      </div>
      <ol className="flex animate-pulse flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-24 rounded-2xl border border-border bg-surface" />
        ))}
      </ol>
    </main>
  );
}
