import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { SubmitButton } from "@/components/SubmitButton";
import { isDemoMode } from "@/lib/demo";

const pillars = [
  {
    title: "Bookings",
    description: "Trips, courses, and charters divers can book in under a minute.",
  },
  {
    title: "Waivers",
    description: "Signed before arrival, stored forever, never printed again.",
  },
  {
    title: "Cert checks",
    description: "Verify agency cards up front so the dock stays drama-free.",
  },
  {
    title: "Gear",
    description: "Sizes, assignments, and service history for every rental item.",
  },
  {
    title: "Boat manifests",
    description: "Who's aboard, who's certified, who's back on the boat.",
  },
];

export default function Home() {
  const demo = isDemoMode();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-12 px-6 py-24">
      <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">Scuba</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Dive shop software that feels like a day on the water
        </h1>
        <p className="max-w-xl text-lg text-muted text-pretty">
          Bookings, waivers, cert checks, gear, and boat manifests — run the whole shop from one
          place that&apos;s a genuine pleasure to use.
        </p>
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
          {demo ? (
            <form action={enterDemoAction}>
              <SubmitButton
                pendingLabel="Spinning up your shop…"
                className="inline-block rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover disabled:opacity-70"
              >
                Try the live demo
              </SubmitButton>
            </form>
          ) : null}
          <Link
            href="/trips"
            className={
              demo
                ? "inline-block rounded-lg border border-border bg-surface px-5 py-3 font-medium transition-colors duration-200 hover:bg-surface-sunken"
                : "inline-block rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            }
          >
            See the demo schedule
          </Link>
        </div>
        {demo ? (
          <p className="text-sm text-muted">
            No signup — you&apos;ll land in a fully-stocked example shop you can reset anytime.
          </p>
        ) : null}
      </div>
      <ul className="grid w-full max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pillars.map((pillar) => (
          <li
            key={pillar.title}
            className="rounded-lg border border-border bg-surface p-5 transition-transform duration-200 hover:-translate-y-0.5"
          >
            <h2 className="font-medium">{pillar.title}</h2>
            <p className="mt-1 text-sm text-muted">{pillar.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
