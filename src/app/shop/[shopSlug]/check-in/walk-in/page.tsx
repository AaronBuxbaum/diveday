import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { TripPickerList } from "@/components/seat-diver/TripPickerList";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { listWalkInTrips } from "@/db/check-in";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, noticeRole, noticeUrl, shopPath } from "@/lib/staff-notices";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Walk-in — DiveDay",
};

/**
 * The one refusal that can land on this step rather than on `./[tripId]`.
 *
 * `SEAT_SURFACES["walk-in"].refusedPath` (src/app/actions/seat-diver-surfaces.ts)
 * falls back here when the submission carried no departure at all — the only
 * walk-in refusal that happens before a boat is known, and so the only one that
 * cannot land on `./[tripId]`. Until 2026-08-15 this page read no `notice`,
 * so that refusal arrived as a URL with a query nothing looked at: a staffer who
 * submitted an unusable walk-in was bounced back to the boat picker with no idea
 * why, which is indistinguishable from a dead link.
 *
 * Deliberately just the one code. Every *other* walk-in notice is about a
 * specific departure and lands on `./[tripId]`, where the boat it is about is on
 * screen; repeating "that boat is full" on a page with no boat chosen would say
 * something true of nothing the reader can see.
 */
const NOTICE_KEYS: Record<string, { tone: "danger"; key: StaffMessageKey }> = {
  "walkin-invalid": { tone: "danger", key: "checkIn.notice.walkinInvalid" },
};

/**
 * The fast counter path, step one: which boat?
 *
 * The diver half used to live on this same URL behind a `?tripId=`, and the
 * departure has moved into a path segment (`./[tripId]`) for the reason the
 * global Add-booking door did the same: a refusal has to land back on the form
 * that produced it, and appending a second query param to an already-queried
 * URL is the one shape a server-action redirect cannot land on — the client
 * router holds the page it already has and the submit button spins forever.
 * Moving the trip into the path is what lets the counter say *why* a diver
 * bounced instead of sending the staffer to the trip page to find out.
 */
export default async function WalkInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  /**
   * `string | string[]`, because a repeated `?notice=a&notice=b` is what Next
   * actually hands back and nothing stops a staffer's URL carrying one. Typed as
   * a bare `string` it reached `noticeCode`'s `.toLowerCase()` as an array and
   * 500'd the page — the same hazard `./[tripId]`'s `gate` param and
   * `/sign-in`'s `callbackUrl` are already typed for (security review finding).
   */
  searchParams: Promise<{ tripId?: string | string[]; notice?: string | string[] }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const query = await searchParams;
  // A repeated param is malformed, not a second opinion — take the one value or
  // nothing, rather than guessing which of two a staffer meant.
  const one = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  const tripId = one(query.tripId);
  const notice = one(query.notice);
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== session.user.shopId) notFound();
  // `shopPath(shop.slug, …)` — the database's slug, escaped segment by segment,
  // rather than the URL's own spelling interpolated into a template.
  const self = shopPath(shop.slug, "check-in", "walk-in");
  // The shape this page used to take. A bookmark, a chat message, or a browser
  // that remembered the old URL lands on the same screen it always did rather
  // than on a trip picker with the choice silently dropped. The `?notice=` goes
  // with it: `./[tripId]` speaks the same vocabulary, so forwarding costs
  // nothing and dropping it would re-open the silent landing this page was just
  // given a banner to close.
  if (tripId) {
    const step = shopPath(shop.slug, "check-in", "walk-in", tripId);
    redirect(notice === undefined ? step : noticeUrl(step, notice));
  }
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const trips = await listWalkInTrips(db, shop.id);
  const banner = noticeFromParam(notice, NOTICE_KEYS);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("checkIn.walkIn.eyebrow")}
        title={t("checkIn.walkIn.title")}
        description={t("checkIn.walkIn.description")}
      />
      <Link
        href={`/shop/${shopSlug}/check-in`}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t("checkIn.walkIn.backToQueue")}
      </Link>

      {banner ? (
        <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)} className="mt-6">
          {t(banner.key)}
        </ShopNotice>
      ) : null}

      <div className="mt-6">
        <SectionCard title={t("checkIn.walkIn.tripLabel")} padding="lg">
          {trips.length === 0 ? (
            // The copy already names the schedule as where to look; this is
            // the link that sentence was describing.
            <EmptyState className="mt-2">
              <p className="mx-auto max-w-md text-sm text-muted">{t("checkIn.walkIn.tripEmpty")}</p>
              <Link
                href={`/shop/${shopSlug}/schedule/board`}
                className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
              >
                {t("checkIn.walkIn.tripEmptyAction")}
              </Link>
            </EmptyState>
          ) : (
            <TripPickerList
              className="mt-3"
              options={trips.map((trip) => ({
                id: trip.tripId,
                href: `${self}/${trip.tripId}`,
                // JSX rather than template literals, for the same reason the
                // Add-booking picker keeps its own: text is shaped per DOM text
                // node, so joining these into single strings re-kerns across the
                // old node boundaries and shifts glyphs sub-pixel.
                label: (
                  <>
                    {trip.title} ·{" "}
                    {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                  </>
                ),
                // A string, unlike `label` above: the same node-joining shifts
                // these two numbers sub-pixel, but writing them as JSX puts a
                // bare "/" text node in a component, which `pnpm check:copy`
                // rightly refuses. Two digits of sub-pixel shaping is the
                // cheaper side of that trade.
                meta: `${trip.booked}/${trip.capacity}`,
              }))}
            />
          )}
        </SectionCard>
      </div>
    </main>
  );
}
