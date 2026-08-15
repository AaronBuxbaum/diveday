import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PrintButton } from "@/components/PrintButton";
import { ShopStat } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { getTripCrewIds, getTripWithBooked, listStaff } from "@/db/trips";
import { rentalItemLabel, statedSizesText } from "@/i18n/rental-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { buildDivePrepChecklist, UNSIZED_ITEM_KINDS } from "@/lib/dive-prep";
import { cachedListFormat } from "@/lib/intl-cache";
import { shopOffersNitrox } from "@/lib/rentals";
import { requireStaffSession } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { TripCapacityBadge, TripPageHeader } from "../_components/TripPageHeader";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Trip prep — DiveDay",
};

/**
 * The morning packing list. Everything on this page is derived from the
 * roster's rental fits and the trip's dive plan — nothing here reserves an
 * item, because the shop tracks no inventory. It is a page to work down with
 * your hands full, so it prints, and the two ways it can be wrong (a missing
 * fit, an unverified nitrox card) are stated at the top rather than buried.
 */
export default async function TripPrepPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();

  const [divers, staff, crewIds] = await Promise.all([
    listTripPrepDivers(db, shop.id, tripId),
    listStaff(db, shop.id),
    getTripCrewIds(db, shop.id, tripId),
  ]);
  // Only the crew who actually dive the trip need their own tank — a captain
  // or deckhand assigned for the boat stays dry and is not part of the plan.
  const divingCrew = staff
    .filter(
      (entry) =>
        crewIds.includes(entry.person.id) &&
        (entry.roles.includes("instructor") || entry.roles.includes("divemaster")),
    )
    .map((entry) => entry.person.fullName);
  const checklist = buildDivePrepChecklist({
    divers,
    plannedDives: trip.plannedDives,
    divingCrew,
    // The shop's own catalog, so "this diver is missing a size" is only ever
    // said about gear this shop still hands over (src/lib/rentals.ts).
    offeredKinds: shop.rentalItems,
  });
  /**
   * The size a staffer pulls, or the honest reason there isn't one. Shared by
   * the phone cards and the table so the two can never drift into telling the
   * boat different things about the same line.
   */
  const sizeCell = (line: (typeof checklist.lines)[number]) => {
    // The count is real; the size deliberately isn't.
    if (line.fitAtCheckIn) {
      return <span className="font-medium text-warning">{t("trips.prep.fitAtCheckIn")}</span>;
    }
    if (line.size) return line.size;
    // An item with no size to record reads as a dash; one that should have had
    // a size and doesn't says so, because those are different problems.
    return UNSIZED_ITEM_KINDS.includes(line.kind) ? (
      <span className="text-muted">—</span>
    ) : (
      <span className="text-muted">{t("trips.prep.notRecorded")}</span>
    );
  };
  // A shop that has never offered nitrox can never have live nitrox data here
  // (setBookingNitrox fails closed), so this is purely cosmetic for that
  // common case — but a shop that *disabled* nitrox after a diver requested
  // it (with or without a verified card) must not have this trip's already-
  // real tank split or blocker silently disappear out from under the crew.
  // An empty packing table means one of two different things, and the rental-kit
  // empty state says which rather than making the crew scroll back up to guess.
  const needsSorting =
    checklist.diversWithIncompleteFit.length > 0 || checklist.diversNeedingStaffFit.length > 0;
  const showNitrox =
    shopOffersNitrox(shop.rentalItems) ||
    checklist.tanks.nitrox > 0 ||
    checklist.nitroxBlockers.length > 0;

  return (
    <>
      <TripPageHeader
        title={trip.title}
        startsAt={trip.startsAt}
        endsAt={trip.endsAt}
        locale={locale}
        timeZone={shop.timezone}
        badge={
          <TripCapacityBadge trip={trip} cancelledLabel={t("trips.detail.cancelledBadge")} t={t} />
        }
        description={[
          t("trips.prep.diverCount", { count: checklist.diverCount }),
          checklist.crewCount > 0
            ? t("trips.prep.crewCount", { count: checklist.crewCount })
            : null,
          t("trips.prep.diveCount", { count: checklist.diveCount }),
          t("trips.prep.oneTankPerDiver"),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={<PrintButton label={t("shared.printButton.label")} />}
      />

      {checklist.diverCount === 0 && checklist.crewCount === 0 ? (
        // The whole page's content region, so this one wears an h2 — and the
        // packing list can only become real once someone is on the boat, which
        // happens on the Guests tab.
        <EmptyState>
          <h2 className="font-medium">{t("trips.prep.emptyHeading")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("trips.prep.noDivers")}</p>
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}/guests`}
            className={buttonClass({ className: "mt-4" })}
          >
            {t("trips.prep.emptyAction")}
          </Link>
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="tanks-heading">
            <h2 id="tanks-heading" className="text-lg font-semibold">
              {t("trips.prep.tanksHeading")}
            </h2>
            <div className={`mt-3 grid gap-3 ${showNitrox ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
              {showNitrox ? (
                <>
                  <ShopStat label={t("trips.prep.total")} value={checklist.tanks.total} />
                  <ShopStat label={t("trips.prep.air")} value={checklist.tanks.air} />
                  <ShopStat label={t("trips.prep.nitrox")} value={checklist.tanks.nitrox} />
                </>
              ) : (
                // Air and total are the same number with no nitrox split to draw,
                // so there's nothing for a second tile to distinguish.
                <ShopStat label={t("trips.prep.total")} value={checklist.tanks.total} />
              )}
            </div>
            <p className="mt-2 text-sm text-muted">
              {checklist.crewCount > 0
                ? t("trips.prep.includesCrew", { count: checklist.crewCount })
                : t("trips.prep.diversOnlyNote")}{" "}
              {t("trips.prep.noGasAnalysisNote")}
            </p>
          </section>

          {showNitrox && checklist.nitroxBlockers.length > 0 ? (
            <section
              aria-labelledby="nitrox-blocked-heading"
              // Warning tone, canonical geometry: this and its two neighbours
              // below are the same card as everything else on the page, and
              // only the border and fill say which of them is a problem.
              className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-4 shadow-sm sm:p-5"
            >
              <h2 id="nitrox-blocked-heading" className="font-semibold">
                {t("trips.prep.nitroxBlockedHeading")}
              </h2>
              <p className="mt-1 text-sm">{t("trips.prep.nitroxBlockedDescription")}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {checklist.nitroxBlockers.map((blocker) => (
                  <li key={blocker.bookingId}>
                    •{" "}
                    <Link
                      href={`/shop/${shopSlug}/divers/${blocker.personId}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {blocker.fullName}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Two gaps, one section, and each row says which it is. This used to
              be "No rental fit on file", which was true of everyone in it back
              when a fit was counted by the row existing. Now that it is counted
              per item, most of this list is divers somebody *did* ask — and
              telling the packer nobody asked would send them to re-ask a
              question that already has half an answer. */}
          {checklist.diversWithIncompleteFit.length > 0 ? (
            <section
              aria-labelledby="missing-sizes-heading"
              // The `<h2 id>` stays spelled out rather than folding into
              // `SectionCard`'s `title`: `aria-labelledby` needs that id.
              className={sectionCardClass({ className: "mt-6" })}
            >
              <h2 id="missing-sizes-heading" className="font-semibold">
                {t("trips.prep.missingSizesHeading")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("trips.prep.missingSizesDescription")}</p>
              {/* Two different situations, said differently: a diver with
                  *some* sizes on file keeps a row naming exactly what's
                  missing, while the never-asked share one sentence said once
                  above their names — the old list repeated "nothing on file;
                  they may be bringing their own kit…" per row, the same clause
                  chanted seven times (principle 9). */}
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {checklist.diversWithIncompleteFit
                  .filter((diver) => diver.state !== "not_recorded")
                  .map((diver) => (
                    <li key={diver.personId}>
                      •{" "}
                      <Link
                        href={`/shop/${shopSlug}/divers/${diver.personId}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {diver.fullName}
                      </Link>{" "}
                      <span className="text-muted">
                        {t("trips.prep.missingSizesItems", {
                          items: cachedListFormat(locale, {
                            style: "long",
                            type: "conjunction",
                          }).format(diver.missing.map((kind) => rentalItemLabel(t, kind))),
                        })}
                      </span>
                    </li>
                  ))}
              </ul>
              {checklist.diversWithIncompleteFit.some((diver) => diver.state === "not_recorded") ? (
                <div className="mt-3 text-sm">
                  <p className="text-muted">{t("trips.prep.missingSizesNobodyAskedLead")}</p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {checklist.diversWithIncompleteFit
                      .filter((diver) => diver.state === "not_recorded")
                      .map((diver) => (
                        <li key={diver.personId}>
                          <Link
                            href={`/shop/${shopSlug}/divers/${diver.personId}`}
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {diver.fullName}
                          </Link>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {checklist.diversNeedingStaffFit.length > 0 ? (
            <section
              aria-labelledby="staff-fit-heading"
              className="mt-6 rounded-2xl border border-warning/40 bg-warning/5 p-4 shadow-sm sm:p-5"
            >
              <h2 id="staff-fit-heading" className="font-semibold">
                {t("trips.prep.staffFitHeading")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("trips.prep.staffFitDescription")}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {checklist.diversNeedingStaffFit.map((diver) => (
                  <li key={diver.personId}>
                    •{" "}
                    <Link
                      href={`/shop/${shopSlug}/divers/${diver.personId}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {diver.fullName}
                    </Link>
                    {diver.note ? <span className="text-muted"> — {diver.note}</span> : null}
                    {/* What they asked for. The captain doing the fit can't edit
                        the profile and sees no size on the packing line, so
                        without this there is nothing to bring a range around. */}
                    {diver.statedSizes.length > 0 ? (
                      <span className="text-muted">
                        {" "}
                        {t("trips.prep.askedFor", {
                          sizes: statedSizesText(t, locale, diver.statedSizes),
                        })}
                      </span>
                    ) : (
                      <span className="text-muted"> {t("trips.prep.noSizesOnFile")}</span>
                    )}
                    {/* How old the flag is: a shortage is about one day, so a
                        months-old flag is a prompt to re-ask, not to trust. */}
                    <span className="text-muted">
                      {" "}
                      {t("trips.prep.flaggedAgo", {
                        when:
                          diver.flaggedDaysAgo === 0
                            ? t("trips.prep.today")
                            : diver.flaggedDaysAgo === 1
                              ? t("trips.prep.yesterday")
                              : t("trips.prep.daysAgo", { count: diver.flaggedDaysAgo }),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="kit-heading" className="mt-8">
            <h2 id="kit-heading" className="text-lg font-semibold">
              {t("trips.prep.rentalKitHeading")}
            </h2>
            {checklist.lines.length === 0 ? (
              // A section inside a larger page, so h3. Two honest readings of
              // the same empty table — a genuine nothing-to-do, or fits that
              // were never recorded — and the Guests tab is where a fit gets
              // put on file either way.
              <EmptyState className="mt-3">
                <h3 className="font-medium">
                  {needsSorting
                    ? t("trips.prep.rentalKitEmptyNeedsSortingHeading")
                    : t("trips.prep.rentalKitEmptyOwnKitHeading")}
                </h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                  {needsSorting
                    ? t("trips.prep.nothingToPullNeedsSorting")
                    : t("trips.prep.nothingToPullOwnKit")}
                </p>
                <Link
                  href={`/shop/${shopSlug}/trips/${tripId}/guests`}
                  className={buttonClass({
                    variant: "secondary",
                    size: "sm",
                    className: "mt-4",
                  })}
                >
                  {t("trips.prep.rentalKitEmptyAction")}
                </Link>
              </EmptyState>
            ) : (
              <>
                {/* Phone: stacked cards. Four columns at 390px put a
                    comma-joined diver list against three other columns and the
                    names win — the item, size, and count a staffer is actually
                    pulling gear by get squeezed to a character or two. Same
                    split as the roster (`DiverList`): cards under `sm`, the
                    table above. `print:` pins each half explicitly so the
                    printed packing list is the table at any paper width, not a
                    breakpoint coincidence. */}
                <ul className="mt-3 flex flex-col gap-3 sm:hidden print:hidden">
                  {checklist.lines.map((line) => (
                    <li
                      key={`${line.kind}:${line.fitAtCheckIn ? " fit" : (line.size ?? "")}`}
                      className={sectionCardClass()}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold">{rentalItemLabel(t, line.kind)}</p>
                        <p className="shrink-0 text-2xl font-semibold tabular-nums">
                          <span className="sr-only">{t("trips.prep.qtyColumn")} </span>
                          {line.count}
                        </p>
                      </div>
                      <dl className="mt-2 flex flex-col gap-1 text-sm">
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-muted">{t("trips.prep.sizeColumn")}</dt>
                          <dd>{sizeCell(line)}</dd>
                        </div>
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-muted">{t("trips.prep.forColumn")}</dt>
                          <dd className="text-muted">{line.divers.join(", ")}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
                {/* The scroll strategy: the 45rem floor is what stops the four
                    columns collapsing between 640px and a real tablet, and the
                    vocabulary's `print:` overrides keep paper out of the
                    scroll rule entirely — an A4 sheet is narrower than the
                    floor, and a clipped column on a packing list is a silent
                    one. */}
                <Table minWidth="45rem" shellClassName="mt-3 hidden sm:block print:block">
                  <THead>
                    <Th>{t("trips.prep.itemColumn")}</Th>
                    <Th>{t("trips.prep.sizeColumn")}</Th>
                    <Th numeric>{t("trips.prep.qtyColumn")}</Th>
                    <Th>{t("trips.prep.forColumn")}</Th>
                  </THead>
                  <TBody>
                    {checklist.lines.map((line) => (
                      <tr key={`${line.kind}:${line.fitAtCheckIn ? " fit" : (line.size ?? "")}`}>
                        <Td className="font-medium">{rentalItemLabel(t, line.kind)}</Td>
                        <Td>{sizeCell(line)}</Td>
                        <Td numeric>{line.count}</Td>
                        <Td muted>{line.divers.join(", ")}</Td>
                      </tr>
                    ))}
                  </TBody>
                </Table>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
