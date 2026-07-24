import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { FeatureGroupsGrid } from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { earlyAccessPrice } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Pricing — one flat price per shop | DiveDay",
  description:
    "One flat price for the whole dive shop — bookings, waivers, cert checks, trip prep, and the boat manifest included. No setup fee, no per-seat math, no feature tiers.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "DiveDay pricing — one flat price per shop",
    description:
      "Every workflow DiveDay ships, in one plan. No setup fee, no per-seat math, no feature tiers.",
    url: "/pricing",
  },
};

const faq = [
  {
    question: "What is included?",
    answer:
      "The founding-shop price covers every currently available DiveDay workflow, from public bookings through the offline-ready boat manifest. It is not a collection of separate per-feature add-ons.",
  },
  {
    question: "Can I see it before I commit?",
    answer:
      "Yes. Open the live demo to see the day as the shop owner, an instructor, a divemaster, the captain, or a diver — or start a trial shop of your own, with sample trips ready to explore if you want them.",
  },
  {
    question: "DiveDay is new. What happens to my data if this doesn't work out?",
    answer:
      "You leave with everything, whenever you choose. Settings → Data export downloads one ZIP of plain, documented CSV files — divers, bookings, waiver records, payment history — led by a contacts file shaped for another system's import wizard. No export fee, no support ticket, no minimum stay, and the same download works on the first day of a trial.",
  },
  {
    question: "What does switching to DiveDay actually involve?",
    answer:
      "Export a spreadsheet of customers from your current system, and DiveDay's importer brings in your divers, their certification cards, and their rental sizes — showing you exactly what will happen before anything is saved, and updating an existing diver instead of duplicating them when it recognizes an email. Imported cards arrive as claims for your staff to verify, and medical history never imports at all. Step-by-step guides cover EVE, DiveShop360, DiveAdmin, and Smartwaiver.",
  },
  {
    question: "Does DiveDay connect to PADI or SSI?",
    answer:
      "No — the agencies don't give shop software a way to plug in. DiveDay does the honest version instead: divers photograph their card once, your staff look it up with the agency and mark it verified, and that card stays with the diver for every future booking. Course pages start from PADI and SSI catalog templates that you price and publish yourself.",
  },
  {
    question: "Does DiveDay replace my POS?",
    answer:
      "No — keep your register. DiveDay runs the water side of the shop: bookings, courses, readiness, trip prep, and the boat, with trip and course payments through your shop's own Stripe account. You can put a retail line on a DiveDay order, but there is no register, barcode scanner, or stock count here, and we'd rather say that plainly than pretend.",
  },
  {
    question: "Why be a founding shop?",
    answer:
      "Because early shops steer. Founding shops get a direct line to the people building DiveDay, what your crew runs into shapes what ships next, and every new feature lands in the one plan there is — there are no higher tiers to move things into.",
  },
  {
    question: "What about multiple locations?",
    answer:
      "Each DiveDay workspace runs one shop today. If you operate more than one location, talk to us — we'd rather build that with you than pretend it's already here.",
  },
  {
    question: "Does the manifest work offline?",
    answer:
      "Yes. The crew saves the manifest to their phone before leaving the dock. Departure and after-dive roll calls work from that copy, the screen always shows how fresh it is, and when service returns DiveDay checks every change against the live manifest before it counts.",
  },
] as const;

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faq.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default function PricingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data built from our own constants above and `<`-escaped below.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Pricing</p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              One flat price for the whole shop.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
              No setup fee, no per-seat math, no feature tiers — the safety workflow is never an
              add-on you have to remember to buy.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
          <div className="mx-auto max-w-xl rounded-2xl border-2 border-primary bg-surface p-7 shadow-xl shadow-primary/10 sm:p-9">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                  {earlyAccessPrice.name}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">Complete shop access</h2>
              </div>
              <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-foreground">
                Early access
              </span>
            </div>
            <div className="mt-7 flex items-end gap-2">
              <span className="text-5xl font-semibold tracking-[-0.05em]">
                {earlyAccessPrice.price}
              </span>
              <span className="pb-1 text-sm text-muted">{earlyAccessPrice.cadence}</span>
            </div>
            <p className="mt-4 leading-7 text-muted">{earlyAccessPrice.description}</p>
            <ul className="mt-7 space-y-3 text-sm leading-6 text-muted">
              {earlyAccessPrice.included.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="font-semibold text-primary">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/onboard"
              className={buttonClass({
                size: "cta",
                className: "mt-8 w-full",
              })}
            >
              Start a trial shop
            </Link>
            <form action={enterDemoAction} className="mt-3">
              <input type="hidden" name="source" value="pricing" />
              <SubmitButton
                pendingLabel="Getting the demo ready…"
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "w-full cursor-pointer border-border-strong disabled:opacity-70",
                })}
              >
                Try the live demo first
              </SubmitButton>
            </form>
          </div>
          <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-6 text-muted">
            Payment-processing fees stay between you and your payment provider. If a future
            integration ever costs extra, we&apos;ll say so clearly before you turn it on.
          </p>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Included now
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                Everything needed to run the current DiveDay workflow.
              </h2>
            </div>
            <div className="mt-10">
              <FeatureGroupsGrid columns={2} />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-20 lg:py-24">
          <p className="text-center text-sm font-semibold tracking-widest text-primary uppercase">
            Questions, answered plainly
          </p>
          <h2 className="mt-3 text-center text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            The questions that actually decide it.
          </h2>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-surface">
            {faq.map((item) => (
              <article key={item.question} className="p-6">
                <h3 className="text-lg font-semibold">{item.question}</h3>
                <p className="mt-2 leading-7 text-muted">{item.answer}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
