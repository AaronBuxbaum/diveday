import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { FrontDeskReadinessFallback } from "@/components/MarketingScreenFallbacks";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
} from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Product — booking to head count | DiveDay",
  description:
    "How DiveDay runs a dive shop's day: bookings, waivers, cert checks, trip prep, and a boat manifest that keeps working when the signal doesn't.",
  alternates: { canonical: "/product" },
  openGraph: {
    title: "The DiveDay product — booking to head count",
    description:
      "Bookings, waivers, cert checks, trip prep, and the boat manifest, organized around the trip itself.",
    url: "/product",
  },
};

const notCovered = [
  {
    title: "A retail point of sale",
    detail:
      "Keep the register you have. You can put a retail line on a DiveDay order, but there's no barcode scanner or stock count here — DiveDay runs the water side of the shop.",
  },
  {
    title: "Gear serial numbers",
    detail:
      "DiveDay tracks every diver's sizes and builds the trip's packing list. It doesn't manage individual rigs or service history.",
  },
  {
    title: "A live line to PADI or SSI",
    detail:
      "The agencies don't give shop software a way to plug in, so verification stays honest: staff look the card up with the agency and mark it verified themselves.",
  },
] as const;

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
              Everything from the first booking to the last head count.
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
          <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
            <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
              <div>
                <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                  After the boat is back
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                  The day ends with a recap divers want to share.
                </h2>
                <p className="mt-5 text-lg leading-8 text-muted">
                  The paperwork is DiveDay&apos;s job; the memory is the diver&apos;s. The night
                  before, every diver gets a plain-language brief — dock time, conditions on the
                  water, what to bring, who to text. After the trip, each diver gets their own recap
                  page to keep and share.
                </p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-background p-5 sm:p-6">
                  <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                    The night before
                  </p>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    A brief in plain words, not a form letter: when to be at the dock, what the
                    water looks like, what to pack, and who to text if something changes — written
                    gently enough for someone's first boat dive.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-background p-5 sm:p-6">
                  <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                    After the trip
                  </p>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    A recap page of the sites they dived, a shout-out from the crew, and room for
                    their own photos — with a nudge to bring a buddy next time. Divers share it; the
                    shop gets remembered.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              An honest no
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              What DiveDay doesn&apos;t do.
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted">
              You&apos;re sizing up a vendor you&apos;ve never heard of; the least we can do is draw
              our own boundaries before you find them.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {notCovered.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-border bg-surface p-5 sm:p-6"
              >
                <h3 className="font-semibold leading-6">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Try it as the person doing the work.
              </h2>
              <p className="mt-2 text-muted">
                Walk the live demo as the owner, the captain, or a diver — then start a trial shop
                of your own.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction}>
                <input type="hidden" name="source" value="product" />
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
