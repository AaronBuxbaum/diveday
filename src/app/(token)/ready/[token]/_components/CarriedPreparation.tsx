import type { getDb } from "@/db/client";
import { carriedPreparationForDiver, type ReadyPageData } from "@/db/ready";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import type { CarriedPreparation as CarriedPreparationItem } from "@/lib/carried-preparation";

/**
 * **What survived a day that did not happen** (issue #1197, delight report D37).
 *
 * A blown-out departure leaves this diver on a terminal card, holding a link to
 * a boat that is not going. The card already says so warmly and points at the
 * schedule; what it could not say is that the preparation they did was not
 * wasted. It was not — the release, the card and the sizes are filed against
 * the *person and the shop*, not the seat, so nothing here carries anything
 * anywhere. It reads facts that are already true.
 *
 * **Show-only, by the owner's ruling on the ticket**: no offer, no automatic
 * rebooking, no notification. Money is absent because what a blown-out booking
 * is owed stays a per-booking staff decision, and a gear reservation is absent
 * because it is held for a date nobody is diving.
 *
 * Renders nothing when nothing carried, including when the readiness lookup
 * itself did not answer — `carriedPreparation` fails closed, and an empty
 * panel on a cancellation is worse than the silence it replaced.
 */
export async function CarriedPreparation({
  db,
  data,
  t,
}: {
  db: Awaited<ReturnType<typeof getDb>>;
  data: ReadyPageData;
  t: DiverTranslator;
}) {
  // What the shop holds belongs to the matched diver record, and a held seat's
  // link may be someone else's (#2082).
  if (data.identityHeld) return null;
  const carried = await carriedPreparationForDiver(db, {
    shopId: data.shop.id,
    personId: data.person.id,
    hasRentalFit: data.rentalFit !== null,
  });
  if (carried.length === 0) return null;
  return (
    <div className="text-sm">
      <p className="font-medium">{t("ready.carriedHeading")}</p>
      <ul className="mt-1 text-muted">
        {carried.map((item) => (
          <li key={item}>{t(CARRIED_KEY[item])}</li>
        ))}
      </ul>
    </div>
  );
}

/** One message key per thing the shop still holds — codes in, words here. */
const CARRIED_KEY: Record<CarriedPreparationItem, DiverMessageKey> = {
  waiver: "ready.carriedWaiver",
  certification: "ready.carriedCertification",
  fit: "ready.carriedFit",
};
