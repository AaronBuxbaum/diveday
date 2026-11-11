import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { COUNTER_CARD_PAPER } from "@/lib/print-sheets";
import { publicShopRegisterPath } from "@/lib/public-routes";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { SheetCode } from "../_components/SheetCode";
import { SheetDocument } from "../_components/SheetDocument";
import { sheetAttribution } from "../_components/ShopSheet";

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
  const { shop, session } = await requireShopSurface(shopSlug);
  // Counter sign-up switched off on Features: no card to print, and no error.
  if (!shop.selfRegistrationEnabled) redirect(shopPath(shopSlug, "settings"));
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
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
        band={
          <>
            <SheetMark name={shop.name} size="sm" />
            <span className="font-brand-display text-xs font-bold">{shop.name}</span>
          </>
        }
        foldLeft={sheetAttribution(
          t,
          formatDateWithYear(nowDate(), locale, shop.timezone),
          session.user.name,
        )}
        foldRight={registerUrl}
      >
        <h1 className="font-brand-display text-xl leading-tight font-extrabold">
          {t("print.sheet.counterCard.heading")}
        </h1>
        <p className="paper-sheet-muted mt-1 text-xs leading-snug">
          {t("print.sheet.counterCard.body")}
        </p>
        {/* `mt-10`, 8.5mm at the print root: the code's quiet zone, four of
            its ~1.7mm modules, overhangs its box (`SheetCode`) and must stay
            clear of the words above it. */}
        <div className="mt-10 flex justify-center">
          <SheetCode value={registerUrl} label={t("print.sheet.counterCard.heading")} size={56} />
        </div>
      </PaperSheet>
    </SheetDocument>
  );
}
