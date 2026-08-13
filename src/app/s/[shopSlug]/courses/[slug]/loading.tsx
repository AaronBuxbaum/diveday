/**
 * Body-shaped skeleton for a public course page (design principle 1): the
 * hero card with its photo, title block, and fact strip; the eligibility
 * line; the anchor row; and the first prose bars of the overview.
 */
export default function CoursePageLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="overflow-hidden rounded-3xl border border-border bg-surface">
          <div className="h-56 w-full bg-surface-sunken sm:h-80" />
          <div className="p-6 sm:p-8">
            <div className="h-3 w-40 max-w-full rounded bg-surface-sunken" />
            <div className="mt-3 h-9 w-80 max-w-full rounded bg-surface-sunken" />
            <div className="mt-3 h-5 w-64 max-w-full rounded bg-surface-sunken" />
            <div className="mt-6 h-8 w-44 max-w-full rounded bg-surface-sunken" />
          </div>
          <div className="border-t border-border px-6 py-4 sm:px-8">
            <div className="h-9 w-72 max-w-full rounded bg-surface-sunken" />
          </div>
        </div>
        <div className="mt-8 h-3 w-28 rounded bg-surface-sunken" />
        <div className="mt-2 h-6 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-10 border-b border-border pb-4">
          <div className="h-5 w-80 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className="mt-8 max-w-2xl space-y-3">
          <div className="h-7 w-56 rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-2/3 rounded bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
