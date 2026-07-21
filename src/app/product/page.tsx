import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { FrontDeskReadinessFallback } from "@/components/MarketingScreenFallbacks";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
} from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Product — DiveDay",
  description: "The dive-shop operating system for bookings, readiness, trip prep, and the boat.",
};

export default function ProductPage() {
  return (
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              The product
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              Everything the shop needs to make a safe departure feel easy.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
              DiveDay is organized around the trip itself. Every booking, waiver, certification,
              payment, packing decision, and roll-call event stays attached to the people going out
              on the boat.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Before departure
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                One readiness answer, shared everywhere it matters.
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                The front desk sees why a diver is blocked. The captain sees the same answer on the
                manifest. No one has to guess whether a missing waiver or pending card is okay to
                ignore.
              </p>
              <ul className="mt-7 space-y-3 text-sm leading-6 text-muted">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">01</span> The trip and the dive site
                  decide what each diver needs.
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">02</span> If something can&apos;t be
                  verified, DiveDay says so plainly — no silent passes.
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">03</span> Staff fix the problem at
                  the desk, not at the dock.
                </li>
              </ul>
            </div>
            <MarketingMockup
              label="The DiveDay readiness section used by a dive shop's front desk."
              className="shadow-xl shadow-foreground/5"
            >
              <FrontDeskReadinessFallback />
            </MarketingMockup>
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                The full system
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                Built around how a dive shop actually works.
              </h2>
            </div>
            <div className="mt-12">
              <FeatureGroupsGrid columns={2} />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.8fr] lg:items-center">
            <div className="order-2 lg:order-1">
              <CaptainPhoneFrame
                label="A captain using the mobile roll-call view in DiveDay."
                className="mx-auto max-w-sm"
              />
            </div>
            <div className="order-1 lg:order-2">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                At the dock
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                A manifest that stays useful after the signal disappears.
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                The crew gets big phone controls, head counts for every dive, blockers that
                can&apos;t be ignored, a boarding history that keeps every correction, and a print
                view straight from the same manifest.
              </p>
              <p className="mt-5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm leading-6 text-muted">
                The crew saves the manifest to their phone before leaving the dock. Anything marked
                offline stays clearly labeled until DiveDay is back in service and double-checks it
                against the live manifest — nothing is ever quietly overwritten.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Try it as the person doing the work.
              </h2>
              <p className="mt-2 text-muted">
                Start with a seeded shop, then switch into each role.
              </p>
            </div>
            <Link
              href="/onboard"
              className={buttonClass({
                size: "cta",
              })}
            >
              Start a trial
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
