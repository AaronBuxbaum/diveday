import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
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
        <SectionCard
          title={t("emailSettings.digest.heading")}
          description={t("emailSettings.digest.description", {
            zone: formatTimeZoneName(locale, shop.timezone),
          })}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={wanted ? "success" : "neutral"}>
              {wanted ? t("emailSettings.digest.on") : t("emailSettings.digest.off")}
            </Badge>
            <form action={setWeeklyDigestAction.bind(null, shop.slug, !wanted)}>
              <SubmitButton
                pendingLabel={t("emailSettings.digest.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {wanted ? t("emailSettings.digest.turnOff") : t("emailSettings.digest.turnOn")}
              </SubmitButton>
            </form>
            <a
              href={shopPath(shop.slug, "settings", "email", "preview")}
              target="_blank"
              rel="noopener"
              className={buttonClass({ variant: "ghost" })}
            >
              {t("emailSettings.digest.preview")}
            </a>
          </div>
        </SectionCard>
        <SectionCard
          title={t("emailSettings.afterHours.heading")}
          description={t("emailSettings.afterHours.description", {
            opens: deskTime(shop.deskOpensMinute),
            closes: deskTime(shop.deskClosesMinute),
            zone: formatTimeZoneName(locale, shop.timezone),
          })}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={pinged ? "success" : "neutral"}>
              {pinged ? t("emailSettings.digest.on") : t("emailSettings.digest.off")}
            </Badge>
            <form action={setAfterHoursPingAction.bind(null, shop.slug, !pinged)}>
              <SubmitButton
                pendingLabel={t("emailSettings.digest.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {pinged ? t("emailSettings.digest.turnOff") : t("emailSettings.digest.turnOn")}
              </SubmitButton>
            </form>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
