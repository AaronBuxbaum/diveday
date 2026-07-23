import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { enterDemoAction } from "@/app/actions/demo";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { IMPORT_HONESTY_TABLE } from "@/lib/import";
import { getMigrationGuide, MIGRATION_GUIDE_SLUGS } from "@/lib/migration-guides";

// Only the registered guides are valid routes; an unknown competitor 404s.
export const dynamicParams = false;

export function generateStaticParams() {
  return MIGRATION_GUIDE_SLUGS.map((competitor) => ({ competitor }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const { competitor } = await params;
  const guide = getMigrationGuide(competitor);
  if (!guide) return { title: "Switching to DiveDay" };
  return { title: `${guide.metaTitle} — DiveDay`, description: guide.metaDescription };
}

const scopeChip: Record<
  (typeof IMPORT_HONESTY_TABLE)[number]["scope"],
  { label: string; className: string }
> = {
  full: { label: "Imports fully", className: "bg-success/10 text-success" },
  partial: { label: "Partial", className: "bg-warning/15 text-foreground" },
  never: { label: "Never", className: "bg-danger/10 text-danger" },
};

export default async function MigrationGuidePage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  const { competitor } = await params;
  const guide = getMigrationGuide(competitor);
  if (!guide) notFound();

  return (
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
            <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
              ← All switching guides
            </Link>
            <p className="mt-6 text-sm font-semibold tracking-widest text-primary uppercase">
              {guide.heroEyebrow}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl">
              {guide.heroTitle}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">{guide.heroLede}</p>
          </div>
        </section>

        {/* Honest framing of the incumbent. */}
        <section className="mx-auto max-w-4xl px-6 py-14 lg:py-20">
          <div className="max-w-2xl space-y-5">
            {guide.context.map((paragraph) => (
              <p key={paragraph} className="text-lg leading-8 text-muted">
                {paragraph}
              </p>
            ))}
          </div>
        </section>

        {/* Step 1: export from the incumbent (files the shop makes itself). */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Step 1</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {guide.exportHeading}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{guide.exportIntro}</p>

            <ol className="mt-10 space-y-6">
              {guide.exportSteps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="pt-1">
                    <h3 className="font-semibold leading-6">{step.title}</h3>
                    <p className="mt-1.5 leading-7 text-muted">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>

            {guide.exportNotes.length > 0 && (
              <ul className="mt-10 space-y-3 rounded-2xl border border-border bg-background p-6 text-sm leading-6 text-muted">
                {guide.exportNotes.map((note) => (
                  <li key={note} className="flex gap-3">
                    <span aria-hidden className="font-semibold text-primary">
                      •
                    </span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Step 2: the scope table — the importer's own honesty table, verbatim. */}
        <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">Step 2</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            What comes across — and what doesn't
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            This is the same scope table DiveDay shows before it imports a single row. The safety
            spine holds through the move: nothing arrives already verified, and nothing medical
            arrives at all.
          </p>

          <ul className="mt-8 space-y-2">
            {IMPORT_HONESTY_TABLE.map((row) => (
              <li
                key={row.what}
                className="grid gap-1 rounded-xl border border-border bg-surface px-4 py-3 sm:grid-cols-[11rem_7rem_1fr] sm:items-baseline sm:gap-3"
              >
                <span className="font-medium text-foreground">{row.what}</span>
                <span>
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${scopeChip[row.scope].className}`}
                  >
                    {scopeChip[row.scope].label}
                  </span>
                </span>
                <span className="text-sm leading-6 text-muted">{row.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Step 3: bring the file into DiveDay. */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Step 3</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              Bring the file into DiveDay
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              With your export saved, the rest is in DiveDay and takes minutes.
            </p>
            <ol className="mt-10 space-y-6">
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  1
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">Open Settings → Import contacts</h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    In your DiveDay shop, the owner or manager opens the import page and uploads the
                    CSV you exported.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  2
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">Check the preview</h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    DiveDay maps your columns automatically and previews the file before anything is
                    saved — how each column landed, which cards will come in as claims for staff to
                    verify, and anything it's leaving behind. Rows with an email match an existing
                    diver so a re-import updates them instead of duplicating; the whole file imports
                    when you confirm.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  3
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">
                    Import, then verify cards as divers arrive
                  </h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    Your roster and rental sizes are ready immediately. Imported cards wait as
                    unverified claims — your staff confirm each one at first contact, exactly as
                    they would a card entered by hand, so no one boards on evidence no one here has
                    checked.
                  </p>
                </div>
              </li>
            </ol>

            {guide.importerNote && (
              <p className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-5 text-sm leading-6 text-muted">
                <span className="font-semibold text-foreground">
                  For a {guide.competitor} export:{" "}
                </span>
                {guide.importerNote}
              </p>
            )}
          </div>
        </section>

        <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-16 sm:flex-row sm:items-center lg:py-20">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Ready to make the move off {guide.competitor}?
            </h2>
            <p className="mt-2 max-w-xl text-muted">
              Walk the live demo as the owner, the captain, or a diver first — then start a trial
              shop, bring your export, and see your roster land in DiveDay with the safety spine
              intact.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction}>
                <SubmitButton
                  pendingLabel="Getting the demo ready…"
                  className={buttonClass({
                    size: "cta",
                    className: "cursor-pointer disabled:opacity-70",
                  })}
                >
                  Try the live demo
                </SubmitButton>
              </form>
              <Link
                href="/onboard"
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "border-border-strong",
                })}
              >
                Start a trial
              </Link>
            </div>
            <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
              Other switching guides →
            </Link>
          </div>
        </section>

        {guide.sources.length > 0 && (
          <section className="border-t border-border">
            <div className="mx-auto max-w-4xl px-6 py-8">
              <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
                Sources
              </h2>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted">
                {guide.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer nofollow"
                      className="hover:text-foreground hover:underline"
                    >
                      {source.label} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
