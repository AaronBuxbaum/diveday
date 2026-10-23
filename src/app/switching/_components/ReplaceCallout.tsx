import Link from "next/link";
import { tapTargetLinkClass } from "@/components/ui/button";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";

/**
 * The one link inside the coexist and website callouts: a 44px target
 * (`tapTargetLinkClass`) whose underline thickens on hover. They were 24px
 * `inline-block` words, already underlined, so a hover changed no pixel
 * (K-258). Each sits in a `flex h-6 items-center` line, the 16px text's own
 * 24px, so the target bleeds 10px into the gap above and the callout's
 * padding below and the callout keeps its shape.
 */
export const CALLOUT_LINK_CLASS = `${tapTargetLinkClass} font-medium text-primary underline underline-offset-4 hover:decoration-2`;

/**
 * The coexist band's "or leave it" box: drop the channel and take the booking
 * in DiveDay. Only the pricing test's flat arm shows it (ADR
 * 20261022-pricing-ab-test), because its argument is the incumbent's
 * per-booking fee against a flat price.
 *
 * The one forward link to /pricing on a switching guide, and it
 * belongs here rather than in the closing band. This page has
 * just told a shop owner what the incumbent's per-booking fee
 * costs them; "and yours costs what?" is the next thought, and
 * until now the only answer was the nav tab several thousand
 * pixels up (these guides run 6,000-8,000px). The closing band
 * already carries three controls, so a fourth there would break
 * principles.md #8's one-primary rule.
 *
 * A destination, never a claim: no figure, no "flat price", no
 * savings arithmetic. The price renders only from
 * src/lib/marketing.ts (marketing.md's claims policy), and
 * /pricing already links back here for the fee citation -- this
 * is what closes that loop in the other direction.
 */
export function ReplaceCallout({
  heading,
  body,
  pricingLabel,
}: {
  heading: string;
  body: string;
  pricingLabel: string;
}) {
  return (
    <div className="mt-8 rounded-panel border border-primary/30 bg-primary/5 p-6">
      <h3 className={`${ITEM_TITLE_CLASS} tracking-tight`}>{heading}</h3>
      <p className="mt-2 leading-7 text-muted">{body}</p>
      <p className="mt-4 flex h-6 items-center">
        <Link href="/pricing" className={CALLOUT_LINK_CLASS}>
          {pricingLabel}
        </Link>
      </p>
    </div>
  );
}
