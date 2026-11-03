import { notFound } from "next/navigation";
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
 * asked and for what, the id every seat posts, the prefill for someone not on
 * file, and the asker on file as the band's one match when nothing was typed.
 */
export function seatRequestBand(
  { row, candidate }: SeatRequest,
  { shopSlug, t }: { shopSlug: string; t: StaffTranslator },
): {
  context: SeatRequestContext;
  card: ReactNode;
  search?: { query: string; candidates: BookableDiver[] };
} {
  const name = row.name ?? t("requests.anonymous");
  return {
    context: {
      id: row.id,
      prefill: row.personId
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
        diversLabel={t("requests.divers", { count: Math.max(1, row.partySize ?? 1) })}
        subject={
          row.courseTitle
            ? t("requests.aboutCourse", { course: row.courseTitle })
            : t("requests.aboutDive", { interest: row.interest ?? "" })
        }
        sourceHref={shopPath(shopSlug, "requests")}
        sourceLabel={t("bookings.new.viewRequests")}
        personHref={row.personId ? shopPath(shopSlug, "divers", row.personId) : undefined}
        personLabel={row.personId ? t("requests.viewDiver") : undefined}
      />
    ),
    search: candidate ? { query: name, candidates: [candidate] } : undefined,
  };
}

/**
 * What the departure page's URL asks of the add band: `?add=1` opens it with
 * the cursor in it, `?request=` seats from a date request. A request this shop
 * does not have is a 404, never a band that quietly seats someone without
 * closing what they asked for.
 */
export async function addBandFor(
  db: AppDb,
  where: { shop: { id: string }; shopSlug: string; tripId: string; t: StaffTranslator },
  search: { add?: string; request?: string; diverq?: string },
): Promise<{ open: boolean; request?: ReturnType<typeof seatRequestBand> }> {
  const read = await readSeatRequest(db, {
    shopId: where.shop.id,
    tripId: where.tripId,
    request: search.request,
    typed: search.diverq?.trim() ?? "",
  });
  if (read === "missing") notFound();
  return { open: Boolean(search.add), request: read ? seatRequestBand(read, where) : undefined };
}
