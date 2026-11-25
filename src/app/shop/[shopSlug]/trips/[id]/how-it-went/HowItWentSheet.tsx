import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import type { HowItWent, HowItWentCount, HowItWentMeta } from "@/features/day/how-it-went";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BrandDisplayFontCode } from "@/lib/brand";
import { formatTime, formatWeekday } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { SheetDocument } from "../../../print/_components/SheetDocument";
import { sheetAttribution } from "../../../print/_components/ShopSheet";
import { formatPaperDateTime } from "../_components/DeparturePaperIdentity";
import { PacketSheet } from "../_components/packet/TripPacket";

type Props = {
  page: { meta: HowItWentMeta; recap: HowItWent };
  shop: { name: string; brandColor: string | null; brandDisplayFont: BrandDisplayFontCode | null };
  shopSlug: string;
  tripId: string;
  locale: string;
  t: StaffTranslator;
  printedAt: Date;
  printedBy: string | null;
};

/** The title's own words: which boat, by its weekday and time ("How Saturday's 8:30 AM went"). */
export function howItWentTitle(meta: HowItWentMeta, locale: string, t: StaffTranslator) {
  const startsAt = new Date(meta.tripStartsAt);
  return t("howItWent.title", {
    weekday: formatWeekday(startsAt, locale, meta.timezone),
    time: formatTime(startsAt, locale, meta.timezone),
  });
}

/**
 * **How it went, on one sheet** (src/features/day/how-it-went): the waivers, what
 * was sorted before boarding, and each head count, each line a recorded fact.
 * A sheet on screen and on paper alike, so it prints ink on white
 * (`.claude/rules/print-ink.md`); opened by name, so it does not print itself.
 */
export function HowItWentSheet({
  page,
  shop,
  shopSlug,
  tripId,
  locale,
  t,
  printedAt,
  printedBy,
}: Props) {
  const { meta, recap } = page;
  const time = (iso: string) => formatTime(new Date(iso), locale, meta.timezone);
  const names = (list: readonly string[]) =>
    cachedListFormat(locale, { type: "conjunction" }).format(list);
  const printed = sheetAttribution(
    t,
    formatPaperDateTime(printedAt, locale, meta.timezone),
    printedBy,
  );
  const tripHref = `${shopPath(shopSlug, "trips", tripId)}?phase=wrapped`;
  return (
    <SheetDocument
      backHref={tripHref}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("trips.surfaces.trip")}
      printLabel={t("print.sheet.door")}
      autoPrint={false}
    >
      <PacketSheet
        shop={{ name: meta.shopName, brandColor: shop.brandColor }}
        shopSlug={shopSlug}
        name={t("howItWent.sheetName")}
        printed={printed}
      >
        <div data-how-it-went className="space-y-6">
          <header>
            <h1 className={SHELL_TITLE_CLASS}>{howItWentTitle(meta, locale, t)}</h1>
            <p className="mt-1 text-sm text-muted">
              {[meta.tripTitle, meta.boatName].filter(Boolean).join(" · ")}
            </p>
          </header>

          <section aria-labelledby="how-it-went-counts" className="break-inside-avoid">
            <h2 id="how-it-went-counts" className={SECTION_TITLE_CLASS}>
              {t("howItWent.counts.heading")}
            </h2>
            <ul className="mt-2 divide-y divide-border border-y border-border">
              {recap.counts.map((count) => (
                <CountRow key={count.checkpoint} count={count} time={time} names={names} t={t} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="how-it-went-sorted" className="break-inside-avoid">
            <h2 id="how-it-went-sorted" className={SECTION_TITLE_CLASS}>
              {t("howItWent.sorted.heading")}
            </h2>
            <SortedLines recap={recap} time={time} names={names} t={t} />
          </section>

          <section aria-labelledby="how-it-went-waivers" className="break-inside-avoid">
            <h2 id="how-it-went-waivers" className={SECTION_TITLE_CLASS}>
              {t("howItWent.waivers.heading")}
            </h2>
            <div className="mt-2 space-y-1 text-sm">
              <p>{t("howItWent.waivers.ahead", { count: recap.waivers.ahead })}</p>
              {recap.waivers.onTheDay.length > 0 ? (
                <>
                  <p>{t("howItWent.waivers.onTheDay", { count: recap.waivers.onTheDay.length })}</p>
                  <ul className="ms-4 list-disc">
                    {recap.waivers.onTheDay.map((row) => (
                      <li key={`${row.name}-${row.at}`}>
                        {t(row.paper ? "howItWent.waivers.linePaper" : "howItWent.waivers.line", {
                          name: row.name,
                          time: time(row.at),
                        })}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {recap.waivers.notSigned.length > 0 ? (
                <p className="font-semibold">
                  {t("howItWent.waivers.notSigned", { names: names(recap.waivers.notSigned) })}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </PacketSheet>
    </SheetDocument>
  );
}

function CountRow({
  count,
  time,
  names,
  t,
}: {
  count: HowItWentCount;
  time: (iso: string) => string;
  names: (list: readonly string[]) => string;
  t: StaffTranslator;
}) {
  const label =
    count.dive === 0
      ? t("howItWent.counts.dock")
      : count.site
        ? t("howItWent.counts.afterDiveAt", { dive: count.dive, site: count.site })
        : t("howItWent.counts.afterDive", { dive: count.dive });
  return (
    <li className="py-2 text-sm" data-count={count.checkpoint}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="font-semibold">{label}</span>
        {count.taken ? (
          <span>
            {t("howItWent.counts.aboard", { count: count.aboard, crew: count.crewAboard })}
            {count.at ? (
              <span className="text-muted">
                {" · "}
                {t("howItWent.counts.taken", { time: time(count.at), name: count.by ?? "" })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">{t("howItWent.counts.notTaken")}</span>
        )}
      </div>
      {count.notBack.length > 0 ? (
        <p data-print-critical className="mt-1 font-semibold">
          {t("howItWent.counts.notBack", { names: names(count.notBack) })}
        </p>
      ) : null}
      {count.notRecorded.length > 0 ? (
        <p className="mt-1">
          {t("howItWent.counts.notRecorded", { names: names(count.notRecorded) })}
        </p>
      ) : null}
    </li>
  );
}

function SortedLines({
  recap,
  time,
  names,
  t,
}: {
  recap: HowItWent;
  time: (iso: string) => string;
  names: (list: readonly string[]) => string;
  t: StaffTranslator;
}) {
  const empty =
    recap.sorted.length === 0 &&
    recap.turnedAway.length === 0 &&
    recap.aboardWithOpenItems.length === 0;
  if (empty) return <p className="mt-2 text-sm">{t("howItWent.sorted.empty")}</p>;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {recap.sorted.map((row) => (
        <li key={row.name}>
          {t("howItWent.sorted.line", {
            name: row.name,
            fixes: names(
              row.fixes.map((fix) => t(`howItWent.sorted.fix.${fix.kind}`, { time: time(fix.at) })),
            ),
          })}
        </li>
      ))}
      {recap.turnedAway.map((row) => (
        <li key={`away-${row.name}`}>
          {t("howItWent.sorted.turnedAway", { name: row.name, reason: row.reason ?? "other" })}
        </li>
      ))}
      {recap.aboardWithOpenItems.map((row) => (
        <li key={`open-${row.name}`} data-print-critical className="font-semibold">
          {t("howItWent.sorted.aboardOpen", {
            name: row.name,
            blockers: names(row.blockers.map((blocker) => readinessBlockerText(t, blocker))),
          })}
        </li>
      ))}
    </ul>
  );
}
