import { buttonClass } from "@/components/ui/button";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

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
 *
 * Takes `locale` as a plain prop (rather than reading `requestLocale()`
 * itself) so every caller can render this from inside a `"use cache"` page
 * body — cached scopes cannot call `headers()`-backed functions themselves
 * (see AGENTS.md's `cacheComponents` notes and each `/switching/**` page).
 */

/** Where the concierge switch offer routes (product-owner provided). */
export const SWITCH_EMAIL = "switch@dive.day";

export function SwitchingConcierge({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
      <div className="rounded-panel border border-primary/30 bg-primary/5 p-8 sm:p-10">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">
          {t("switching.concierge.eyebrow")}
        </p>
        <h2 className={`mt-3 ${LEAD_TITLE_CLASS} text-balance sm:text-3xl`}>
          {t("switching.concierge.title")}
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          {t("switching.concierge.description")}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href={`mailto:${SWITCH_EMAIL}?subject=Help%20me%20switch`}
            className={buttonClass({ className: "cursor-pointer" })}
          >
            {t("switching.concierge.emailCta", { email: SWITCH_EMAIL })}
          </a>
        </div>
      </div>
    </section>
  );
}
