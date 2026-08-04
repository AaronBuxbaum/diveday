/**
 * Skeleton for the diver-facing certification-path index (design principle 1)
 * — same card rhythm as the paths themselves, so the list settles in place
 * rather than jumping when it arrives.
 */
export default function PublicCoursePathsLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 animate-pulse">
        <div className="h-3 w-20 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-full max-w-2xl rounded bg-surface-sunken" />
      </div>
      <div className="flex animate-pulse flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
    </main>
  );
}
