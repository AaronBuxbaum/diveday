import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { HomeCTA } from "@/components/HomeCTA";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
  MarketingMomentCard,
  marketingMockups,
} from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

const dailyMoments = [
  {
    role: "For the diver",
    title: "A clear way onto the boat",
    description:
      "A live schedule, a calm booking flow, and one obvious next step instead of a back-and-forth with the shop.",
    mockup: marketingMockups.diverBooking,
  },
  {
    role: "For the front desk",
    title: "One answer to “are they ready?”",
    description:
      "Waiver, certification, site requirements, payment, and rental fit come together before a problem reaches the dock.",
    mockup: marketingMockups.frontDeskReadiness,
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
                DiveDay puts bookings, readiness, trip prep, and the boat manifest in one place — so
                your crew spends less time chasing paperwork and more time taking care of divers.
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
              <CaptainPhoneFrame label="A captain marking divers boarded on DiveDay's mobile roll-call screen." />
              <div className="mx-auto -mt-5 w-[88%] rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
                <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                  At the dock
                </p>
                <p className="mt-1 text-sm font-medium">
                  Roll-call buttons big enough for wet thumbs — with or without signal.
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
              Everyone works from the same day — what the front desk checks in the morning is
              exactly what the captain sees at the dock.
            </p>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-2">
            {dailyMoments.map((moment) => (
              <MarketingMomentCard
                key={moment.role}
                role={moment.role}
                title={moment.title}
                description={moment.description}
              >
                <MarketingMockup label={moment.mockup.label}>
                  {moment.mockup.render()}
                </MarketingMockup>
              </MarketingMomentCard>
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
            <div className="mt-12">
              <FeatureGroupsGrid columns={4} featuresPerGroup={1} />
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
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <form action={enterDemoAction}>
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
            <Link href="/pricing" className="text-sm font-medium text-primary hover:underline">
              View pricing
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
