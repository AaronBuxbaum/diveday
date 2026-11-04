import type { ReactNode } from "react";
import { BookingRequestContext } from "@/components/seat-diver/BookingRequestCards";
import type { AppDb } from "@/db/client";
import { type BookableDiver, getBookableDiver } from "@/db/divers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { readSeatRequest, type SeatRequest } from "../_lib/seat-request";
import type { SeatRequestContext } from "./AddDiverSection";

/**
 * A date request, as the add band shows and carries it: the card naming who
 * asked, for what and how many are left to seat, the id the band's booking
 * seats post, the prefill for someone not on file (the party's first seat
 * only: after it, the asker's details would only seat the asker again), and
 * the asker on file as the band's one match when nothing was typed.
 */
export function seatRequestBand(
  { row, candidate, askerAboard, seated, partySize }: SeatRequest,
  { shopSlug, tripId, t }: { shopSlug: string; tripId: string; t: StaffTranslator },
): {
  context: SeatRequestContext;
  card: ReactNode;
  search?: { query: string; candidates: BookableDiver[] };
} {
  const name = row.name ?? t("requests.anonymous");
  return {
    context: {
      id: row.id,
      prefill:
        row.personId || seated > 0
          ? undefined
          : {
              fullName: row.name ?? undefined,
              email: row.email ?? undefined,
              phone: row.phone ?? undefined,
            },
    },
    card: (
      <>
        <BookingRequestContext
          title={t("bookings.new.fromRequest")}
          name={name}
          diversLabel={t("trips.addDiver.requestLeft", { count: partySize - seated })}
          subject={
            row.courseTitle
              ? t("requests.aboutCourse", { course: row.courseTitle })
              : t("requests.aboutDive", { interest: row.interest ?? "" })
          }
          sourceHref={shopPath(shopSlug, "requests")}
          sourceLabel={t("bookings.new.viewRequests")}
          personHref={row.personId ? shopPath(shopSlug, "divers", row.personId) : undefined}
          personLabel={row.personId ? t("requests.viewDiver") : undefined}
          // Putting the request down keeps the band open: the desk is still
          // seating, just not for this party (dock review F1).
          doneHref={`${shopPath(shopSlug, "trips", tripId)}?add=1`}
          doneLabel={t("trips.addDiver.requestDone")}
        />
        {askerAboard ? (
          <p className="text-sm text-muted">{t("trips.addDiver.requestAskerAboard", { name })}</p>
        ) : null}
      </>
    ),
    search: candidate ? { query: name, candidates: [candidate] } : undefined,
  };
}

/**
 * What the departure page's URL asks of the add band: `?add=1` opens it with
 * the cursor in it, `?counter=1` is the desk's own choice to seat walk-ins
 * (never inferred from the clock: a phone booking for tomorrow is not a
 * walk-in), and `?request=` seats a date request's party. The counter answers
 * no request, so it is not read there. A request that is gone says so in its
 * card's place, and the band seats nobody against it.
 */
export async function addBandFor(
  db: AppDb,
  where: { shop: { id: string }; shopSlug: string; tripId: string; t: StaffTranslator },
  search: { add?: string; request?: string; diverq?: string; counter?: string; person?: string },
): Promise<{
  open: boolean;
  counter: boolean;
  request?: ReturnType<typeof seatRequestBand>;
  /** The diver `?person=` named, when they can still be seated here. */
  person?: { query: string; candidates: BookableDiver[] };
  requestGone?: ReactNode;
}> {
  const open = Boolean(search.add);
  if (search.counter === "1") return { open, counter: true };
  const read = await readSeatRequest(db, {
    shopId: where.shop.id,
    tripId: where.tripId,
    request: search.request,
    typed: search.diverq?.trim() ?? "",
  });
  if (read === "gone" || read === "not_offered") {
    return {
      open,
      counter: false,
      requestGone: (
        <p className="text-sm text-muted">
          {where.t(
            read === "gone" ? "trips.addDiver.requestGone" : "trips.addDiver.requestNotOffered",
          )}
        </p>
      ),
    };
  }
  if (read) return { open, counter: false, request: seatRequestBand(read, where) };
  return { open, counter: false, person: await readSalvagePerson(db, where, search) };
}

/**
 * **The person a rebook link names, picked by id** (issue #3742). The no-show
 * and sailed rebook links carry `?person=<id>`, never a name to search, so two
 * divers who share a name are never left for the desk to choose between. The
 * name stays as the search text. What the staffer typed wins, and an id that
 * is not a diver of this shop, or is already on this boat, reads as no id.
 */
async function readSalvagePerson(
  db: AppDb,
  where: { shop: { id: string }; tripId: string },
  search: { person?: string; diverq?: string },
): Promise<{ query: string; candidates: BookableDiver[] } | undefined> {
  const id = search.person ? uuidParam(search.person) : null;
  if (!id || (search.diverq?.trim() ?? "") !== "") return undefined;
  const candidate = await getBookableDiver(db, where.shop.id, where.tripId, id);
  return candidate ? { query: candidate.person.fullName, candidates: [candidate] } : undefined;
}
