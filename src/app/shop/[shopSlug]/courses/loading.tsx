/** Roster-shaped skeleton for the staff course list (design principle 1). */
export default function StaffCoursesLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-20 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-48 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
