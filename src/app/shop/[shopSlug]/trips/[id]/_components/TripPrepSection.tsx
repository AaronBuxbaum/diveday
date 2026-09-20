import { getDb } from "@/db/client";
import { getTripPrep, type TripPrepShop } from "@/db/trips-prep";
import { staffTranslator } from "@/i18n/staff-messages";
import type { PrepGrouping } from "@/lib/dive-prep";
import { shopPath } from "@/lib/staff-notices";
import { PrepBody } from "../prep/_components/PrepBody";

/**
 * **The morning packing list, on the departure it is for.**
 *
 * The departure stopped being four tabs (ADR 20260919-one-idea, slice 23c), so
 * the list a crew works down with their hands full reads on the same page as
 * the roster it is derived from — who is aboard, then what to pull for them.
 * `/prep` survives as its own route because the paper day composes it
 * (`print/_components/TripPacket.tsx`), and both render the one `PrepBody`.
 *
 * **Its own reads, inside its own `<Suspense>`.** `getTripPrep` is six queries
 * over the gear register and every diver's rental fit, and it is the last
 * section on a long page; gathering it into the page's own `Promise.all` would
 * make the hour, the hull and the roster above it wait on the gear counter.
 */
export async function TripPrepSection({
  shop,
  tripId,
  locale,
  notice,
  grouping,
}: {
  /**
   * **The session's own shop row, slug included** — deliberately not a `shop`
   * and a `shopSlug` beside it. Two independent props can be handed a
   * mismatched pair, and this component builds links from one and reads rows
   * with the other; one row makes that unrepresentable rather than merely
   * unwritten (security review 20260920). `requireShopSurface` has already
   * refused any row whose slug is not the URL's.
   */
  shop: TripPrepShop & { slug: string };
  /** Already validated as a UUID by the page above. */
  tripId: string;
  locale: string;
  notice: string | undefined;
  grouping: PrepGrouping;
}) {
  const db = await getDb();
  const prep = await getTripPrep(db, shop, tripId);
  // The page above has already read this departure and answered `notFound()`
  // if it was gone, so a null here means the row went between the two reads.
  // On a page that is otherwise rendered, silence is the honest answer —
  // throwing from inside a streamed boundary would replace a finished page
  // with an error the reader cannot act on.
  if (!prep) return null;
  const t = staffTranslator(locale);
  return (
    <div className="mt-10">
      <PrepBody
        prep={prep}
        t={t}
        locale={locale}
        shopSlug={shop.slug}
        tripId={tripId}
        rentalItems={shop.rentalItems}
        notice={notice}
        grouping={grouping}
        groupPath={shopPath(shop.slug, "trips", tripId)}
      />
    </div>
  );
}
