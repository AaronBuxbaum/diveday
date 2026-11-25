import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import type { HowItWent, HowItWentCount, HowItWentMeta } from "@/features/day/how-it-went";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BrandDisplayFontCode } from "@/lib/brand";
import { formatDateWithYear, formatTime, formatTimeZoneName, formatWeekday } from "@/lib/format";
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
  const startsAt = new Date(meta.tripStartsAt);
  const sameDay = (at: Date) =>
    formatDateWithYear(at, locale, meta.timezone) ===
    formatDateWithYear(startsAt, locale, meta.timezone);
  // A time off the departure's first day carries its date, so paper filed
  // later never reads a next-day correction as the same morning.
  const time = (iso: string) => {
    const at = new Date(iso);
    return sameDay(at)
      ? formatTime(at, locale, meta.timezone)
      : formatPaperDateTime(at, locale, meta.timezone);
  };
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
              {[
                meta.tripTitle,
                meta.boatName,
                formatDateWithYear(startsAt, locale, meta.timezone),
                formatTimeZoneName(locale, meta.timezone, startsAt),
              ]
                .filter(Boolean)
                .join(" · ")}
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
            <WaiverLines waivers={recap.waivers} time={time} names={names} t={t} />
          </section>
        </div>
      </PacketSheet>
    </SheetDocument>
  );
}

type Words = {
  time: (iso: string) => string;
  names: (list: readonly string[]) => string;
  t: StaffTranslator;
};

function CountRow({ count, time, names, t }: Words & { count: HowItWentCount }) {
  const label =
    count.dive === 0
      ? t("howItWent.counts.dock")
      : count.site
        ? t("howItWent.counts.afterDiveAt", { dive: count.dive, site: count.site })
        : t("howItWent.counts.afterDive", { dive: count.dive });
  // After a dive, anybody with no result can be somebody still in the water.
  const missing = count.dive > 0 && count.notRecorded.length > 0;
  return (
    <li className="space-y-1 py-2 text-sm" data-count={count.checkpoint}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="font-semibold">{label}</span>
        {count.taken ? (
          <span>
            {t("howItWent.counts.aboard", { divers: count.divers, crew: count.crew })}
            {count.at ? (
              <span className="text-muted">
                {" · "}
                {t("howItWent.counts.lastMark", { time: time(count.at), name: count.by ?? "" })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className={missing ? "font-semibold" : "text-muted"}>
            {t("howItWent.counts.notTaken")}
          </span>
        )}
      </div>
      {count.notBack.length > 0 ? (
        <p data-print-critical className="font-semibold">
          {t("howItWent.counts.notBack", { names: names(count.notBack) })}
        </p>
      ) : null}
      {count.notRecorded.length > 0 ? (
        <p
          data-print-critical={missing ? "" : undefined}
          className={missing ? "font-semibold" : undefined}
        >
          {t("howItWent.counts.notRecorded", { names: names(count.notRecorded) })}
        </p>
      ) : null}
      {count.unsettled.length > 0 ? (
        <p className="font-semibold">
          {t("howItWent.counts.unsettled", { names: names(count.unsettled) })}
        </p>
      ) : null}
      {count.recovered.map((row) => (
        <p key={`${row.name}-${row.notBackAt}`}>
          {t("howItWent.counts.recovered", {
            name: row.name,
            notBack: time(row.notBackAt),
            back: time(row.backAt),
          })}
        </p>
      ))}
      {count.ashore.length > 0 ? (
        <p>{t("howItWent.counts.ashore", { names: names(count.ashore) })}</p>
      ) : null}
    </li>
  );
}

function SortedLines({ recap, time, names, t }: Words & { recap: HowItWent }) {
  const sorted = recap.sorted ?? [];
  const lines = sorted.length + recap.turnedAway.length + recap.boardedBlocked.length;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {recap.sorted === null ? (
        <li>{t("howItWent.sorted.unknown")}</li>
      ) : lines === 0 ? (
        <li>{t("howItWent.sorted.empty")}</li>
      ) : null}
      {sorted.map((row) => (
        <li key={row.name}>
          {t("howItWent.sorted.line", {
            name: row.name,
            fixes: names(
              row.fixes.map((fix) => t(`howItWent.sorted.fix.${fix.kind}`, { time: time(fix.at) })),
            ),
          })}
        </li>
      ))}
      {recap.turnedAway.map((row, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: two divers can share a name and the list is static
          key={`away-${index}-${row.name}`}
          {...(row.thenBoarded && row.reason === "medical" ? { "data-print-critical": true } : {})}
        >
          {t(
            row.thenBoarded
              ? "howItWent.sorted.turnedAwayThenBoarded"
              : "howItWent.sorted.turnedAway",
            {
              name: row.name,
              reason: row.reason ?? "other",
            },
          )}
        </li>
      ))}
      {recap.boardedBlocked.map((row) => (
        <li key={`blocked-${row.name}`} data-print-critical className="font-semibold">
          {t("howItWent.sorted.boardedBlocked", {
            name: row.name,
            dive: row.dive,
            blockers: names(row.blockers.map((blocker) => readinessBlockerText(t, blocker))),
          })}
        </li>
      ))}
    </ul>
  );
}

function WaiverLines({ waivers, time, names, t }: Words & { waivers: HowItWent["waivers"] }) {
  return (
    <div className="mt-2 space-y-1 text-sm">
      <p>{t("howItWent.waivers.ahead", { count: waivers.ahead })}</p>
      {waivers.during.length > 0 ? (
        <>
          <p>{t("howItWent.waivers.onTheDay", { count: waivers.during.length })}</p>
          <ul className="ms-4 list-disc">
            {waivers.during.map((row) => (
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
      {waivers.after.length > 0 ? (
        <p>
          {t("howItWent.waivers.after", {
            list: names(
              waivers.after.map((row) =>
                t("howItWent.waivers.line", { name: row.name, time: time(row.at) }),
              ),
            ),
          })}
        </p>
      ) : null}
      {waivers.doctorDeclined.length > 0 ? (
        <p data-print-critical className="font-semibold">
          {t("howItWent.waivers.doctorDeclined", { names: names(waivers.doctorDeclined) })}
        </p>
      ) : null}
      {waivers.doctorPending.length > 0 ? (
        <p className="font-semibold">
          {t("howItWent.waivers.doctorPending", { names: names(waivers.doctorPending) })}
        </p>
      ) : null}
      {waivers.notSigned.length > 0 ? (
        <p className="font-semibold">
          {t("howItWent.waivers.notSigned", { names: names(waivers.notSigned) })}
        </p>
      ) : null}
      {waivers.held > 0 ? <p>{t("howItWent.waivers.held", { count: waivers.held })}</p> : null}
    </div>
  );
}
