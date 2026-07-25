import { buttonClass } from "@/components/ui/button";

/**
 * The concierge switch offer, shared by every /switching page (the hub, each
 * incumbent guide, and the spreadsheet guide). It is a human service commitment
 * authorized by the product owner (docs/product/marketing.md, claims policy) —
 * not a product feature — so it is phrased as a person doing the work with you,
 * never as an automated capability, and it never promises a turnaround time.
 *
 * It is deliberately bidirectional: we help you switch **on** DiveDay (bring
 * your data in) and, if it is ever not right for you, **off** it (take your data
 * out) — the "safe to leave" pillar made a hand, not just an export button. Both
 * route to the same real inbox so a shop has a person to talk to, not just the
 * self-service importer and export.
 */

/** Where the concierge switch offer routes (product-owner provided). */
export const SWITCH_EMAIL = "switch@dive.day";

export function SwitchingConcierge() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-8 sm:p-10">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">
          A person, not a wizard
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          We'll switch you on — and off — ourselves.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Send us what you've got — one clean export or a decade of messy tabs — and one of us maps
          the columns and brings your divers in with you, free, on any plan. And if DiveDay is ever
          not the right fit, the door swings the other way just as personally: your data is yours,
          and we'll help you carry all of it back out. Getting in, and getting out, shouldn't be the
          hard part.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href={`mailto:${SWITCH_EMAIL}?subject=Help%20me%20switch`}
            className={buttonClass({ className: "cursor-pointer" })}
          >
            Email us at {SWITCH_EMAIL}
          </a>
        </div>
      </div>
    </section>
  );
}
