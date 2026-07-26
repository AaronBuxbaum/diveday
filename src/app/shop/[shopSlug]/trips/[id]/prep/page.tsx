import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { getTripCrewIds, getTripWithBooked, listStaff } from "@/db/trips";
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
        eyebrow="Trips"
        title={trip.title}
        description={[
          `${checklist.diverCount} ${checklist.diverCount === 1 ? "diver" : "divers"}`,
          checklist.crewCount > 0
            ? `${checklist.crewCount} diving ${checklist.crewCount === 1 ? "crew member" : "crew"}`
            : null,
          `${checklist.diveCount} ${checklist.diveCount === 1 ? "dive" : "dives"}`,
          "one tank per diver per dive",
        ]
          .filter(Boolean)
          .join(" · ")}
        meta={
          <span>
            {formatShortDate(trip.startsAt, "en-US", shop.timezone)},{" "}
            {formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
          </span>
        }
        actions={<PrintButton />}
      />

      {checklist.diverCount === 0 && checklist.crewCount === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No divers booked yet — nothing to prepare.
        </p>
      ) : (
        <>
          <section aria-labelledby="tanks-heading">
            <h2 id="tanks-heading" className="text-lg font-semibold">
              Tanks
            </h2>
            <div className={`mt-3 grid gap-3 ${showNitrox ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
              {showNitrox ? (
                <>
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="text-sm text-muted">Total</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">
                      {checklist.tanks.total}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="text-sm text-muted">Air</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">
                      {checklist.tanks.air}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-4">
                    <p className="text-sm text-muted">Nitrox</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">
                      {checklist.tanks.nitrox}
                    </p>
                  </div>
                </>
              ) : (
                // Air and total are the same number with no nitrox split to draw,
                // so there's nothing for a second tile to distinguish.
                <div className="rounded-lg border border-border bg-surface p-4">
                  <p className="text-sm text-muted">Total</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {checklist.tanks.total}
                  </p>
                </div>
              )}
            </div>
            <p className="mt-2 text-sm text-muted">
              {checklist.crewCount > 0
                ? `Includes the roster and the ${checklist.crewCount === 1 ? "divemaster or instructor" : "divemasters and instructors"} assigned to this trip; spares are not counted.`
                : "Divers on the roster only — spares are not counted. Assign a divemaster or instructor to this trip to include their tanks."}{" "}
              DiveDay logs no gas analysis: every mix is still analyzed and signed for at the fill
              station.
            </p>
          </section>

          {showNitrox && checklist.nitroxBlockers.length > 0 ? (
            <section
              aria-labelledby="nitrox-blocked-heading"
              className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4"
            >
              <h2 id="nitrox-blocked-heading" className="font-semibold">
                Nitrox requested without a verified card
              </h2>
              <p className="mt-1 text-sm">
                Planned as air. Verify the enriched-air card on the diver’s record, or tell them at
                the counter before the boat leaves.
              </p>
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
                No rental fit on file
              </h2>
              <p className="mt-1 text-sm text-muted">
                They may be bringing their own kit — but nobody has asked. Their sizes are missing
                from the list below.
              </p>
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
                Fit these divers at check-in
              </h2>
              <p className="mt-1 text-sm text-muted">
                A size they asked for wasn’t available. They still count on the list below, but
                without a size — start from what they asked for, bring a range around it, and fit
                them in person rather than packing a substitute.
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {checklist.diversNeedingStaffFit.map((diver) => (
                  <li key={diver.fullName}>
                    • {diver.fullName}
                    {diver.note ? <span className="text-muted"> — {diver.note}</span> : null}
                    {/* What they asked for. The captain doing the fit can't edit
                        the profile and sees no size on the packing line, so
                        without this there is nothing to bring a range around. */}
                    {diver.statedSizes ? (
                      <span className="text-muted"> — asked for {diver.statedSizes}</span>
                    ) : (
                      <span className="text-muted"> — no sizes on file to start from</span>
                    )}
                    {/* How old the flag is: a shortage is about one day, so a
                        months-old flag is a prompt to re-ask, not to trust. */}
                    <span className="text-muted">
                      {" "}
                      (flagged{" "}
                      {diver.flaggedDaysAgo === 0
                        ? "today"
                        : diver.flaggedDaysAgo === 1
                          ? "yesterday"
                          : `${diver.flaggedDaysAgo} days ago`}
                      )
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="kit-heading" className="mt-8">
            <h2 id="kit-heading" className="text-lg font-semibold">
              Rental kit
            </h2>
            {checklist.lines.length === 0 ? (
              <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                {checklist.diversWithoutFit.length > 0 || checklist.diversNeedingStaffFit.length > 0
                  ? "Nothing to pull from the fits on file — but the divers listed above still need sorting out."
                  : "Nothing to pull — every diver on this trip brings their own kit."}
              </p>
            ) : (
              <div className="mt-3">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        Item
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        Size
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        Qty
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                        For
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
                            <span className="font-medium text-warning">Fit at check-in</span>
                          ) : (
                            (line.size ??
                            (UNSIZED_ITEM_KINDS.includes(line.kind) ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <span className="text-muted">Not recorded</span>
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
