/** Editor-shaped skeleton for one staff certification path. */
export default function StaffCoursePathLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-8 h-48 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
