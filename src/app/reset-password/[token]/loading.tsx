/**
 * Card-shaped skeleton for "set a new password" (design principle 1). The
 * bearer token has to be looked up before this page knows whether it is
 * showing a form or an "this link has expired" notice, so the shell shows the
 * card outline both of them land in.
 */
export default function ResetPasswordLoading() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="animate-pulse rounded-lg border border-border bg-surface p-6">
        <div className="h-8 w-48 rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-4 w-28 rounded bg-surface-sunken" />
        <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
        <div className="mt-4 h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
        <div className="mt-5 h-11 w-full rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
