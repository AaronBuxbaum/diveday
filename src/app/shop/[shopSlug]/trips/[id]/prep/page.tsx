import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { getTripCrewIds, getTripWithBooked, listStaff } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { buildDivePrepChecklist, UNSIZED_ITEM_KINDS } from "@/lib/dive-prep";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { shopOffersNitrox } from "@/lib/rentals";
import { requireStaffSession } from "@/lib/session";

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
  const { id: tripId } = await params;
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
  const checklist = buildDivePrepChecklist({ divers, plannedDives: trip.plannedDives, divingCrew });
  // A shop that has never offered nitrox can never have live nitrox data here
  // (setBookingNitrox fails closed), so this is purely cosmetic for that
  // common case — but a shop that *disabled* nitrox after a diver requested
  // it (with or without a verified card) must not have this trip's already-
  // real tank split or blocker silently disappear out from under the crew.
  const showNitrox =
    shopOffersNitrox(shop.rentalItems) ||
    checklist.tanks.nitrox > 0 ||
    checklist.nitroxBlockers.length > 0;

  return (
    <>
      <ShopPageHeader
        eyebrow={t("trips.prep.eyebrow")}
        title={trip.title}
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
        meta={
          <span>
            {formatShortDate(trip.startsAt, locale, shop.timezone)},{" "}
            {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, shop.timezone)}
          </span>
        }
        actions={<PrintButton label={t("shared.printButton.label")} />}
      />

      {checklist.diverCount === 0 && checklist.crewCount === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          {t("trips.prep.noDivers")}
        </p>
      ) : (
        <>
          <section aria-labelledby="tanks-heading">
            <h2 id="tanks-heading" className="text-lg font-semibold">
              {t("trips.prep.tanksHeading")}
            </h2>
            <div className={`mt-3 grid gap-3 ${showNitrox ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
              {showNitrox ? (
                <>
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="text-sm text-muted">{t("trips.prep.total")}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">
                      {checklist.tanks.total}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="text-sm text-muted">{t("trips.prep.air")}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">
                      {checklist.tanks.air}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="text-sm text-muted">{t("trips.prep.nitrox")}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">
                      {checklist.tanks.nitrox}
                    </p>
                  </div>
                </>
              ) : (
                // Air and total are the same number with no nitrox split to draw,
                // so there's nothing for a second tile to distinguish.
                <div className="rounded-lg border border-border bg-surface p-4">
                  <p className="text-sm text-muted">{t("trips.prep.total")}</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {checklist.tanks.total}
                  </p>
                </div>
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
              className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4"
            >
              <h2 id="nitrox-blocked-heading" className="font-semibold">
                {t("trips.prep.nitroxBlockedHeading")}
              </h2>
              <p className="mt-1 text-sm">{t("trips.prep.nitroxBlockedDescription")}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {checklist.nitroxBlockers.map((blocker) => (
                  <li key={blocker.bookingId}>• {blocker.fullName}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {checklist.diversWithoutFit.length > 0 ? (
            <section
              aria-labelledby="no-fit-heading"
              className="mt-6 rounded-lg border border-border bg-surface p-4"
            >
              <h2 id="no-fit-heading" className="font-semibold">
                {t("trips.prep.noFitHeading")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("trips.prep.noFitDescription")}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {checklist.diversWithoutFit.map((name) => (
                  <li key={name}>• {name}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {checklist.diversNeedingStaffFit.length > 0 ? (
            <section
              aria-labelledby="staff-fit-heading"
              className="mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4"
            >
              <h2 id="staff-fit-heading" className="font-semibold">
                {t("trips.prep.staffFitHeading")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("trips.prep.staffFitDescription")}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {checklist.diversNeedingStaffFit.map((diver) => (
                  <li key={diver.fullName}>
                    • {diver.fullName}
                    {diver.note ? <span className="text-muted"> — {diver.note}</span> : null}
                    {/* What they asked for. The captain doing the fit can't edit
                        the profile and sees no size on the packing line, so
                        without this there is nothing to bring a range around. */}
                    {diver.statedSizes ? (
                      <span className="text-muted">
                        {" "}
                        {t("trips.prep.askedFor", { sizes: diver.statedSizes })}
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
              <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                {checklist.diversWithoutFit.length > 0 || checklist.diversNeedingStaffFit.length > 0
                  ? t("trips.prep.nothingToPullNeedsSorting")
                  : t("trips.prep.nothingToPullOwnKit")}
              </p>
            ) : (
              <div className="mt-3">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        {t("trips.prep.itemColumn")}
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        {t("trips.prep.sizeColumn")}
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        {t("trips.prep.qtyColumn")}
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        {t("trips.prep.forColumn")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklist.lines.map((line) => (
                      <tr
                        key={`${line.kind}:${line.fitAtCheckIn ? " fit" : (line.size ?? "")}`}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-3 font-medium sm:px-4">{line.label}</td>
                        <td className="px-3 py-3 sm:px-4">
                          {line.fitAtCheckIn ? (
                            // The count is real; the size deliberately isn't.
                            <span className="font-medium text-warning">
                              {t("trips.prep.fitAtCheckIn")}
                            </span>
                          ) : (
                            (line.size ??
                            (UNSIZED_ITEM_KINDS.includes(line.kind) ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <span className="text-muted">{t("trips.prep.notRecorded")}</span>
                            )))
                          )}
                        </td>
                        <td className="px-3 py-3 tabular-nums sm:px-4">{line.count}</td>
                        <td className="px-3 py-3 text-muted sm:px-4">{line.divers.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
