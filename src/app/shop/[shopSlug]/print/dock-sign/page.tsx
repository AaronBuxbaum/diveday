import type { Metadata } from "next";
import { listBoats } from "@/db/boats";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { printSheetSpec, storefrontAddress } from "@/lib/print-sheets";
import { publicSchedulePath, publicShopRegisterPath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { PaperSheet, SheetMark } from "../_components/PaperSheet";
import { SheetCode } from "../_components/SheetCode";
import { SheetDocument } from "../_components/SheetDocument";

export const instant = true;

export const metadata: Metadata = {
  title: "Dock sign — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The dock sign** (A3) — ADR 20260908-one-hand, decision 6, lever X.
 *
 * The shop's face at the slip, printed once and taped up: the name, where the
 * boats leave from, what each hull is and holds, and two codes. It is the first
 * thing a diver reads about this shop that is not a screen.
 *
 * **No names, ever.** A sign in public says which boats leave from here and how
 * to check in; who is on them is the manifest's business and the manifest is
 * not a public document.
 *
 * The two codes are the only live things on the sheet: the first opens the
 * counter's own self-registration door (the same page the counter's QR card
 * hands out), the second opens the storefront's schedule. Lever U's per-boat
 * follow page is a sibling slice; until it exists the second code goes to the
 * schedule rather than to a URL DiveDay does not serve.
 */
export default async function DockSignPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const boats = await listBoats(db, shop.id);
  const spec = printSheetSpec("dock_sign");
  const theme = deriveBrandTheme(shop.brandColor ?? DIVEDAY_BRAND_COLOR);
  const origin = publicAppUrl();
  const meetingPoint = [shop.addressStreet, shop.addressLocality, shop.addressRegion]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(", ");

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
        tone={{ band: theme.primary, bandInk: theme.primaryForeground }}
        band={
          <>
            <SheetMark name={shop.name} />
            <span className="font-brand-display text-base font-bold">
              {meetingPoint ? `${shop.name} · ${meetingPoint}` : shop.name}
            </span>
          </>
        }
        foldLeft={t("print.sheet.printed", {
          date: formatDateWithYear(nowDate(), locale, shop.timezone),
        })}
        foldRight={storefrontAddress(shopSlug, origin)}
      >
        <h1 className="font-brand-display text-5xl leading-none font-extrabold tracking-tight">
          {t("print.sheet.dockSign.title")}
        </h1>
        {boats.length > 0 ? (
          <ul className="mt-10 space-y-3">
            {boats.map((boat) => (
              <li key={boat.id}>
                {/* diveday:allow-type-ramp: the print ramp is the sheet's own, sized in paper millimetres rather than the app's screen ladder */}
                <p className="font-brand-display text-2xl font-bold">
                  {boat.name}{" "}
                  <span className="paper-sheet-muted text-lg font-normal">
                    · {t("print.sheet.dockSign.capacity", { count: boat.capacity })}
                    {boat.description ? ` · ${boat.description}` : ""}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-12 grid grid-cols-2 gap-8">
          <div>
            <SheetCode
              value={`${origin ?? ""}${publicShopRegisterPath(shopSlug)}`}
              label={t("print.sheet.dockSign.checkIn")}
              className="w-[32mm]"
            />
            {/* diveday:allow-type-ramp: the print ramp is the sheet's own, sized in paper millimetres rather than the app's screen ladder */}
            <p className="font-brand-display mt-3 text-xl font-bold">
              {t("print.sheet.dockSign.checkIn")}
            </p>
            <p className="paper-sheet-muted mt-1 text-sm">
              {t("print.sheet.dockSign.checkInNote", { minutes: shop.dockCallMinutes })}
            </p>
          </div>
          <div>
            <SheetCode
              value={`${origin ?? ""}${publicSchedulePath(shopSlug)}`}
              label={t("print.sheet.dockSign.schedule")}
              className="w-[32mm]"
            />
            {/* diveday:allow-type-ramp: the print ramp is the sheet's own, sized in paper millimetres rather than the app's screen ladder */}
            <p className="font-brand-display mt-3 text-xl font-bold">
              {t("print.sheet.dockSign.schedule")}
            </p>
            <p className="paper-sheet-muted mt-1 text-sm">
              {t("print.sheet.dockSign.scheduleNote")}
            </p>
          </div>
        </div>
        {shop.contactPhone ? (
          <p className="paper-sheet-muted mt-10 text-base">
            {t("print.sheet.dockSign.counter", { phone: shop.contactPhone })}
          </p>
        ) : null}
      </PaperSheet>
    </SheetDocument>
  );
}
