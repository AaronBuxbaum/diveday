import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
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
 * The free personal-import offer is a service commitment authorized by the
 * product owner (docs/product/marketing.md, claims policy) — not a product
 * feature. It routes to the switch@dive.day inbox (IMPORT_EMAIL) so a shop has
 * a real handoff, not just the self-service importer.
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
  full: { label: "Imports fully", className: "bg-success/10 text-success" },
  partial: { label: "Partial", className: "bg-warning/15 text-warning" },
  never: { label: "Never", className: "bg-danger/10 text-danger" },
};

/** Where the free concierge-import offer routes (product-owner provided). */
const IMPORT_EMAIL = "switch@dive.day";

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
    column: "Certification",
    detail:
      "Agency, level, and card number. The card number is what lets a card come across at all — it arrives as a claim your staff verify, never pre-verified.",
  },
  {
    column: "Nitrox",
    detail:
      "A yes/no column, plus the nitrox card number if you keep one — the card number is what actually brings it across. Either way it's a claim, not a fill authorization.",
  },
  {
    column: "Rental sizes",
    detail: "BCD, wetsuit, boot, and fin — whatever sizes you already track become a fit profile.",
  },
];

export default function SpreadsheetSwitchPage() {
  return (
    <div className="flex min-h-full flex-col">
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
            This is the same scope table DiveDay shows before it imports a single row. The safety
            spine holds through the move: nothing arrives already verified, and nothing medical
            arrives at all.
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
                    saved — how each column landed, which cards will come in as claims for staff to
                    verify, and anything it's leaving behind, including any row it can't bring
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
                  <h3 className="font-semibold leading-6">
                    Import, then verify cards as divers arrive
                  </h3>
                  <p className="mt-1.5 leading-7 text-muted">
                    Your roster and rental sizes are ready immediately. Imported cards wait as
                    unverified claims — your staff confirm each one at first contact, exactly as
                    they would a card entered by hand, so no one boards on evidence no one here has
                    checked.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* The owner-authorized free import offer. */}
        <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight">
              Or email us the sheet and we'll do it with you — free.
            </h2>
            <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
              However your spreadsheet looks — one tab or ten, headings that made sense only to you,
              years of rows — you don't have to wrangle it alone. Send it to us as it is and we'll
              map the columns and bring your divers in with you, free, on any plan. It's your data,
              and getting it in shouldn't be the hard part.
            </p>
            <div className="mt-6">
              <a
                href={`mailto:${IMPORT_EMAIL}?subject=Import%20my%20spreadsheet`}
                className={buttonClass({ className: "cursor-pointer" })}
              >
                Email your spreadsheet to {IMPORT_EMAIL}
              </a>
            </div>
          </div>
        </section>

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
                <input type="hidden" name="source" value="switching-spreadsheet" />
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
