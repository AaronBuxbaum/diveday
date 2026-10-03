import type { Metadata } from "next";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { COUNTER_CARD_PAPER } from "@/lib/print-sheets";
import { publicShopRegisterPath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { PaperSheet, SheetMark } from "../_components/PaperSheet";
import { SheetCode } from "../_components/SheetCode";
import { SheetDocument } from "../_components/SheetDocument";

export const instant = true;

export const metadata: Metadata = {
  title: "Counter card — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The counter card** (issue #1236), on paper: the sign a shop stands on its
 * desk so a walk-in can register from their own phone while they queue.
 *
 * The code carries the shop's public register address and nothing else — the
 * same address Settings shows under "The counter card", which is a public page
 * anyone can open, so the card hands a finder nothing they could not type.
 */
export default async function CounterCardPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const theme = deriveBrandTheme(shop.brandColor ?? DIVEDAY_BRAND_COLOR);
  const registerUrl = `${publicAppUrl() ?? ""}${publicShopRegisterPath(shopSlug)}`;

  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "settings")}
      paper={COUNTER_CARD_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t(STAFF_DESTINATION_LABEL_KEYS.settings)}
      printLabel={t("print.sheet.door")}
    >
      <PaperSheet
        paper={COUNTER_CARD_PAPER}
        tone={{ band: theme.primary, bandInk: theme.primaryForeground }}
        band={
          <>
            <SheetMark name={shop.name} size="sm" />
            <span className="font-brand-display text-xs font-bold">{shop.name}</span>
          </>
        }
        foldLeft={t("print.sheet.printed", {
          date: formatDateWithYear(nowDate(), locale, shop.timezone),
        })}
        foldRight={registerUrl}
      >
        <h1 className="font-brand-display text-xl leading-tight font-extrabold">
          {t("print.sheet.counterCard.heading")}
        </h1>
        <p className="paper-sheet-muted mt-1 text-xs leading-snug">
          {t("print.sheet.counterCard.body")}
        </p>
        <div className="mt-5 flex justify-center">
          <SheetCode value={registerUrl} label={t("print.sheet.counterCard.heading")} size={56} />
        </div>
      </PaperSheet>
    </SheetDocument>
  );
}
