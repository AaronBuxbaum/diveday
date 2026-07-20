import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listTripPrepDivers } from "@/db/rental-fit";
import { getShopById } from "@/db/shops";
import { getTripCrewIds, getTripWithBooked, listStaff } from "@/db/trips";
import { buildDivePrepChecklist, UNSIZED_ITEM_KINDS } from "@/lib/dive-prep";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Trip prep — Scuba",
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
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();

  const [divers, staff, crewIds] = await Promise.all([
    listTripPrepDivers(db, shop.id, tripId),
    listStaff(db, shop.id),
    getTripCrewIds(db, tripId),
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

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <Link
        href={`/shop/${shopSlug}/trips/${tripId}`}
        className="text-sm font-medium text-primary hover:underline print:hidden"
      >
        ← Back to the trip
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow="Trip prep"
          title={trip.title}
          description={[
            `${checklist.diverCount} ${checklist.diverCount === 1 ? "diver" : "divers"}`,
            checklist.crewCount > 0
              ? `${checklist.crewCount} diving ${checklist.crewCount === 1 ? "crew" : "crew"}`
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
      </div>

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
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm text-muted">Total</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{checklist.tanks.total}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm text-muted">Air</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{checklist.tanks.air}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm text-muted">Nitrox</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{checklist.tanks.nitrox}</p>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted">
              {checklist.crewCount > 0
                ? `Includes the roster and the ${checklist.crewCount === 1 ? "divemaster or instructor" : "divemasters and instructors"} assigned to this trip; spares are not counted.`
                : "Divers on the roster only — spares are not counted. Assign a divemaster or instructor to this trip to include their tanks."}{" "}
              Scuba logs no gas analysis: every mix is still analyzed and signed for at the fill
              station.
            </p>
          </section>

          {checklist.nitroxBlockers.length > 0 ? (
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

          <section aria-labelledby="kit-heading" className="mt-8">
            <h2 id="kit-heading" className="text-lg font-semibold">
              Rental kit
            </h2>
            {checklist.lines.length === 0 ? (
              <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                {checklist.diversWithoutFit.length > 0
                  ? "Nothing to pull from the fits on file — but the divers listed above were never asked."
                  : "Nothing to pull — every diver on this trip brings their own kit."}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-md border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Item
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Size
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Qty
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        For
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklist.lines.map((line) => (
                      <tr
                        key={`${line.kind}:${line.size ?? ""}`}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-3 font-medium">{line.label}</td>
                        <td className="px-4 py-3">
                          {line.size ??
                            (UNSIZED_ITEM_KINDS.includes(line.kind) ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <span className="text-muted">Not recorded</span>
                            ))}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{line.count}</td>
                        <td className="px-4 py-3 text-muted">{line.divers.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
