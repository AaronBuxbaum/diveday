import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";

export const metadata: Metadata = {
  title: "Switching to DiveDay — migration guides",
  description:
    "Leaving EVE, DiveShop360, DiveAdmin, or Smartwaiver? Step-by-step guides to export your data and bring your divers, cards, and sizes into DiveDay — with an honest account of what comes across.",
};

export default function SwitchHubPage() {
  return (
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              Switching to DiveDay
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              The door swings both ways.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
              Most shops stay on software they've outgrown because leaving looks painful. These
              guides make the move concrete: how to export your own data from your current system,
              exactly what comes across into DiveDay, and what — honestly — stays behind.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
          <div className="grid gap-5 md:grid-cols-2">
            {MIGRATION_GUIDES.map((guide) => (
              <Link
                key={guide.slug}
                href={`/switching/${guide.slug}`}
                className="group flex flex-col rounded-2xl border border-border bg-surface p-6 transition-colors duration-200 hover:border-border-strong sm:p-7"
              >
                <h2 className="text-xl font-semibold tracking-tight">
                  Switching from {guide.competitor}
                </h2>
                <p className="mt-3 flex-1 leading-7 text-muted">{guide.cardSummary}</p>
                <span className="mt-5 text-sm font-semibold text-primary group-hover:underline">
                  Read the guide →
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Don't see your system?</h2>
              <p className="mt-2 max-w-xl text-muted">
                Most exports import as-is — a spreadsheet of your divers with recognizable name,
                card, and size columns is all it takes. Try the live demo, or start a trial and
                bring a CSV: DiveDay maps the common column names, previews the file, and flags
                anything it doesn't recognize before saving.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction}>
                <input type="hidden" name="source" value="switching-hub" />
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
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
