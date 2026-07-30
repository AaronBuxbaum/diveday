import Link from "next/link";

/**
 * The shared "here's what happened" card for a token-based account flow
 * (invite, verify, password reset) — identical layout in each, differing only
 * in copy and whether a way back to sign-in makes sense.
 */
export function Notice({
  title,
  text,
  backToSignIn,
}: {
  title: string;
  text: string;
  backToSignIn?: string;
}) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted">{text}</p>
        {backToSignIn ? (
          <p className="mt-4 text-sm text-muted">
            <Link href="/sign-in" className="font-medium text-primary hover:underline">
              {backToSignIn}
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
