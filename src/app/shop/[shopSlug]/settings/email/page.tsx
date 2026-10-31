import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { readAfterHoursPingChoice } from "@/db/desk-pings";
import { readWeeklyDigestChoice } from "@/db/weekly-digest";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { deskTimeOn } from "@/lib/desk-hours";
import { formatTime, formatTimeZoneName } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { settingsPaneClass } from "../_components/settings-pane";
import { setAfterHoursPingAction, setWeeklyDigestAction } from "./actions";
import { EmailPreferenceSwitch } from "./EmailPreferenceSwitch";

// `instant = true`: every request-scoped read below sits inside this segment's
// `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/** Static English, like every other staff page's title (issue 1569). */
export const metadata: Metadata = { title: "Email — DiveDay" };

/**
 * **The staffer's own email settings** — the Monday email
 * (`src/lib/weekly-digest.ts`) and the after-hours desk ping
 * (`src/lib/desk-hours.ts`). No `allow` gate, like the calendar feeds: what
 * lands in a person's own inbox is theirs to decide, not shop policy, and the
 * email itself holds counts and links into pages that gate themselves.
 */
export default async function EmailSettingsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const choice = await readWeeklyDigestChoice(db, {
    shopId: shop.id,
    personId: session.user.personId,
  });
  const wanted = choice?.wanted ?? false;
  const afterHours = await readAfterHoursPingChoice(db, {
    shopId: shop.id,
    personId: session.user.personId,
  });
  const pinged = afterHours?.wanted ?? false;
  const now = nowDate();
  const deskTime = (minute: number) =>
    formatTime(deskTimeOn(minute, now, shop.timezone), locale, shop.timezone);

  return (
    <main className={settingsPaneClass()}>
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={shopPath(shop.slug, "settings")}
        title={t("emailSettings.title")}
      />
      <div className="space-y-10">
        <SectionCard aria-label={t("emailSettings.digest.heading")}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            <h2 className={SECTION_TITLE_CLASS}>{t("emailSettings.digest.heading")}</h2>
            <EmailPreferenceSwitch
              wanted={wanted}
              label={t("emailSettings.digest.heading")}
              saving={t("emailSettings.digest.saving")}
              failed={t("emailSettings.saveFailed")}
              save={setWeeklyDigestAction.bind(null, shop.slug)}
            />
          </div>
          <p className="mt-2 text-sm text-muted">
            {t("emailSettings.digest.description", {
              zone: formatTimeZoneName(locale, shop.timezone),
            })}
          </p>
          <a
            href={shopPath(shop.slug, "settings", "email", "preview")}
            target="_blank"
            rel="noopener"
            className={buttonClass({ variant: "link", flush: true, className: "mt-3" })}
          >
            {t("emailSettings.digest.preview")}
          </a>
        </SectionCard>
        <SectionCard aria-label={t("emailSettings.afterHours.heading")}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            <h2 className={SECTION_TITLE_CLASS}>{t("emailSettings.afterHours.heading")}</h2>
            <EmailPreferenceSwitch
              wanted={pinged}
              label={t("emailSettings.afterHours.heading")}
              saving={t("emailSettings.digest.saving")}
              failed={t("emailSettings.saveFailed")}
              save={setAfterHoursPingAction.bind(null, shop.slug)}
            />
          </div>
          <p className="mt-2 text-sm text-muted">
            {t("emailSettings.afterHours.description", {
              opens: deskTime(shop.deskOpensMinute),
              closes: deskTime(shop.deskClosesMinute),
              zone: formatTimeZoneName(locale, shop.timezone),
            })}
          </p>
        </SectionCard>
      </div>
    </main>
  );
}
