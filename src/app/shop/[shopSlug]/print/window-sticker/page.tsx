import type { Metadata } from "next";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { printSheetSpec, storefrontAddress } from "@/lib/print-sheets";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { PaperSheet, SheetMark } from "../_components/PaperSheet";
import { SheetCode } from "../_components/SheetCode";
import { SheetDocument } from "../_components/SheetDocument";

export const instant = true;

export const metadata: Metadata = {
  title: "Window sticker — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The window sticker** (100 mm square) — ADR 20260908-one-hand, decision 6,
 * lever X.
 *
 * One sentence and the storefront's code, for the door and the boat's console.
 * The smallest sheet in the register and the one with the least on it, which is
 * the point: a person walking past reads a sticker in about a second, and a
 * second sentence would cost the first one its reader. No name on it, ever.
 */
export default async function WindowStickerPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const spec = printSheetSpec("window_sticker");
  const theme = deriveBrandTheme(shop.brandColor ?? DIVEDAY_BRAND_COLOR);
  const origin = publicAppUrl();

  return (
    <SheetDocument
      shopSlug={shopSlug}
      paper={spec.paper}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("print.settings.title")}
      printLabel={t("print.settings.door")}
    >
      <PaperSheet
        paper={spec.paper}
        layout="poster"
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
        foldRight={storefrontAddress(shopSlug, origin)}
      >
        {/* 6mm, in paper millimetres like the code: its quiet zone overhangs
            its box (`SheetCode`), four modules of up to 1.4mm each on a short
            storefront link, and must stay clear of the sentence above. */}
        <div className="flex flex-col items-center gap-[6mm] text-center">
          <p className="font-brand-display text-xl leading-tight font-extrabold">
            {t("print.sheet.sticker.title")}
          </p>
          <SheetCode
            value={`${origin ?? ""}${publicSchedulePath(shopSlug)}`}
            label={t("print.sheet.sticker.title")}
            size={34}
          />
        </div>
      </PaperSheet>
    </SheetDocument>
  );
}
