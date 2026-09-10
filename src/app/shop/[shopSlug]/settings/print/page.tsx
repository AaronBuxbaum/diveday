import type { Metadata } from "next";
import Link from "next/link";
import { printSheetAction } from "@/app/shop/[shopSlug]/print/actions";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import { canPersonManageShopSettings } from "@/db/authz";
import { listBoats } from "@/db/boats";
import { diveSiteLibrarySize } from "@/db/dive-sites";
import { type PrintRun, printRunKey, printRunsByKey } from "@/db/print-runs";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import type { PrintRunSheetCode } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

export const instant = true;

export const metadata: Metadata = {
  title: "Print — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The Print register** — ADR 20260908-one-hand, decision 6, lever X.
 *
 * The shop's paper, listed in the groups of where the paper goes: at the dock
 * and the door, on the boat, for a diver, on the wall. Each row is the sheet's
 * name, the paper it prints on, one sentence, the day it was last printed and a
 * door.
 *
 * Two rows are deliberately doors to somewhere else. The **paper pass** prints
 * from a booking, so the register names it and points at the counter rather
 * than offering a Print with no diver behind it. The **year poster** is the
 * year card at A2, and the year card is a sibling slice (lever T), so its row
 * opens Reports rather than drawing a poster DiveDay would have to invent.
 *
 * A row for paper this shop cannot print is not drawn: no boats, no boat cards;
 * no sites, no briefing cards. That is the same rule the gear register runs on
 * — opt-in by presence — rather than an empty state explaining an absence a
 * shop already knows about.
 */
export default async function SettingsPrintPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // The hub's own gate: this pane is where a shop decides what its paper says.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const [boats, siteCount, runs] = await Promise.all([
    listBoats(db, shop.id),
    diveSiteLibrarySize(db, shop.id),
    printRunsByKey(db, shop.id),
  ]);

  const printedMeta = (sheet: PrintRunSheetCode, subjectKey = "") => {
    const run: PrintRun | undefined = runs.get(printRunKey(sheet, subjectKey));
    return run
      ? t("print.settings.printed", {
          date: formatShortDate(run.printedAt, locale, shop.timezone),
        })
      : t("print.settings.neverPrinted");
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      <ShopPageHeader
        eyebrow={t("print.settings.eyebrow")}
        eyebrowHref={shopPath(shopSlug, "settings")}
        title={t("print.settings.title")}
        description={t("print.settings.lede")}
      />

      <div className="mt-8 space-y-8">
        <LedgerGroup as="h2" label={t("print.settings.groups.dock")}>
          <SheetRow
            name={t("print.settings.dockSign.name")}
            paper={t("print.settings.dockSign.paper")}
            line={t("print.settings.dockSign.line")}
            meta={printedMeta("dock_sign")}
            door={<PrintDoor shopSlug={shopSlug} sheet="dock_sign" t={t} />}
          />
          <SheetRow
            name={t("print.settings.windowSticker.name")}
            paper={t("print.settings.windowSticker.paper")}
            line={t("print.settings.windowSticker.line")}
            meta={printedMeta("window_sticker")}
            door={<PrintDoor shopSlug={shopSlug} sheet="window_sticker" t={t} />}
          />
        </LedgerGroup>

        {boats.length > 0 || siteCount > 0 ? (
          <LedgerGroup as="h2" label={t("print.settings.groups.boat")}>
            {boats.map((boat) => (
              <SheetRow
                key={boat.id}
                name={t("print.settings.boatCard.name")}
                paper={t("print.settings.boatCard.paper")}
                line={t("print.settings.boatCard.line", { boat: boat.name })}
                meta={printedMeta("boat_card", boat.id)}
                door={<PrintDoor shopSlug={shopSlug} sheet="boat_card" subjectId={boat.id} t={t} />}
              />
            ))}
            {siteCount > 0 ? (
              <SheetRow
                name={t("print.settings.siteBriefing.name")}
                paper={t("print.settings.siteBriefing.paper")}
                line={t("print.settings.siteBriefing.line", { count: siteCount })}
                meta={printedMeta("site_briefing")}
                door={<PrintDoor shopSlug={shopSlug} sheet="site_briefing" t={t} />}
              />
            ) : null}
          </LedgerGroup>
        ) : null}

        <LedgerGroup as="h2" label={t("print.settings.groups.diver")}>
          <SheetRow
            name={t("print.settings.paperPass.name")}
            paper={t("print.settings.paperPass.paper")}
            line={t("print.settings.paperPass.line")}
            meta={printedMeta("paper_pass")}
            door={
              <Link
                href={shopPath(shopSlug, "check-in")}
                className={`${tapTargetLinkClass} text-sm font-medium text-muted`}
              >
                {t("print.settings.counterDoor")}
              </Link>
            }
          />
        </LedgerGroup>

        <LedgerGroup as="h2" label={t("print.settings.groups.wall")}>
          <SheetRow
            name={t("print.settings.yearPoster.name")}
            paper={t("print.settings.yearPoster.paper")}
            line={t("print.settings.yearPoster.line")}
            door={
              <Link
                href={shopPath(shopSlug, "reports")}
                className={`${tapTargetLinkClass} text-sm font-medium text-primary`}
              >
                {t("print.settings.reportsDoor")}
              </Link>
            }
          />
        </LedgerGroup>
      </div>
    </main>
  );
}

/** One sheet: what it is, what it prints on, when it was last printed, its door. */
function SheetRow({
  name,
  paper,
  line,
  meta,
  door,
}: {
  name: string;
  paper: string;
  line: string;
  /**
   * The day this sheet was last printed. Omitted on the one row that has no
   * print run of its own — the year poster opens Reports, and saying so twice
   * on one row is a sentence that earns nothing.
   */
  meta?: string;
  door: React.ReactNode;
}) {
  return (
    <LedgerRow stacked trailing={door}>
      <span className="block truncate font-medium">
        {name} <span className="font-normal text-muted">· {paper}</span>
      </span>
      <span className="mt-0.5 block text-sm text-muted">{meta ? `${line} · ${meta}` : line}</span>
    </LedgerRow>
  );
}

/**
 * The door itself: a form, not a link, because opening a sheet records that the
 * shop printed it — which is the one fact this register exists to hold.
 */
function PrintDoor({
  shopSlug,
  sheet,
  subjectId,
  t,
}: {
  shopSlug: string;
  sheet: PrintRunSheetCode;
  subjectId?: string;
  t: StaffTranslator;
}) {
  return (
    <form action={printSheetAction}>
      <input type="hidden" name="shopSlug" value={shopSlug} />
      <input type="hidden" name="sheet" value={sheet} />
      {subjectId ? <input type="hidden" name="subjectId" value={subjectId} /> : null}
      <SubmitButton
        pendingLabel={t("print.settings.door")}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {t("print.settings.door")}
      </SubmitButton>
    </form>
  );
}
