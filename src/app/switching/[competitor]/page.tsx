import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { SwitchingImportCta } from "@/components/SwitchingImportCta";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { guideSource, trialHref } from "@/lib/funnel";
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
  const title = `${guide.metaTitle} — DiveDay`;
  return {
    title,
    description: guide.metaDescription,
    alternates: { canonical: `/switching/${guide.slug}` },
    openGraph: {
      title,
      description: guide.metaDescription,
      url: `/switching/${guide.slug}`,
    },
  };
}

export default async function MigrationGuidePage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  const { competitor } = await params;
  const guide = getMigrationGuide(competitor);
  if (!guide) notFound();
  const t = diverTranslator(await requestLocale());

  const scopeChip: Record<
    (typeof IMPORT_HONESTY_TABLE)[number]["scope"],
    { label: string; className: string }
  > = {
    included: {
      label: t("switching.competitor.comesAcross"),
      className: "bg-success/10 text-success",
    },
    "stays-behind": {
      label: t("switching.competitor.staysBehind"),
      className: "bg-surface-sunken text-muted",
    },
  };

  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
            <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
              {t("switching.competitor.backToGuides")}
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

        {/* Coexist framing: for a booking channel a shop keeps (FareHarbor),
            the "keep the storefront, we run the water" division of labor, plus
            the honest alternative of leaving. Absent for the leave-it guides. */}
        {guide.coexist && (
          <section className="border-y border-border">
            <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("switching.competitor.keepOrLeaveEyebrow")}
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {guide.coexist.heading}
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{guide.coexist.intro}</p>

              <ul className="mt-10 grid gap-5 sm:grid-cols-2">
                {guide.coexist.runsInDiveDay.map((item) => (
                  <li key={item.title} className="rounded-2xl border border-border bg-surface p-6">
                    <h3 className="font-semibold leading-6">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p>
                  </li>
                ))}
              </ul>

              <p className="mt-8 max-w-2xl leading-7 text-muted">{guide.coexist.bridgeNote}</p>

              <div className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-6">
                <h3 className="text-lg font-semibold tracking-tight">
                  {guide.coexist.replace.heading}
                </h3>
                <p className="mt-2 leading-7 text-muted">{guide.coexist.replace.body}</p>
              </div>
            </div>
          </section>
        )}

        {/* Step 1: export from the incumbent (files the shop makes itself). */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("switching.competitor.step1")}
            </p>
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
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("switching.competitor.step2")}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("switching.competitor.scopeTableTitle")}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            {t("switching.competitor.scopeTableDescription")}
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
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("switching.competitor.step3")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("switching.competitor.bringFileTitle")}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              {t("switching.competitor.bringFileIntro")}
            </p>
            <ol className="mt-10 space-y-6">
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  1
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">
                    {t("switching.competitor.openSettingsTitle")}
                  </h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    {t("switching.competitor.openSettingsBody")}
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  2
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">
                    {t("switching.competitor.checkPreviewTitle")}
                  </h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    {t("switching.competitor.checkPreviewBody")}
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  3
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">
                    {t("switching.competitor.importReadyTitle")}
                  </h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    {t("switching.competitor.importReadyBody")}
                  </p>
                </div>
              </li>
            </ol>

            {guide.importerNote && (
              <p className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-5 text-sm leading-6 text-muted">
                <span className="font-semibold text-foreground">
                  {t("switching.competitor.forExportPrefix", { competitor: guide.competitor })}{" "}
                </span>
                {guide.importerNote}
              </p>
            )}

            <SwitchingImportCta label={t("switching.competitor.openImportCta")} />
          </div>
        </section>

        {/* What the actual switch looks like — parallel-run, timing, re-import safety. */}
        <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {guide.cutover.heading}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{guide.cutover.intro}</p>

          <ol className="mt-10 space-y-6">
            {guide.cutover.steps.map((step, index) => (
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
        </section>

        {/* The owner-authorized concierge switch offer (shared across /switching). */}
        <SwitchingConcierge />

        <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-16 sm:flex-row sm:items-center lg:py-20">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {guide.coexist
                ? t("switching.competitor.runTheDay", { competitor: guide.competitor })
                : t("switching.competitor.readyToMove", { competitor: guide.competitor })}
            </h2>
            <p className="mt-2 max-w-xl text-muted">{t("switching.competitor.walkDemoFirst")}</p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction} className="contents">
                <FunnelTag source={guideSource(competitor)} />
                <SubmitButton
                  pendingLabel={t("switching.competitor.gettingDemoReady")}
                  className={buttonClass({
                    size: "cta",
                    className: "cursor-pointer disabled:opacity-70",
                  })}
                >
                  {t("marketing.common.tryDemo")}
                </SubmitButton>
              </form>
              <Link
                href={trialHref(guideSource(competitor))}
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "border-border-strong",
                })}
              >
                {t("marketing.common.startTrial")}
              </Link>
            </div>
            <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
              {t("switching.competitor.otherGuides")}
            </Link>
          </div>
        </section>

        {guide.sources.length > 0 && (
          <section className="border-t border-border">
            <div className="mx-auto max-w-4xl px-6 py-8">
              <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
                {t("switching.competitor.sources")}
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
