/**
 * Card-shaped skeleton for a staff invitation (design principle 1) — the token
 * lookup that decides between the accept form and an expired-link notice runs
 * per request, so the shell shows the card both outcomes render into.
 */
export default function InviteLoading() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="animate-pulse rounded-lg border border-border bg-surface p-6">
        <div className="h-8 w-44 rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
        <div className="mt-4 h-4 w-28 rounded bg-surface-sunken" />
        <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
        <div className="mt-5 h-11 w-full rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
