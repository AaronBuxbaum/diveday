import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LEAD_TITLE_CLASS, MARKETING_EYEBROW_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { type FunnelSource, setUpHref } from "@/lib/funnel";

/**
 * The concierge switch offer, shared by every /switching page (the hub, each
 * incumbent guide, and the spreadsheet guide). It is a human service commitment
 * authorized by the product owner (docs/product/marketing.md, claims policy) —
 * not a product feature — so it is phrased as a person doing the work with you,
 * never as an automated capability, and it never promises a turnaround time.
 *
 * It is deliberately bidirectional: we help you switch **on** DiveDay (bring
 * your data in) and, if it is ever not right for you, **off** it (take your data
 * out) — the "safe to leave" pillar made a hand, not just an export button.
 * Its door is the Get set up form (2026-10-22; it was a `switch@dive.day` mail
 * link), the one way the site asks for a person, tagged per page by `source`
 * so a guide's door arrives with that guide's system already answered.
 *
 * Takes `locale` as a plain prop (rather than reading `requestLocale()`
 * itself) so every caller can render this from inside a `"use cache"` page
 * body — cached scopes cannot call `headers()`-backed functions themselves
 * (see AGENTS.md's `cacheComponents` notes and each `/switching/**` page).
 */

/* The offer's section and panel, spelled once for it and its skeleton. */
const CONCIERGE_SECTION_CLASS = "mx-auto max-w-4xl px-6 py-16 lg:py-20";
const CONCIERGE_PANEL_CLASS = "rounded-panel border border-primary/30 bg-primary/5 p-8 sm:p-10";

export function SwitchingConcierge({
  locale,
  source,
}: {
  locale: DiverLocale;
  /** The page's concierge tag (`switching-<page>-concierge`). */
  source: FunnelSource;
}) {
  const t = diverTranslator(locale);
  return (
    <section className={CONCIERGE_SECTION_CLASS}>
      <div className={CONCIERGE_PANEL_CLASS}>
        <p className={MARKETING_EYEBROW_CLASS}>{t("switching.concierge.eyebrow")}</p>
        <h2 className={`mt-3 ${LEAD_TITLE_CLASS} text-balance sm:text-3xl`}>
          {t("switching.concierge.title")}
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          {t("switching.concierge.description")}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href={setUpHref(source)} className={buttonClass()}>
            {t("marketing.common.getSetUp")}
          </Link>
        </div>
      </div>
    </section>
  );
}
