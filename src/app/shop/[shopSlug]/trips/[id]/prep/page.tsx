import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopStat } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard, sectionCardClass } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatusMark } from "@/components/ui/StatusMark";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { FIGURE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getTripPrep } from "@/db/trips-prep";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { diveRecencyText } from "@/i18n/readiness-labels";
import { rentalItemLabel, statedSizesText } from "@/i18n/rental-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { supportNeedsLines } from "@/i18n/support-needs-labels";
import {
  isPrepGrouping,
  type PrepGrouping,
  type PrepPiece,
  UNSIZED_ITEM_KINDS,
} from "@/lib/dive-prep";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import { groupUnitsForSize } from "@/lib/gear";
import { cachedListFormat } from "@/lib/intl-cache";
import { shopOffersNitrox } from "@/lib/rentals";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { TripCapacityBadge, TripPageHeader } from "../_components/TripPageHeader";
import { TripSurfaceNav } from "../_components/TripSurfaceNav";
import { RentalUnitPicker } from "./_components/RentalUnitPicker";
import { assignGearUnit, releaseGearUnitAction } from "./actions";

/** `?notice=` codes the gear-assignment forms redirect back with. Read through
 * `noticeFromParam`, never a bare index — the param is attacker-supplied. */
const GEAR_NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "gear-assigned": { tone: "success", key: "gear.prep.notice.assigned" },
  "gear-released": { tone: "success", key: "gear.prep.notice.released" },
  "gear-unit-unavailable": { tone: "warning", key: "gear.prep.notice.unitUnavailable" },
  "gear-unit-out-of-service": { tone: "warning", key: "gear.prep.notice.unitOutOfService" },
  "gear-already-checked-out": { tone: "warning", key: "gear.prep.notice.alreadyCheckedOut" },
  "gear-not-found": { tone: "danger", key: "gear.notice.notFound" },
  "gear-booking-not-found": { tone: "danger", key: "gear.notice.notFound" },
  "gear-invalid-window": { tone: "danger", key: "gear.notice.invalid" },
  "gear-invalid": { tone: "danger", key: "gear.notice.invalid" },
  "gear-already-returned": { tone: "warning", key: "gear.notice.alreadyReturned" },
};

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
 * The morning packing list. Everything above the assignments section is
 * derived from the roster's rental fits and the trip's dive plan — the
 * counts and sizes reserve nothing. The one exception is deliberate: a shop
 * that keeps its fleet on the gear register can assign tagged units to
 * renting divers here, and only that act reserves anything (ADR
 * 20260815-minimal-gear-register; a shop with no register sees no change).
 * It is a page to work down with your hands full, so it prints, and the two
 * ways it can be wrong (a missing fit, an unverified nitrox card) are stated
 * at the top rather than buried.
 *
 * The packing list itself is read two ways, chosen by `?group=` and resolved
 * server-side: down the rack (`item`, the default — six BCDs together with
 * their sizes) or down the roster (`diver` — one row per person with their
 * pieces). Both are the same pieces out of one `buildDivePrepChecklist` call,
 * so the choice is a sort rather than a second source of truth, and it lives
 * in the URL so a link to it survives being shared with whoever is loading
 * the van (same shape as the shop home's `?view=`).
 */
export default async function TripPrepPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    notice?: string;
    /** Which grouping; anything unrecognised reads as the by-item default. */
    group?: string;
  }>;
}) {
  const { shopSlug, id: tripId } = await params;
  const { notice, group } = await searchParams;
  const grouping: PrepGrouping = isPrepGrouping(group) ? group : "item";
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const prep = await getTripPrep(db, shop, tripId);
  if (!prep) notFound();
  const { trip, checklist, hotelPickups, gearFleetTotal, freeByKind, assignmentRows } = prep;

  /**
   * The size a staffer pulls, or the honest reason there isn't one — null when
   * the piece has no size to carry at all. Shared by the phone cards, both
   * tables, and both groupings, so none of them can drift into telling the
   * boat different things about the same piece.
   */
  const pieceSize = (piece: PrepPiece) => {
    // The count is real; the size deliberately isn't.
    if (piece.fitAtCheckIn) {
      return <span className="font-medium text-warning">{t("trips.prep.fitAtCheckIn")}</span>;
    }
    if (piece.size) return piece.size;
    // An item that should have had a size and doesn't says so; one with no
    // size to record has nothing to say, because those are different problems.
    return UNSIZED_ITEM_KINDS.includes(piece.kind) ? null : (
      <span className="text-muted">{t("trips.prep.notRecorded")}</span>
    );
  };
  /** The same answer in a Size column, where an unsized piece still owes a cell. */
  const sizeCell = (piece: PrepPiece) => {
    return pieceSize(piece) ?? <span className="text-muted">—</span>;
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

  /**
   * One kit line: the piece on the left, what it resolves to — a tagged unit
   * or the picker for one — on the right. Stacked on a phone, two columns from
   * `sm` up, so a diver's pieces line up down the row rather than each finding
   * its own indent.
   */
  const kitLineClass = "grid gap-x-3 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline";

  const gearBanner = noticeFromParam(notice, GEAR_NOTICES);
  // Both groupings are this page at a different `?group=`, so the switch's
  // links carry no other state — a `?notice=` is spent by the time anyone taps
  // one (`FlashParams` strips it), and there is nothing else in the query.
  const prepPath = shopPath(shopSlug, "trips", tripId, "prep");
  /**
   * Years dry, beside the name, on exactly the terms the roster states it
   * (`RosterSection.tsx`) — only the two notable bands, warning tone, words
   * from `diveRecencyText`. This is the reader the answer is most use to: a
   * divemaster packing a diver's kit is deciding what to bring and who to pair
   * them with, and "last dived over five years ago" changes both.
   *
   * Informs, never gates (ADR 20260821-currency-is-what-catches-people) —
   * nothing here filters, sorts, or refuses. `diveRecencyText` returns null for
   * a diver who was never asked, so silence renders nothing rather than a "not
   * said" line on every seat booked before the question existed.
   */
  const diveRecencyLine = (band: (typeof checklist.diverLines)[number]["lastDivedBand"]) => {
    if (!diveRecencyIsNotable(band)) return null;
    return (
      <span className="mt-0.5 flex items-center gap-1 text-sm font-normal text-warning-strong">
        <StatusMark variant="warning" size="md" />
        {diveRecencyText(t, band)}
      </span>
    );
  };

  /**
   * A diver's kit as one cell: each piece with the size to pull it in, or the
   * one word that says why there is nothing to pull. Own kit and never-asked
   * are kept apart here for the same reason they are kept apart everywhere
   * else — one is an answer, the other is an open question.
   */
  const kitCell = (line: (typeof checklist.diverLines)[number]) =>
    line.items.length > 0 ? (
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {line.items.map((piece) => {
          const detail = pieceSize(piece);
          return (
            <li key={piece.kind}>
              <span className="font-medium">{rentalItemLabel(t, piece.kind)}</span>
              {detail ? <> {detail}</> : null}
            </li>
          );
        })}
      </ul>
    ) : (
      <span className="text-muted">
        {line.state === "own_kit"
          ? t("shared.rentalFit.ownKit")
          : t("shared.rentalFit.notRecorded")}
      </span>
    );

  return (
    <>
      <FlashParams params={["notice"]} />
      <TripPageHeader
        boardHref={shopPath(shopSlug, "schedule", "board")}
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        trip={trip}
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
        subNav={<TripSurfaceNav shopSlug={shopSlug} tripId={tripId} locale={locale} />}
      />

      {checklist.diverCount === 0 && checklist.crewCount === 0 ? (
        // The whole page's content region, so this one wears an h2 — and the
        // packing list can only become real once someone is on the boat, which
        // happens on the Trip surface.
        <EmptyState
          title={t("trips.prep.emptyHeading")}
          body={t("trips.prep.noDivers")}
          action={
            <Link
              href={shopPath(shopSlug, "trips", tripId)}
              className={buttonClass({ className: "mt-4" })}
            >
              {t("trips.prep.emptyAction")}
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="tanks-heading">
            <h2 id="tanks-heading" className={SECTION_TITLE_CLASS}>
              {t("trips.prep.tanksHeading")}
            </h2>
            {/* **Three tiles on a screen; one line on paper.** The tiles are
                the right shape for a wall-mounted screen a staffer reads
                across the room, and the wrong one for a sheet carried to the
                boat: three cards of whitespace holding two digits each pushed
                the packing list that follows them onto its own page. Same
                three numbers, said inline. */}
            <div
              className={`mt-3 grid gap-3 print:hidden ${showNitrox ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}
            >
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
            <p className="mt-2 hidden text-base font-semibold tabular-nums print:block">
              {(showNitrox
                ? [
                    `${t("trips.prep.total")} ${checklist.tanks.total}`,
                    `${t("trips.prep.air")} ${checklist.tanks.air}`,
                    `${t("trips.prep.nitrox")} ${checklist.tanks.nitrox}`,
                  ]
                : [`${t("trips.prep.total")} ${checklist.tanks.total}`]
              ).join(" · ")}
            </p>
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
              className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:p-5"
            >
              <h2 id="nitrox-blocked-heading" className={SECTION_TITLE_CLASS}>
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
            <SectionCard
              className="mt-6"
              title={t("trips.prep.missingSizesHeading")}
              description={t("trips.prep.missingSizesDescription")}
            >
              {/* Two different situations, said differently: a diver with
                  *some* sizes on file keeps a row naming exactly what's
                  missing, while the never-asked share one sentence said once
                  above their names — the old list repeated "nothing on file;
                  they may be bringing their own kit…" per row, the same clause
                  chanted seven times (principle 9). */}
              <ul className="flex flex-col gap-1 text-sm">
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
            </SectionCard>
          ) : null}

          {checklist.diversNeedingStaffFit.length > 0 ? (
            <section
              aria-labelledby="staff-fit-heading"
              className="mt-6 rounded-2xl border border-warning/40 bg-warning/5 p-4 sm:p-5"
            >
              <h2 id="staff-fit-heading" className={SECTION_TITLE_CLASS}>
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

          {/* **What the day has been asked to set up.**

              A neutral panel, deliberately — `SectionCard`'s ordinary border
              and surface, not the warning tone of the staff-fit block above it.
              A diver who arranged a lift is a diver this shop is ready for, and
              a crew reading that as an alert is being told the opposite of what
              the record exists to say (ADR
              20260827-support-needs-are-a-record-about-the-dive; the tone
              standard is `src/lib/dive-recency.ts`'s doc comment).

              The boat's total is stated because it is what a shop reads beside
              its rostered crew when deciding whether the day is covered. It
              refuses nothing — a departure short of it sails, and the shop has
              a conversation. Renders nothing at all when nobody has asked for
              anything, which is almost every departure. */}
          {checklist.supportNeeds.divers.length > 0 ? (
            <SectionCard title={t("trips.prep.supportHeading")} className="mt-8">
              {/* Only what the shop has to *find*. A diver bringing their own
                  adaptive-trained buddy needs a seat and a team, not crew, and
                  summing them here would have a manager staff up for people who
                  are already coming. */}
              {checklist.supportNeeds.supportDiversToArrange > 0 ? (
                <p className="text-sm font-medium">
                  {t("trips.prep.supportToArrange", {
                    count: checklist.supportNeeds.supportDiversToArrange,
                  })}
                </p>
              ) : null}
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {checklist.supportNeeds.divers.map((diver) => (
                  <li key={diver.personId}>
                    {/* Straight to the record's own Dive support section, not
                        the top of a 6,400px page: a staffer following this link
                        is going to read or correct the thing they were just
                        looking at (issue #1069). */}
                    <Link
                      href={`/shop/${shopSlug}/divers/${diver.personId}#support`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {diver.fullName}
                    </Link>
                    {/* One line per fact rather than a comma-separated run:
                        two of them carry the diver's own free text, and a
                        sentence inside a joined list is where a crew loses
                        track of which fact is which. */}
                    <ul className="mt-0.5 flex flex-col text-muted">
                      {supportNeedsLines(t, diver.needs, checklist.supportNeeds.rosterNames).map(
                        (line) => (
                          <li key={line}>{line}</li>
                        ),
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
              {/* Whoever arranged them, they are people on a boat — and the
                  manifest is the authoritative list of every person aboard, which
                  is what a coastguard reads. A support diver the diver brought
                  has no booking unless somebody makes one. */}
              <p className="mt-3 text-sm text-muted">{t("trips.prep.supportOnTheManifest")}</p>
            </SectionCard>
          ) : null}

          {hotelPickups.length > 0 ? (
            <section aria-labelledby="hotel-pickups-heading" className="mt-8">
              <div className="flex items-center justify-between gap-2">
                <h2 id="hotel-pickups-heading" className={SECTION_TITLE_CLASS}>
                  {t("trips.prep.hotelPickupsHeading")}
                </h2>
                <span className="text-sm text-muted">
                  {t("trips.prep.hotelPickupsCount", { count: hotelPickups.length })}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{t("trips.prep.hotelPickupsDescription")}</p>
              <div className="mt-3 sm:hidden">
                <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface shadow-bed">
                  {hotelPickups.map((pickup) => (
                    <li key={pickup.bookingId} className="px-4 py-3">
                      <p className="font-medium tabular-nums">
                        {pickup.pickupTime ?? (
                          <span className="text-muted">{t("trips.prep.pickupTimeUnset")}</span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {pickup.hotelPickupLocation} · {pickup.diverName}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              <Table shellClassName="mt-3 hidden sm:block">
                <THead>
                  <tr>
                    <Th>{t("trips.prep.pickupTimeColumn")}</Th>
                    <Th>{t("trips.prep.pickupHotelColumn")}</Th>
                    <Th>{t("trips.prep.pickupDiverColumn")}</Th>
                  </tr>
                </THead>
                <TBody>
                  {hotelPickups.map((pickup) => (
                    <tr key={pickup.bookingId}>
                      <Td className="font-medium">
                        {pickup.pickupTime ?? (
                          <span className="text-muted">{t("trips.prep.pickupTimeUnset")}</span>
                        )}
                      </Td>
                      <Td className="font-medium">{pickup.hotelPickupLocation}</Td>
                      <Td>{pickup.diverName}</Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </section>
          ) : null}

          <section aria-labelledby="kit-heading" className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 id="kit-heading" className={SECTION_TITLE_CLASS}>
                {t("trips.prep.rentalKitHeading")}
              </h2>
              {/* A state toggle, not two buttons: one list, two ways of
                  walking it (design principle 8). It only appears once there
                  is something to pull — with nothing on the list both
                  groupings render the identical empty state, and a control
                  that changes nothing is worse than no control. */}
              {checklist.lines.length > 0 ? (
                <SegmentedControl
                  ariaLabel={t("trips.prep.groupLabel")}
                  items={[
                    {
                      key: "item",
                      label: t("trips.prep.groupByItem"),
                      href: `${prepPath}?group=item`,
                    },
                    {
                      key: "diver",
                      label: t("trips.prep.groupByDiver"),
                      href: `${prepPath}?group=diver`,
                    },
                  ]}
                  currentKey={grouping}
                  currentIsLink
                  ariaCurrentValue="true"
                  scroll={false}
                  className="shrink-0"
                />
              ) : null}
            </div>
            {checklist.lines.length === 0 ? (
              // A section inside a larger page, so h3. Two honest readings of
              // the same empty table — a genuine nothing-to-do, or fits that
              // were never recorded — and the Trip surface is where a fit gets
              // put on file either way.
              <EmptyState
                titleAs="h3"
                title={
                  needsSorting
                    ? t("trips.prep.rentalKitEmptyNeedsSortingHeading")
                    : t("trips.prep.rentalKitEmptyOwnKitHeading")
                }
                body={
                  needsSorting
                    ? t("trips.prep.nothingToPullNeedsSorting")
                    : t("trips.prep.nothingToPullOwnKit")
                }
                action={
                  <Link
                    href={shopPath(shopSlug, "trips", tripId)}
                    className={buttonClass({
                      variant: "secondary",
                      size: "sm",
                      className: "mt-4",
                    })}
                  >
                    {t("trips.prep.rentalKitEmptyAction")}
                  </Link>
                }
                className="mt-3"
              />
            ) : grouping === "item" ? (
              <>
                {/* Phone: stacked cards. Four columns at 390px put a
                    comma-joined diver list against three other columns and the
                    names win — the item, size, and count a staffer is actually
                    pulling gear by get squeezed to a character or two. Cards
                    under `sm`, the table above — the split the diver roster
                    also carried until it became one ledger at every width (ADR
                    20260827-people-not-lists); this list is the departure
                    surfaces' own call and stays. `print:` pins each half explicitly so the
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
                        <p className={`shrink-0 ${FIGURE_CLASS}`}>
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
            ) : (
              /* The same pieces down the roster instead of down the rack, for
                 the half of packing that happens per person — bagging a
                 diver's kit, or answering "what does this one still need?"
                 Every diver on the boat has a row, including the ones with
                 nothing to pull: a name whose answer is "own kit" is what
                 lets the packer stop looking for it. Same card-under-`sm`,
                 table-above split and the same `print:` pins as the by-item
                 view, so whichever grouping is on screen is what prints. */
              <>
                <ul className="mt-3 flex flex-col gap-3 sm:hidden print:hidden">
                  {checklist.diverLines.map((line) => (
                    <li key={line.bookingId} className={sectionCardClass()}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            <Link
                              href={`/shop/${shopSlug}/divers/${line.personId}`}
                              className="hover:text-primary hover:underline"
                            >
                              {line.fullName}
                            </Link>
                          </p>
                          {diveRecencyLine(line.lastDivedBand)}
                        </div>
                        <p className={`shrink-0 ${FIGURE_CLASS}`}>
                          <span className="sr-only">{t("trips.prep.qtyColumn")} </span>
                          {line.items.length}
                        </p>
                      </div>
                      <div className="mt-2 text-sm">{kitCell(line)}</div>
                    </li>
                  ))}
                </ul>
                {/* Three columns rather than four, so a lower floor than the
                    by-item table's: the kit cell wraps, and forcing 45rem
                    would scroll a phone-width tablet sideways for nothing. */}
                <Table minWidth="36rem" shellClassName="mt-3 hidden sm:block print:block">
                  <THead>
                    <Th>{t("trips.prep.diverColumn")}</Th>
                    <Th>{t("trips.prep.kitColumn")}</Th>
                    <Th numeric>{t("trips.prep.qtyColumn")}</Th>
                  </THead>
                  <TBody>
                    {checklist.diverLines.map((line) => (
                      <tr key={line.bookingId}>
                        <Td className="font-medium">
                          <Link
                            href={`/shop/${shopSlug}/divers/${line.personId}`}
                            className="hover:text-primary hover:underline"
                          >
                            {line.fullName}
                          </Link>
                          {diveRecencyLine(line.lastDivedBand)}
                        </Td>
                        <Td>{kitCell(line)}</Td>
                        <Td numeric>{line.items.length}</Td>
                      </tr>
                    ))}
                  </TBody>
                </Table>
              </>
            )}
          </section>

          {/* Which tagged unit each renting diver takes — the one part of this
              page that reserves anything, present only for a shop that keeps
              its fleet on the register. The assigned lines print with the
              packing list; the controls do not. The notice banner sits above
              the section's own gate: a refusal like gear-not-found is exactly
              the case where the row (or the whole fleet) can be gone, and the
              staffer still gets told what happened. */}
          {/* Its own space above it. Rendered flush, it read as the last row
              of the packing table it happens to follow rather than as an
              answer to the tap that produced it. */}
          {gearBanner ? (
            <StaffNoticeBanner tone={gearBanner.tone} className="mt-8">
              {t(gearBanner.key)}
            </StaffNoticeBanner>
          ) : null}
          {gearFleetTotal > 0 && assignmentRows.length > 0 ? (
            <section
              aria-labelledby="assignments-heading"
              // On paper the section is only its assigned lines: with nothing
              // assigned yet it would print as a heading over bare names, so
              // it drops out of the packet entirely until a unit is on it.
              className={`mt-8${assignmentRows.some((row) => row.assigned.length > 0) ? "" : " print:hidden"}`}
            >
              <h2 id="assignments-heading" className={SECTION_TITLE_CLASS}>
                {t("gear.prep.heading")}
              </h2>
              <p className="mt-1 text-sm text-muted print:hidden">{t("gear.prep.description")}</p>
              {/* **One grammar per diver, not two stacked lists.** A row used
                  to be a list of assigned units in one shape (a mono tag, a
                  kind, a release control) followed by a list of labelled
                  `<select>`s in another, so "wetsuit XL" appeared twice in two
                  different layouts depending on whether it had been picked
                  yet. Every piece is one line now — the piece on the left, its
                  unit or its picker on the right — and settling one moves it
                  between bands rather than between designs. */}
              <ul
                className={sectionCardClass({
                  padding: "none",
                  className: "mt-3 divide-y divide-border overflow-hidden print:overflow-visible",
                })}
              >
                {assignmentRows.map(({ diver, assigned, wanted }) => (
                  <li
                    key={diver.bookingId}
                    className={`px-4 py-3 sm:px-5${assigned.length > 0 ? "" : " print:hidden"}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="font-medium">{diver.fullName}</p>
                      {/* The slip's door, and only once there is something to
                          put on it — a ticket listing nothing is a wrong slip,
                          not a short one. Hidden on paper: the departure packet
                          is already printing this diver's units. */}
                      {assigned.length > 0 ? (
                        <Link
                          href={shopPath(
                            shopSlug,
                            "trips",
                            tripId,
                            "prep",
                            "ticket",
                            diver.bookingId,
                          )}
                          className={`${buttonClass({ variant: "ghost", size: "sm" })} print:hidden`}
                        >
                          {t("gear.prep.ticketDoor")}
                        </Link>
                      ) : null}
                    </div>
                    <dl className="mt-1.5 flex flex-col gap-2 text-sm">
                      {assigned.map((assignment) => (
                        <div key={assignment.reservationId} className={kitLineClass}>
                          <dt className="text-muted">
                            {assignment.size
                              ? t("gear.prep.kindWithSize", {
                                  kindLabel: gearItemKindLabel(t, assignment.kind),
                                  size: assignment.size,
                                })
                              : gearItemKindLabel(t, assignment.kind)}
                          </dt>
                          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-mono font-medium">{assignment.label}</span>
                            {assignment.checkedOutAt ? (
                              <span className="text-muted">{t("gear.prep.outLabel")}</span>
                            ) : (
                              <form action={releaseGearUnitAction} className="print:hidden">
                                <input type="hidden" name="tripId" value={tripId} />
                                <input
                                  type="hidden"
                                  name="reservationId"
                                  value={assignment.reservationId}
                                />
                                <SubmitButton
                                  pendingLabel={t("gear.unit.where.releasing")}
                                  className={buttonClass({ variant: "ghost", size: "sm" })}
                                >
                                  {t("gear.unit.where.release")}
                                </SubmitButton>
                              </form>
                            )}
                          </dd>
                        </div>
                      ))}
                      {wanted.map((item) => {
                        const kindLabel = gearItemKindLabel(t, item.kind);
                        const pieceLabel = item.size
                          ? t("gear.prep.kindWithSize", { kindLabel, size: item.size })
                          : kindLabel;
                        // Exactly this diver's size in its own band, everything
                        // else free in a second — the boundary the old flat
                        // ranked list could only imply.
                        const { exact, rest } = groupUnitsForSize(
                          freeByKind.get(item.kind) ?? [],
                          item.size,
                        );
                        const selectId = `assign-${diver.bookingId}-${item.kind}`;
                        // Preselect only an exact size match: defaulting an XS
                        // onto an L diver made a wrong reservation one tap
                        // away, and defaulting the same unit into every picker
                        // of a kind invited the somebody-got-it-first refusal.
                        // Anything else opens on a placeholder the form refuses
                        // to submit.
                        const preselect = exact[0]?.id ?? "";
                        const optionsFor = (units: typeof exact) =>
                          units.map((option) => ({
                            id: option.id,
                            label: [
                              option.size ? `${option.label} · ${option.size}` : option.label,
                              // A lapsed or looming bench clock is said at the
                              // moment of the pick — still selectable, never
                              // hidden: the dock decides (H-06).
                              option.serviceState.state === "overdue"
                                ? t("gear.prep.optionServiceOverdue")
                                : option.serviceState.state === "due_soon"
                                  ? t("gear.prep.optionServiceDueSoon")
                                  : null,
                            ]
                              .filter(Boolean)
                              .join(" · "),
                          }));
                        // **Nothing falls between the bands.** The first band
                        // is headed by the size it matches, so it can only
                        // exist where there is a size to name — and a unit
                        // sorted into it without one would otherwise be in
                        // neither band and reachable from no picker, which on
                        // this page means a staffer cannot assign a unit that
                        // is genuinely free. `groupUnitsForSize` does not
                        // produce that pair today; this makes it structural
                        // rather than something the next reader has to trace.
                        const named = exact.length > 0 && item.size ? item.size : null;
                        const exactBand = named ? exact : [];
                        const restBand = named ? rest : [...exact, ...rest];
                        const groups = [
                          named
                            ? {
                                key: "exact",
                                label: t("gear.prep.groupExactSize", { size: named }),
                                options: optionsFor(exactBand),
                              }
                            : null,
                          restBand.length > 0
                            ? {
                                key: "rest",
                                label: t(
                                  named ? "gear.prep.groupOtherSizes" : "gear.prep.groupFree",
                                ),
                                options: optionsFor(restBand),
                              }
                            : null,
                        ].filter((group) => group !== null);
                        return (
                          <div key={item.kind} className={`${kitLineClass} print:hidden`}>
                            <dt className="text-muted sm:pt-2">
                              {groups.length === 0 ? (
                                pieceLabel
                              ) : (
                                <label htmlFor={selectId}>{pieceLabel}</label>
                              )}
                            </dt>
                            <dd>
                              {groups.length === 0 ? (
                                <span className="text-muted">
                                  {t("gear.prep.noneFree", { kindLabel })}
                                </span>
                              ) : (
                                // The width lives on a wrapper: `controlClass`
                                // carries w-full, and a competing width utility
                                // on the same element loses alphabetically.
                                <div className="w-full min-w-44 sm:max-w-64">
                                  {/* **No "Assign" beside it.** The pick is the
                                      act; a second tap to confirm it is an
                                      "Edit" button once per row, twenty-one
                                      times on a seeded departure (issue #802).
                                      The refusal the exclusion constraint can
                                      still answer with lands on this row, and
                                      reverts it. */}
                                  <RentalUnitPicker
                                    id={selectId}
                                    tripId={tripId}
                                    bookingId={diver.bookingId}
                                    defaultValue={preselect}
                                    assign={assignGearUnit}
                                    groups={groups}
                                    copy={{
                                      pickUnit: t("gear.prep.pickUnit"),
                                      assigning: t("gear.prep.assigning"),
                                      refusals: {
                                        unit_unavailable: t("gear.prep.notice.unitUnavailable"),
                                        unit_out_of_service: t("gear.prep.notice.unitOutOfService"),
                                      },
                                      refusalFallback: t("gear.prep.notice.assignFailed"),
                                    }}
                                  />
                                </div>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
