import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SelectedTripCard } from "@/components/seat-diver/SelectedTripCard";
import { TripPickerList } from "@/components/seat-diver/TripPickerList";
import { buttonClass } from "@/components/ui/button";
import { listWalkInTrips } from "@/db/check-in";
import { getDb } from "@/db/client";
import { listBookableDivers } from "@/db/divers";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { SeatDiverPanel } from "../../_components/SeatDiverPanel";

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
 * The fast counter path: pick today's (or the next day and a half's) boat,
 * then either pick a returning diver by name/email/phone or hand-enter a
 * fresh one — email optional, the crew can collect it later. One screen,
 * no trip page detour, no required email for someone who just walked up.
 *
 * The second half is `SeatDiverPanel` (../../_components), the same panel the
 * global Add-booking door stands on: this page and that one were ~85% the same
 * markup, and the email rule they differ on is read there from
 * `SEAT_SURFACES["walk-in"]` rather than hand-copied into a `required`
 * attribute. Both halves submit through the shared seat-a-diver actions
 * (src/app/actions/seat-diver.ts) under the `"walk-in"` surface, which is what
 * keeps this page's own vocabulary — email optional, and the deliberately
 * blunt three-code refusal — a parameter rather than a second implementation
 * of everything a seating owes.
 */
export default async function WalkInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ tripId?: string; diverq?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { tripId, diverq } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== session.user.shopId) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const trips = await listWalkInTrips(db, shop.id);
  const selectedTrip = tripId ? (trips.find((trip) => trip.tripId === tripId) ?? null) : null;
  const query = diverq?.trim() ?? "";
  const candidates = selectedTrip
    ? await listBookableDivers(db, shop.id, selectedTrip.tripId, { query })
    : [];
  const self = `/shop/${shopSlug}/check-in/walk-in`;

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

      {selectedTrip ? (
        <SelectedTripCard
          className="mt-6"
          label={t("checkIn.walkIn.tripLabel")}
          summary={t("seatDiver.tripSummary", {
            title: selectedTrip.title,
            date: formatShortDate(selectedTrip.startsAt, locale, shop.timezone),
            time: formatTimeRange(
              selectedTrip.startsAt,
              selectedTrip.endsAt,
              locale,
              shop.timezone,
            ),
            booked: selectedTrip.booked,
            capacity: selectedTrip.capacity,
          })}
          changeHref={self}
          changeLabel={t("checkIn.walkIn.changeTrip")}
        />
      ) : (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold">{t("checkIn.walkIn.tripLabel")}</h2>
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
                href: `${self}?tripId=${trip.tripId}`,
                label: `${trip.title} · ${formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}`,
                meta: `${trip.booked}/${trip.capacity}`,
              }))}
            />
          )}
        </section>
      )}

      {selectedTrip ? (
        <SeatDiverPanel
          surface="walk-in"
          shopSlug={shopSlug}
          tripId={selectedTrip.tripId}
          query={query}
          candidates={candidates}
          // A GET search must keep the boat the staffer already picked.
          searchHiddenFields={{ tripId: selectedTrip.tripId }}
          copy={{
            findHeading: t("seatDiver.findHeading"),
            findLabel: t("seatDiver.findLabel"),
            findPlaceholder: t("seatDiver.findPlaceholder"),
            search: t("seatDiver.search"),
            searching: t("seatDiver.searching"),
            noEmailOnFile: t("seatDiver.noEmailOnFile"),
            adding: t("seatDiver.adding"),
            addLabel: t("checkIn.walkIn.addToBoat"),
            addPersonAriaLabel: (name) => t("checkIn.walkIn.addPersonAriaLabel", { name }),
            noMatchesHeading: t("seatDiver.noMatchesHeading"),
            noMatches: t("seatDiver.noMatches", { query }),
            noMatchesAction: t("seatDiver.noMatchesAction"),
            handEntryHeading: t("seatDiver.handEntryHeading"),
            handEntryDescription: t("checkIn.walkIn.handEntryDescription"),
            nameLabel: t("seatDiver.nameLabel"),
            emailLabel: t("seatDiver.emailLabel"),
            phoneLabel: t("seatDiver.phoneLabel"),
            optionalHint: t("seatDiver.optionalHint"),
          }}
        />
      ) : null}
    </main>
  );
}
