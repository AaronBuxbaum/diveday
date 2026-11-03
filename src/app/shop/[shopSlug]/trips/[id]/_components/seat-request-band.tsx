import type { ReactNode } from "react";
import { BookingRequestContext } from "@/components/seat-diver/BookingRequestCards";
import type { AppDb } from "@/db/client";
import type { BookableDiver } from "@/db/divers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
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
  { row, candidate, seated, partySize }: SeatRequest,
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
  search: { add?: string; request?: string; diverq?: string; counter?: string },
): Promise<{
  open: boolean;
  counter: boolean;
  request?: ReturnType<typeof seatRequestBand>;
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
  if (read === "gone") {
    return {
      open,
      counter: false,
      requestGone: <p className="text-sm text-muted">{where.t("trips.addDiver.requestGone")}</p>,
    };
  }
  return { open, counter: false, request: read ? seatRequestBand(read, where) : undefined };
}
