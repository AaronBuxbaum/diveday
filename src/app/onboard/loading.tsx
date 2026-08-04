/**
 * Form-shaped skeleton for shop sign-up (design principle 1) — the trial form
 * reads `searchParams` (the plan a visitor arrived on) and the negotiated
 * locale, so the shell carries its shape while those resolve.
 */
export default function OnboardLoading() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-12 sm:py-24">
      <div className="animate-pulse">
        <div className="h-9 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-full rounded bg-surface-sunken" />
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          {["shop", "slug", "owner", "email", "password"].map((slot) => (
            <div key={slot} className="mt-4 first:mt-0">
              <div className="h-4 w-28 rounded bg-surface-sunken" />
              <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
            </div>
          ))}
          <div className="mt-6 h-11 w-full rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
