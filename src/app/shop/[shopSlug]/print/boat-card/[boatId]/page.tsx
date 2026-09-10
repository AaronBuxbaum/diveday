import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBoatById } from "@/db/boats";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import {
  BOAT_CARD_DAY,
  BOAT_CARD_NIGHT,
  boatCardNumbers,
  printSheetSpec,
  storefrontAddress,
} from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { PaperSheet, SheetMark, type SheetTone, SheetValue } from "../../_components/PaperSheet";
import { SheetDocument } from "../../_components/SheetDocument";

export const instant = true;

export const metadata: Metadata = {
  title: "Boat card — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The boat card** (A5 landscape, laminated, one per hull, two sides) — ADR
 * 20260908-one-hand, decision 6, lever X.
 *
 * The card taped to the console. It exists for the minute the app is not there:
 * a flat battery, a dropped phone, no signal at the mooring. So it is the most
 * boring document in the tree on purpose, and three rules hold it:
 *
 * - **The app is the record, and the card says so.** The roll call is where a
 *   head count is kept; this card's own fold line states that, so nobody can
 *   read the paper as a second, quieter register.
 * - **No shop colour, and no photograph.** Nothing that rides a boat wears the
 *   storefront's palette (ADR 20260901-diveday-reimagined, decision 2). The day
 *   side is boat mode's own action colour; the night side is the ground a red
 *   torch reads, so the same card works on a night dive.
 * - **A number DiveDay does not have prints as a blank.** The shop's phone, who
 *   is ashore, and the shop's own emergency lines come off its settings; the
 *   oxygen kit's location and last check have no field in the tree, so they
 *   print as rules for a skipper's marker. A confidently wrong number here
 *   costs the minute it takes to find out (`src/lib/emergency-reference.ts`).
 *
 * **Nothing about a diver is on it.** Not a name, not a count of who is aboard,
 * and no medical fact of any kind: the printed manifest is where the roster
 * lives, and it is the document that already carries what a crew may read.
 */
export default async function BoatCardPage({
  params,
}: {
  params: Promise<{ shopSlug: string; boatId: string }>;
}) {
  const { shopSlug, boatId: rawBoatId } = await params;
  // Narrowed before the read: comparing junk against a `uuid` column raises in
  // Postgres, so without this a mistyped URL is a 500 where a 404 belongs.
  const boatId = uuidParam(rawBoatId);
  if (!boatId) notFound();

  const { db, shop } = await requireShopSurface(shopSlug);
  const boat = await getBoatById(db, shop.id, boatId);
  if (!boat) notFound();

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const spec = printSheetSpec("boat_card");
  const printed = t("print.sheet.boatCard.fold", {
    date: formatDateWithYear(nowDate(), locale, shop.timezone),
  });
  const address = storefrontAddress(shopSlug, publicAppUrl());
  const numbers = boatCardNumbers({
    shopLabel: t("print.sheet.boatCard.shop"),
    shopPhone: shop.contactPhone,
    shoreLabel: t("print.sheet.boatCard.ashore"),
    shoreContact: shop.emergencyReference.shoreContact,
    reference: shop.emergencyReference.lines,
  });

  const side = (tone: SheetTone, sideLabel: string) => (
    <PaperSheet
      paper={spec.paper}
      tone={tone}
      band={
        <>
          <SheetMark name={boat.name} size="sm" />
          <span className="text-sm font-bold tracking-wide">
            {boat.name} · {shop.name}
          </span>
          <span className="ms-auto font-mono text-[0.625rem]">
            {t("print.sheet.boatCard.capacity", { count: boat.capacity })}
          </span>
        </>
      }
      foldLeft={printed}
      foldRight={`${sideLabel} · ${address}`}
    >
      <div className="grid h-full grid-cols-2 gap-6">
        <div>
          {/* diveday:allow-type-ramp: the print ramp is the sheet's own, sized in paper millimetres rather than the app's screen ladder */}
          <h2 className="text-lg font-bold">{t("print.sheet.boatCard.beforeHeading")}</h2>
          <p className="paper-sheet-muted mt-1.5 text-xs leading-snug">
            {t("print.sheet.boatCard.before")}
          </p>
          {/* diveday:allow-type-ramp: the print ramp is the sheet's own, sized in paper millimetres rather than the app's screen ladder */}
          <h2 className="mt-5 text-lg font-bold">{t("print.sheet.boatCard.missingHeading")}</h2>
          <p className="paper-sheet-muted mt-1.5 text-xs leading-snug">
            {t("print.sheet.boatCard.missing")}
          </p>
        </div>
        <div>
          {/* diveday:allow-type-ramp: the print ramp is the sheet's own, sized in paper millimetres rather than the app's screen ladder */}
          <h2 className="text-lg font-bold">{t("print.sheet.boatCard.numbersHeading")}</h2>
          <dl className="paper-sheet-muted mt-1.5 space-y-1 text-xs leading-snug">
            {numbers.map((line) => (
              <div key={line.label} className="flex gap-2">
                <dt className="shrink-0">{line.label}</dt>
                <dd className="min-w-0 flex-1">
                  <SheetValue value={line.value} />
                </dd>
              </div>
            ))}
          </dl>
          {/* diveday:allow-type-ramp: the print ramp is the sheet's own, sized in paper millimetres rather than the app's screen ladder */}
          <h2 className="mt-5 text-lg font-bold">{t("print.sheet.boatCard.oxygenHeading")}</h2>
          <dl className="paper-sheet-muted mt-1.5 space-y-1 text-xs leading-snug">
            <div className="flex gap-2">
              <dt className="shrink-0">{t("print.sheet.boatCard.oxygenWhere")}</dt>
              <dd className="min-w-0 flex-1">
                <SheetValue value={null} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0">{t("print.sheet.boatCard.oxygenChecked")}</dt>
              <dd className="min-w-0 flex-1">
                <SheetValue value={null} />
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </PaperSheet>
  );

  return (
    <SheetDocument
      shopSlug={shopSlug}
      paper={spec.paper}
      // No display face either: a hull's card depends on nothing the storefront
      // chose, so a brand edit can never change what is taped to a console.
      brandDisplayFont={null}
      backLabel={t("print.settings.title")}
      printLabel={t("print.settings.door")}
    >
      {side(BOAT_CARD_DAY, t("print.sheet.boatCard.daySide"))}
      {side(BOAT_CARD_NIGHT, t("print.sheet.boatCard.nightSide"))}
    </SheetDocument>
  );
}
