import Link from "next/link";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { getDb } from "@/db/client";
import { getTripPrep, type TripPrepShop } from "@/db/trips-prep";
import { staffTranslator } from "@/i18n/staff-messages";
import type { PrepGrouping } from "@/lib/dive-prep";
import { shopPath } from "@/lib/staff-notices";
import { PrepBody } from "../prep/_components/PrepBody";

/**
 * **The morning packing list, on the departure it is for.**
 *
 * The departure stopped being three tabs (ADR 20260919-one-idea, slice 23c),
 * so the list a crew works down with their hands full reads on the same page
 * as the roster it is derived from — who is aboard, then what to pull for
 * them. `/prep` survives as its own route because the paper day composes it
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
  cancelled,
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
  /** A blown-out departure packs nothing; see `PrepBody`. */
  cancelled: boolean;
}) {
  const t = staffTranslator(locale);
  const prepPath = shopPath(shop.slug, "trips", tripId, "prep");
  let prep: Awaited<ReturnType<typeof getTripPrep>>;
  try {
    const db = await getDb();
    prep = await getTripPrep(db, shop, tripId);
  } catch {
    // **A bad moment at the gear counter costs the gear counter, nothing
    // else.** `<Suspense>` is not an error boundary, so an unhandled throw
    // from any of these six queries propagates to `trips/[id]/error.tsx` and
    // takes the roster, the blockers, the crew panel and the one door to the
    // roll call with it — on the page a crew is standing on, on marina wifi,
    // at 06:50 (dive-domain review 20260920). Before the fold a prep failure
    // cost you `/prep` and nothing else, and it still should.
    //
    // Worded rather than silent, because a packing list that is simply absent
    // reads as "nothing to pull", which is the one thing it must never say by
    // accident. `/prep` reads the same rows on its own page, so it is both the
    // honest retry and a second chance at the list.
    return (
      <StaffNoticeBanner tone="warning">
        {t("tripPrep.readFailed")}{" "}
        <Link href={prepPath} className="font-medium underline">
          {t("trips.surfaces.prep")}
        </Link>
      </StaffNoticeBanner>
    );
  }
  // The page above has already read this departure and answered `notFound()`
  // if it was gone, so a null here means the row went between the two reads.
  // On a page that is otherwise rendered, silence is the honest answer.
  if (!prep) return null;
  return (
    <>
      <PrepBody
        prep={prep}
        t={t}
        locale={locale}
        shopSlug={shop.slug}
        tripId={tripId}
        rentalItems={shop.rentalItems}
        notice={notice}
        grouping={grouping}
        cancelled={cancelled}
        groupPath={shopPath(shop.slug, "trips", tripId)}
      />
    </>
  );
}
