import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/ledger";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { isRehearsalTrip, rehearsalsWithEvidence } from "@/db/rehearsals";
import { shopBySlugCached } from "@/db/shops-cached";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { REHEARSAL_KEPT_DAYS } from "@/lib/rehearsal-clearing";

/**
 * **This departure is a rehearsal** (ADR 20261012-rehearsal-departures), said
 * above every trip surface — Trip, Manifest and Prep — so nobody running the
 * training day mistakes it for the real boat, and nobody running the real boat
 * mistakes it for practice.
 *
 * Rendered by the trip layout, under the staff layout that has already matched
 * the session to this slug; the departure is read inside that shop only.
 * Renders nothing for an ordinary departure. A rehearsal that carries real
 * evidence (`rehearsalsWithEvidence`) says it is kept: the nightly delete
 * leaves it, and the banner is where the shop learns why it is still here.
 */
export async function RehearsalBanner({ shopSlug, tripId }: { shopSlug: string; tripId: string }) {
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return null;
  const db = await getDb();
  if (!(await isRehearsalTrip(db, shop.id, tripId))) return null;
  const kept = (await rehearsalsWithEvidence(db, [tripId])).has(tripId);
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  return (
    <section
      data-rehearsal-banner
      aria-labelledby="rehearsal-banner-title"
      className={`mb-6 ${TONE_PANEL_CLASS} border-warning/50 bg-warning-tint`}
    >
      <p className={groupLabelClass("warning")}>{t("trips.rehearsal.label")}</p>
      <h2 id="rehearsal-banner-title" className={`mt-1 ${SUB_TITLE_CLASS}`}>
        {t("trips.rehearsal.title")}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {t("trips.rehearsal.body", { days: REHEARSAL_KEPT_DAYS })}
      </p>
      {kept ? (
        <p data-rehearsal-kept className="mt-1 text-sm font-medium">
          {t("trips.rehearsal.kept")}
        </p>
      ) : null}
    </section>
  );
}
