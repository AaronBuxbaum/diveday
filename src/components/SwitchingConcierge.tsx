import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { LEAD_TITLE_CLASS, MARKETING_EYEBROW_CLASS } from "@/components/ui/typography";
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

/* The offer's section and panel, spelled once for it and its skeleton. */
const CONCIERGE_SECTION_CLASS = "mx-auto max-w-4xl px-6 py-16 lg:py-20";
const CONCIERGE_PANEL_CLASS = "rounded-panel border border-primary/30 bg-primary/5 p-8 sm:p-10";

export function SwitchingConcierge({ locale }: { locale: DiverLocale }) {
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

/**
 * **What the offer paints while a switching page streams** (K-406): its own
 * section and panel, a bar the height of each line its words wrap to, and a
 * 48px bar for the door. The copy is the same on every switching page, so the
 * line counts are this component's: counted in en-US on the switching hub's
 * capture, the eyebrow two 20px lines at 390 and one at 1280, the title two
 * 32px lines and one 36px line, the offer seven 32px lines and three. Nothing
 * in it is a link — a fallback holds shape, never interaction.
 */
export function SwitchingConciergeSkeleton() {
  return (
    <section className={CONCIERGE_SECTION_CLASS}>
      <div className={CONCIERGE_PANEL_CLASS}>
        <div>
          <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-full max-w-xs" />
        </div>
        {/* `LEAD_TITLE_CLASS`'s 32px lines, `sm:text-3xl`'s 36. */}
        <div className="mt-3">
          <SkeletonLineBars
            lines={{ base: 2, sm: 1 }}
            height="h-8 sm:h-9"
            width="w-full max-w-md"
          />
        </div>
        <div className="mt-4">
          <SkeletonLineBars lines={{ base: 7, sm: 3 }} height="h-8" width="w-full max-w-2xl" />
        </div>
        <div className="mt-6 h-12 w-full rounded-lg bg-surface-sunken sm:w-64" />
      </div>
    </section>
  );
}
