import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { buttonClass } from "@/components/ui/button";
import { trialHref } from "@/lib/funnel";
import { IMPORT_HONESTY_TABLE } from "@/lib/import";

/**
 * "Coming from a spreadsheet" — the front door for the largest, most
 * under-served pool in the market: shops running the whole day on a spreadsheet
 * (and a clipboard). It sits under /switching with the incumbent guides, but it
 * is deliberately NOT one of them: a spreadsheet is not a vendor to leave, so
 * there is no incumbent to describe, no export click-path to reverse-engineer,
 * and no `sources`. The wedge here is not portability (they were never locked
 * in) — it is the things a spreadsheet cannot do: re-check a card at the dock,
 * run the day's blocker queue, let a diver book and sign without an account.
 *
 * Because that framing diverges from the incumbent template, this is its own
 * static route rather than a `migration-guides.ts` entry; a static segment wins
 * over the sibling `[competitor]` dynamic segment for this exact path. The one
 * shared invariant is honesty: the "what comes across" table renders
 * IMPORT_HONESTY_TABLE verbatim, the same source the importer and every
 * incumbent guide use, so the promise and the running code cannot drift.
 *
 * The concierge switch offer is a service commitment authorized by the product
 * owner (docs/product/marketing.md, claims policy) — not a product feature. It
 * is the shared `SwitchingConcierge` block, routed to the switch@dive.day inbox,
 * so a shop has a real handoff (in and out) on every switching page, not just
 * the self-service importer and export.
 */

export const metadata: Metadata = {
  title: "Move your dive shop off spreadsheets — DiveDay",
  description:
    "Running your dive shop from a spreadsheet? DiveDay reads the sheet you already keep — your divers, their cards, and their sizes — and adds the things a spreadsheet can't: readiness checked at the dock, the day's blocker queue, and booking and waivers your divers do themselves.",
  alternates: { canonical: "/switching/spreadsheet" },
};

const scopeChip: Record<
  (typeof IMPORT_HONESTY_TABLE)[number]["scope"],
  { label: string; className: string }
> = {
  included: { label: "Comes across", className: "bg-success/10 text-success" },
  "stays-behind": { label: "Stays behind", className: "bg-surface-sunken text-muted" },
};

/** The columns that matter, in the owner's words — mirrors what the importer recognizes. */
const COLUMNS_THAT_MATTER: { column: string; detail: string }[] = [
  {
    column: "Name",
    detail:
      "First and last in two columns, or one full-name column — either works. This is the only thing a row truly needs.",
  },
  {
    column: "Email",
    detail:
      "How DiveDay reaches a diver and recognizes a returning one, so a second import updates them instead of making a duplicate. A row without one still comes in as a new diver.",
  },
  { column: "Phone", detail: "Mobile or landline, however you've written it." },
  {
    column: "Emergency contact",
    detail: "A name and a phone number, when you have them, land on the diver's card.",
  },
  {
    column: "Dive insurance",
    detail:
      "However you keep it — a DAN number, a provider name — comes across as written. It's never a gate; it's what the crew wants on hand in an incident.",
  },
  {
    column: "Certification",
    detail:
      "Agency, level, and card number. The card number is what lets a card come across at all — it arrives verified and flagged imported, ready to use, with a one-tap confirm for staff.",
  },
  {
    column: "Refresher due",
    detail:
      "If you track a refresher date on a card, it comes across with it — written however your sheet writes dates (05/04/2030, 4-May-2030, 2030-05-04). A date already past lands as a card that's due, which is the point. A date we can't read lands the card for staff review rather than as verified: we won't guess at a date the boat depends on.",
  },
  {
    column: "Specialty",
    detail:
      "Deep, wreck, night, or drysuit — one cell can name several (“Deep, Wreck”) and each becomes its own card under the diver's agency number. They arrive verified and flagged imported, and the dive that needs one opens once a staffer confirms they've seen that card.",
  },
  {
    column: "Nitrox",
    detail:
      "A yes/no column, plus the nitrox card number if you keep one — the card number is what actually brings it across, imported as a verified nitrox card. The Nitrox fill gives plain air until a staffer confirms they've seen that card.",
  },
  {
    column: "Rental sizes",
    detail: "BCD, wetsuit, boot, and fin — whatever sizes you already track become a fit profile.",
  },
  {
    column: "Past visits",
    detail:
      "Keep a booking log? A date column, plus what you called the trip and what you charged, turns each row into that diver's history here — so a regular arrives as a regular. Repeat the diver's email on each of their rows; that's how the rows find the right person. It's history, not schedule: imported visits never become trips, and a booking you'd written off as cancelled still reads cancelled.",
  },
];

export default function SpreadsheetSwitchPage() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
            <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
              ← All switching guides
            </Link>
            <p className="mt-6 text-sm font-semibold tracking-widest text-primary uppercase">
              Coming from a spreadsheet
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl">
              The spreadsheet got you this far.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
              It won't flag the diver on tomorrow's boat whose card nobody's verified, chase the
              waiver no one signed, or let a diver book their own seat on a Sunday night. DiveDay
              reads the sheet you already keep — your divers, their cards, their sizes — and takes
              the rest off your hands. No system to rip out first; you already have the file.
            </p>
          </div>
        </section>

        {/* The wedge: what a spreadsheet fundamentally can't do. */}
        <section className="mx-auto max-w-4xl px-6 py-14 lg:py-20">
          <div className="max-w-2xl space-y-5">
            <p className="text-lg leading-8 text-muted">
              A spreadsheet is a good memory and a bad teammate. It holds names and numbers, but it
              can't do the work that actually keeps a dive day calm and safe — the part you're doing
              by hand right now, in your head and across a stack of paper.
            </p>
            <p className="text-lg leading-8 text-muted">
              That's the trade DiveDay makes worth it. Not a prettier list — the jobs a list can't
              hold:
            </p>
          </div>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              {
                title: "Every card checked before the boat leaves",
                body: "DiveDay re-reads each diver's certification against what the trip and the site require, and the ones who can't board yet surface on their own — no scanning a column and hoping.",
              },
              {
                title: "The day's blockers in one place",
                body: "One screen shows who still can't board and why — a missing waiver, a card to verify — so nothing is remembered at the dock instead of the desk.",
              },
              {
                title: "Divers book and sign themselves",
                body: "A diver picks a seat and signs the waiver from a link, no account and no app — the signature chase at the dock mostly disappears.",
              },
              {
                title: "A manifest that's a head count, not a printout",
                body: "The captain checks divers off dive by dive on a phone — working from a copy saved to it before the boat leaves, so roll call keeps going when the signal doesn't, then checks itself against the live manifest when service returns.",
              },
            ].map((item) => (
              <li key={item.title} className="rounded-2xl border border-border bg-surface p-6">
                <h3 className="font-semibold leading-6">{item.title}</h3>
                <p className="mt-2 leading-7 text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Step 1: ready the sheet you already have. */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Step 1</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              Does your sheet have these columns?
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              One row per diver, and columns for what you know about them. Your headings don't have
              to match anything — DiveDay recognizes the common names, previews the file, and flags
              anything it doesn't before saving. If you'd rather start from a clean sheet, download
              one that's already in the right shape.
            </p>

            <div className="mt-8">
              <a
                href="/diveday-diver-import-template.csv"
                download
                className={buttonClass({ variant: "secondary", className: "border-border-strong" })}
              >
                Download the starter template (CSV)
              </a>
            </div>

            <ul className="mt-10 divide-y divide-border border-y border-border">
              {COLUMNS_THAT_MATTER.map((row) => (
                <li
                  key={row.column}
                  className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:items-baseline sm:gap-3"
                >
                  <span className="font-medium text-foreground">{row.column}</span>
                  <span className="text-sm leading-6 text-muted">{row.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Step 2: the scope table — the importer's own honesty table, verbatim. */}
        <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">Step 2</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            What comes across — and what doesn't
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            This is the same scope table DiveDay shows before it imports a single row. A card
            already in your sheet was checked by you, so DiveDay trusts it: cards come across
            verified and flagged imported, with a one-tap confirm for staff — and their
            refresher-due dates come with them. A specialty card is the one that waits on that
            confirm before it clears the dive it authorizes. Individual medical answers are never
            reconstructed.
          </p>

          <ul className="mt-8 space-y-2">
            {IMPORT_HONESTY_TABLE.map((row) => (
              <li
                key={row.what}
                className="grid gap-1 rounded-xl border border-border bg-surface px-4 py-3 sm:grid-cols-[11rem_7rem_1fr] sm:items-baseline sm:gap-3"
              >
                <span className="font-medium text-foreground">{row.what}</span>
                <span>
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${scopeChip[row.scope].className}`}
                  >
                    {scopeChip[row.scope].label}
                  </span>
                </span>
                <span className="text-sm leading-6 text-muted">{row.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Step 3: bring the file into DiveDay. */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Step 3</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              Bring the file into DiveDay
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              Save your sheet as CSV, and the rest is in DiveDay and takes minutes.
            </p>
            <ol className="mt-10 space-y-6">
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  1
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">Open Settings → Import contacts</h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    In your DiveDay shop, the owner or manager opens the import page and uploads the
                    CSV.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  2
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">Check the preview</h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    DiveDay maps your columns automatically and previews the file before anything is
                    saved — how each column landed, which cards will come in verified and flagged
                    imported, and anything it's leaving behind, including any row it can't bring
                    across (one with no name, or a repeated email). The rows that pass import when
                    you confirm.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  3
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">Import — your roster is ready</h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    Roster, rental sizes, and cards are ready immediately: cards land verified and
                    flagged imported, so divers are trip-ready from the first booking. Each imported
                    card carries a one-tap confirm on the diver's record for staff to give it a look
                    when they get a moment — no boarding waits on it. The one thing that does wait
                    is a dive that requires a specialty card: that gate opens when a staffer
                    confirms the card, which is one tap on the diver's record.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* The owner-authorized concierge switch offer (shared across /switching). */}
        <SwitchingConcierge />

        <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-16 sm:flex-row sm:items-center lg:py-20">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              See it before you switch a thing.
            </h2>
            <p className="mt-2 max-w-xl text-muted">
              Walk the live demo as the owner, the captain, or a diver — no sign-up, nothing to
              import, just the working shop. Start a trial when it clicks.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction} className="contents">
                <FunnelTag source="switching-spreadsheet" />
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
                href={trialHref("switching-spreadsheet")}
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "border-border-strong",
                })}
              >
                Start a trial
              </Link>
            </div>
            <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
              Switching from other software →
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
