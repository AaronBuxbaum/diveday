import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { earlyAccessPrice, productFeatureGroups } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Pricing — Scuba",
  description:
    "Straightforward early-access pricing for Scuba's complete dive-shop operating system.",
};

const faq = [
  {
    question: "What is included?",
    answer:
      "The founding-shop price covers every currently available Scuba workflow, from public bookings through the offline-ready boat manifest. It is not a collection of separate per-feature add-ons.",
  },
  {
    question: "Can I see it before I commit?",
    answer:
      "Yes. Start a seeded trial shop or open the live demo and switch between shop-owner, instructor, divemaster, captain, and diver perspectives.",
  },
  {
    question: "What about multiple locations?",
    answer:
      "Each Scuba workspace is a shop today. Multi-location operating views are future work, so we will scope that with you instead of implying it is already available.",
  },
  {
    question: "Does the manifest work offline?",
    answer:
      "Yes. Staff explicitly saves an encrypted device copy before leaving service. Departure and after-dive roll calls work from that copy, show freshness and pending changes, and reconcile against live safety data when service returns.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Pricing</p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              One shop price. Every operational workflow.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
              Simple early-access pricing for the complete Scuba system — without turning the
              essential safety workflow into a stack of add-ons.
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
              className="mt-8 block min-h-11 rounded-lg bg-primary px-5 py-3 text-center font-semibold text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              Start a trial shop
            </Link>
          </div>
          <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-6 text-muted">
            External-provider charges, such as payment processing, remain between you and that
            provider. We will make any new integration cost explicit before it is enabled.
          </p>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Included now
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                Everything needed to run the current Scuba workflow.
              </h2>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {productFeatureGroups.map((group) => (
                <article
                  key={group.eyebrow}
                  className="rounded-xl border border-border bg-background p-5"
                >
                  <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                    {group.eyebrow}
                  </p>
                  <h3 className="mt-2 font-semibold">{group.title}</h3>
                  <ul className="mt-4 space-y-2 text-sm leading-6 text-muted">
                    {group.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span className="text-primary">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-20 lg:py-24">
          <p className="text-center text-sm font-semibold tracking-widest text-primary uppercase">
            Questions, answered plainly
          </p>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-surface">
            {faq.map((item) => (
              <article key={item.question} className="p-6">
                <h2 className="text-lg font-semibold">{item.question}</h2>
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
