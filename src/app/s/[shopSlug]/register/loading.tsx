/**
 * The register page's own Suspense boundary — body-shaped, so a client
 * navigation into the segment paints the form's frame rather than a spinner
 * (ADR 20260804-instant-navigation).
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 animate-pulse px-4 py-8 sm:px-6 sm:py-10">
      <div className="h-9 w-3/5 rounded bg-surface-sunken" />
      <div className="mt-3 h-5 w-full rounded bg-surface-sunken" />
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {["name", "email", "phone", "agency", "level", "card"].map((field) => (
          <div key={field}>
            <div className="h-4 w-24 rounded bg-surface-sunken" />
            <div className="mt-2 h-11 rounded-lg border border-border bg-surface" />
          </div>
        ))}
      </div>
      <div className="mt-8 h-11 w-44 rounded-full bg-surface-sunken" />
    </main>
  );
}
