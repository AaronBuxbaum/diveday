/** Body-shaped skeleton for a public course page (design principle 1). */
export default function CoursePageLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-64 rounded bg-surface-sunken" />
        <div className="mt-8 h-64 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
