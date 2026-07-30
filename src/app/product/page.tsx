import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
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
import { trialHref } from "@/lib/funnel";
import { productCapabilityIndex } from "@/lib/marketing";

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
      "No agency offers software a way to verify a C-card automatically, so verification stays honest: staff look the card up with the agency and mark it certified themselves.",
  },
] as const;

export default function ProductPage() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              The product
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              From the first booking to the last head count.
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
              <p className="mt-5 rounded-xl border border-border bg-surface-sunken p-4 text-sm leading-6 text-muted">
                The crew saves the manifest to their phone before leaving the dock. Anything marked
                offline stays clearly labeled until DiveDay is back in service and double-checks it
                against the live manifest — nothing is ever quietly overwritten.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Getting paid
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                The money runs through your Stripe account, not ours.
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                Divers pay when they book, or leave a deposit and settle the balance at the dock.
                Staff raise an invoice at the counter for a trip, a course, rentals, nitrox, or a
                retail line. When a diver cancels inside the window you published, the refund goes
                back automatically — and when they don&apos;t, the page says so before they commit
                rather than after.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
                <h3 className="font-semibold leading-6">Your account, your money</h3>
                <p className="mt-3 text-sm leading-6 text-muted">
                  Payouts, disputes, and history stay in the Stripe account you already control.
                  DiveDay never sits between you and the payment — and there is no per-booking cut
                  on top of the flat price.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
                <h3 className="font-semibold leading-6">Priced before they board</h3>
                <p className="mt-3 text-sm leading-6 text-muted">
                  Payment is part of the same readiness answer as the waiver and the card, so
                  &ldquo;are they ready?&rdquo; means all of it. Nobody boards on an assumption that
                  someone else already settled up.
                </p>
              </div>
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
                  <h3 className="mt-3 font-semibold leading-6">
                    A brief in plain words, not a form letter
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    When to be at the dock, what the water looks like, what to pack, and who to text
                    if something changes — written gently enough for someone's first boat dive.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-background p-5 sm:p-6">
                  <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                    After the trip
                  </p>
                  <h3 className="mt-3 font-semibold leading-6">
                    A recap page they&apos;ll want to share
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    The sites they dived, a shout-out from the crew, and room for their own photos —
                    with a nudge to bring a buddy next time. Divers share it; the shop gets
                    remembered.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Everything in the box
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                The whole list, plainly.
              </h2>
              <p className="mt-4 text-lg leading-8 text-muted">
                No tiers, no add-ons, nothing here held back for a bigger plan. Every line is
                something you can go and do in the demo right now — open it in another tab and check
                us on any of them.
              </p>
            </div>
            <div className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
              {productCapabilityIndex.map((group) => (
                <section key={group.area}>
                  <h3 className="text-xs font-semibold tracking-widest text-primary uppercase">
                    {group.area}
                  </h3>
                  <ul className="mt-4 space-y-2.5 text-sm leading-6 text-muted">
                    {group.items.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <span aria-hidden="true" className="font-semibold text-primary">
                          ✓
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
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
              <Link
                href="/switching/spreadsheet"
                className={buttonClass({ variant: "link", className: "mt-3 text-left" })}
              >
                On a spreadsheet today? Bring it across — we'll even do it with you →
              </Link>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction}>
                <FunnelTag source="product" />
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
                href={trialHref("product")}
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
