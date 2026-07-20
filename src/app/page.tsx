import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { HomeCTA } from "@/components/HomeCTA";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import {
  CaptainRollCallFallback,
  DiverBookingFallback,
  FrontDeskReadinessFallback,
} from "@/components/MarketingScreenFallbacks";
import { MarketingScreenshot } from "@/components/MarketingScreenshot";
import { buttonClass } from "@/components/ui/button";
import { productFeatureGroups } from "@/lib/marketing";

const dailyMoments = [
  {
    role: "For the diver",
    title: "A clear way onto the boat",
    description:
      "A live schedule, a calm booking flow, and one obvious next step instead of a back-and-forth with the shop.",
    shot: "/marketing/diver-booking.png",
    alt: "The live Blue Mantis public schedule with upcoming dive trips and available places.",
    fallback: <DiverBookingFallback />,
  },
  {
    role: "For the front desk",
    title: "One answer to “are they ready?”",
    description:
      "Waiver, certification, site requirements, payment, and gear requests come together before a problem reaches the dock.",
    shot: "/marketing/front-desk-readiness.png",
    alt: "The live trip readiness section showing clear diver-ready and diver-blocked states.",
    fallback: <FrontDeskReadinessFallback />,
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:py-24">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                Calm operations. Safer departures.
              </p>
              <h1 className="mt-5 text-5xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
                Run the whole dive day, from booking to head count.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted sm:text-xl">
                Scuba puts bookings, readiness, gear, and an offline-ready boat manifest in one
                considered system — so your crew can spend less time chasing details and more time
                taking care of divers.
              </p>
              <div className="mt-8">
                <HomeCTA enterDemoAction={enterDemoAction} />
              </div>
              <p className="mt-4 text-sm text-muted">
                Explore a real working shop. Switch between owner, instructor, divemaster, captain,
                and diver views.
              </p>
            </div>

            <div className="mx-auto w-full max-w-sm lg:max-w-md">
              <div className="rounded-[2.5rem] border-[9px] border-foreground bg-foreground p-1.5 shadow-2xl shadow-foreground/15">
                <div className="mx-auto mb-1.5 h-1.5 w-20 rounded-full bg-surface-sunken" />
                <MarketingScreenshot
                  src="/marketing/captain-roll-call.png"
                  alt="A captain using Scuba's real mobile roll-call screen to mark divers boarded."
                  fallback={<CaptainRollCallFallback />}
                  className="rounded-[1.9rem] border-0"
                />
              </div>
              <div className="mx-auto -mt-5 w-[88%] rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
                <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                  At the dock
                </p>
                <p className="mt-1 text-sm font-medium">
                  Big roll-call controls, encrypted offline, for a captain&apos;s phone.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              The daily handoff
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              The right view for the person holding the work.
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted">
              Scuba uses the same operational truth across the shop, so the front desk does not have
              to reconstruct it for the boat crew.
            </p>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-2">
            {dailyMoments.map((moment) => (
              <article
                key={moment.role}
                className="overflow-hidden rounded-2xl border border-border bg-surface"
              >
                <div className="p-6 sm:p-8">
                  <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                    {moment.role}
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-tight">{moment.title}</h3>
                  <p className="mt-3 max-w-lg leading-7 text-muted">{moment.description}</p>
                </div>
                <div className="border-t border-border bg-surface-sunken p-4 sm:p-6">
                  <MarketingScreenshot
                    src={moment.shot}
                    alt={moment.alt}
                    fallback={moment.fallback}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                  One operating system
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                  Every small requirement has a place to land.
                </h2>
              </div>
              <Link
                href="/product"
                className="inline-flex min-h-11 items-center justify-center self-start rounded-lg border border-border-strong px-4 py-2.5 text-sm font-semibold transition-colors duration-200 hover:bg-surface-sunken lg:self-auto"
              >
                See the full product
              </Link>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {productFeatureGroups.map((group) => (
                <article
                  key={group.eyebrow}
                  className="rounded-xl border border-border bg-background p-5"
                >
                  <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                    {group.eyebrow}
                  </p>
                  <h3 className="mt-3 font-semibold leading-6">{group.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">{group.features[0]}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-6 py-20 text-center lg:py-28">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            A better dive day starts here
          </p>
          <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            See how it feels when the whole shop is on the same page.
          </h2>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/onboard"
              className={buttonClass({
                size: "cta",
              })}
            >
              Start a trial
            </Link>
            <Link
              href="/pricing"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-5 py-3 font-semibold transition-colors duration-200 hover:bg-surface-sunken"
            >
              View pricing
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
