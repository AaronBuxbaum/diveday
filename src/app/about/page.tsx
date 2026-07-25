import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { fullShopExport } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Who we are — DiveDay",
  description:
    "DiveDay is built by one diver who kept watching good shops run the day on a whiteboard and a clipboard. Who you're buying from, what we won't pretend, and how you leave.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "Who we are — DiveDay",
    description:
      "One diver, one product, and a shop day that deserved better software. Who you're buying from, and what we won't pretend.",
    url: "/about",
  },
};

/**
 * The honest-no block, in the register docs/product/marketing.md asks for:
 * concede loudly, because an honest no buys trust the claims can't. These are
 * facts about the company (how new it is, how much it is still moving) rather
 * than product scope — the product's own honest-no lives on /product.
 */
const plainTruths = [
  {
    title: "DiveDay is new.",
    body: "There is no install base to point at and no wall of logos to borrow credibility from. That is exactly why the demo is a real working shop and the export button works on your first day.",
  },
  {
    title: "It doesn't do everything.",
    body: "No retail register, no agency sync, no gear inventory. Those are real jobs done by other software, and pretending otherwise would only waste a season of yours.",
  },
  {
    title: "It's still moving.",
    body: "Early access means the shops using it now are the ones deciding what gets built next. That's the trade: a product that bends toward your season, and one that is still changing while you use it.",
  },
] as const;

export default function AboutPage() {
  return (
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-24">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Who we are
              </p>
              <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl lg:text-6xl">
                Built by a diver who kept watching good shops fight their software.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
                DiveDay is made in Florida by its founder, for the shops he dives with. It is not a
                side product of a bigger company, and there is no roadmap set in a room far away
                from a boat.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Why this exists
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                The dive day was already running on paper.
              </h2>
            </div>
            <div className="max-w-2xl space-y-5 text-lg leading-8 text-muted">
              <p>
                Go behind the counter at almost any dive shop and you find the same thing: a
                whiteboard for tomorrow, a clipboard for the boat, a spreadsheet somebody maintains
                by hand, and two or three apps that don't speak to each other. None of it is
                anyone's fault. The staff are good at their jobs. The tools just never showed up.
              </p>
              <p>
                Software exists for this industry, and most of it is dated at best and actively
                hostile at worst — desktop-bound, slow, built for a back office rather than a wet
                dock. So shops keep the paper, because paper at least never fights back. The cost
                isn't dramatic. It's an hour lost every morning, a diver called twice for the same
                card, and a crew that leaves the dock less sure than they'd like to be.
              </p>
              <p>
                DiveDay started as the stubborn belief that a dive shop deserves software as good as
                the shop is. Not more features — better ones, on a phone, in the sun, with wet
                hands. That is the whole bet, and it's why the product is judged on whether staff
                actually want to open it.
              </p>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                How it's run
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                You can reach the founder.
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                Write in about a bad morning at the counter and you reach the founder — not a queue,
                not a ticket number, not a form that asks you to attach a screenshot before anyone
                reads it. The person who answers is the person who can fix it.
              </p>
              <p className="mt-4 text-lg leading-8 text-muted">
                The pricing works the same way: one flat number, no seats to count, no tier that
                hides the feature you actually need. Nobody here is compensated for selling you
                more, so the pricing page has nothing to hide behind.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/pricing"
                  className={buttonClass({
                    variant: "secondary",
                    className: "border-border-strong",
                  })}
                >
                  See what it costs
                </Link>
                <Link href="/product" className={buttonClass({ variant: "link" })}>
                  See what it does →
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Plainly</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              What we're not going to pretend.
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted">
              You are going to find these out anyway. Better here, before you've moved a season of
              bookings.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {plainTruths.map((truth) => (
              <article
                key={truth.title}
                className="rounded-2xl border border-border bg-surface p-6 sm:p-8"
              >
                <h3 className="text-xl font-semibold tracking-tight">{truth.title}</h3>
                <p className="mt-3 leading-7 text-muted">{truth.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                  Safe to leave
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                  Who you're actually buying from.
                </h2>
                <p className="mt-5 text-lg leading-8 text-muted">
                  Trusting a small vendor with the records that get your divers on a boat is a real
                  decision, so here are the parts of it worth knowing before you make it — including
                  the one that matters most, which is how you'd walk away.
                </p>
                <p className="mt-4 text-lg leading-8 text-muted">
                  {fullShopExport.terms} Coming the other way, a person will sit with your old
                  export or spreadsheet and bring your divers across with you.
                </p>
                <Link
                  href="/switching"
                  className={buttonClass({ variant: "link", className: "mt-4 text-left" })}
                >
                  How switching works, both directions →
                </Link>
              </div>
              <dl className="divide-y divide-border rounded-2xl border border-border bg-background">
                <div className="p-6">
                  <dt className="text-xs font-semibold tracking-widest text-primary uppercase">
                    Who builds it
                  </dt>
                  <dd className="mt-2 leading-7">
                    Aaron Buxbaum, founder — a diver and a software engineer, and the person
                    accountable for every call DiveDay makes.
                  </dd>
                </div>
                <div className="p-6">
                  <dt className="text-xs font-semibold tracking-widest text-primary uppercase">
                    Where your records live
                  </dt>
                  <dd className="mt-2 leading-7">
                    On servers in the United States, and in a download you can take at any time.
                  </dd>
                </div>
                <div className="p-6">
                  <dt className="text-xs font-semibold tracking-widest text-primary uppercase">
                    What you're committing to
                  </dt>
                  <dd className="mt-2 leading-7">
                    Month to month, per location, cancel whenever. No setup fee, no contract to get
                    out of.
                  </dd>
                </div>
                <div className="p-6">
                  <dt className="text-xs font-semibold tracking-widest text-primary uppercase">
                    Who answers you
                  </dt>
                  <dd className="mt-2 leading-7">
                    The founder, directly. Founding shops get that in writing on the pricing page.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-6 py-20 text-center lg:py-28">
          <h2 className="mx-auto max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            The honest way to judge all of this is to go use it.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted">
            No call, no form first. Walk a full sample shop as the owner, the captain, or a diver,
            and decide whether it feels like something your crew would open on a busy morning.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <form action={enterDemoAction}>
                <input type="hidden" name="source" value="about-closing" />
                <SubmitButton
                  pendingLabel="Getting your shop ready…"
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
