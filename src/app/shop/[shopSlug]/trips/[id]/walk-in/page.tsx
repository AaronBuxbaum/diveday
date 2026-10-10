import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SelectedTripCard } from "@/components/seat-diver/SelectedTripCard";
import { findSimilarDivers, listBookableDivers } from "@/db/divers";
import { getTripWithBooked } from "@/db/trips";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { arrivalsWindow } from "@/lib/operational-window";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, noticeRole, shopPath } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";
import { hasSailed } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { SeatDiverPanel } from "../../../_components/SeatDiverPanel";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Walk-in — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * Refusals at the counter, in the counter's own words.
 *
 * These used to be **one line for eight reasons** — "Can't add this diver to
 * that boat right now, open its trip page for the reason" — on the grounds that
 * a staffer with a queue waiting should not have to distinguish four rare
 * course gates. The brevity was right and the conclusion was not: the sentence
 * it produced does not save the staffer a decision, it sends them to a
 * different page to find out what happened, at exactly the moment they have
 * least time to go there. Naming the reason is *shorter* than that, not longer.
 *
 * The one refusal that cannot be said in a fixed sentence — the trip's own
 * cert gate — carries its structured detail in a signed `?gate=`, bound to the
 * departure in this route's own path (src/lib/trip-admission-gate.ts), so the
 * banner can say which card is missing and what this diver actually holds.
 */
const NOTICE_KEYS: Record<string, { tone: "danger" | "neutral"; key: StaffMessageKey }> = {
  "walkin-invalid": { tone: "danger", key: "checkIn.notice.walkinInvalid" },
  "walkin-full": { tone: "danger", key: "checkIn.notice.walkinFull" },
  "walkin-divers-full": { tone: "danger", key: "participants.notices.diversFull" },
  "walkin-type-unavailable": { tone: "danger", key: "participants.notices.typeUnavailable" },
  "walkin-already": { tone: "neutral", key: "checkIn.notice.walkinAlready" },
  "walkin-course-unstaffed": { tone: "danger", key: "checkIn.notice.walkinCourseUnstaffed" },
  "walkin-course-prerequisite": { tone: "danger", key: "checkIn.notice.walkinCoursePrerequisite" },
  "walkin-course-ratio-full": { tone: "danger", key: "checkIn.notice.walkinCourseRatioFull" },
  "walkin-course-min-age": { tone: "danger", key: "checkIn.notice.walkinCourseMinAge" },
  "walkin-trip-prerequisite": { tone: "danger", key: "checkIn.notice.walkinTripPrerequisite" },
  "walkin-unavailable": { tone: "danger", key: "checkIn.notice.walkinUnavailable" },
};

/**
 * A walk-in for this departure: who is taking the seat?
 *
 * Either pick a returning diver by name/email/phone or hand-enter a fresh one —
 * email optional, the crew can collect it later. The second half is
 * `SeatDiverPanel` (../../../_components), the same panel the global
 * Add-booking door stands on: that door and this one were ~85% the same markup,
 * and the email rule they differ on is read there from `SEAT_SURFACES["walk-in"]`
 * rather than hand-copied into a `required` attribute.
 *
 * A seated diver lands on this departure's Divers tab — the next row to
 * work. A *refused* one lands right back here, which is what the departure
 * being a path segment buys.
 */
export default async function WalkInDiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    diverq?: string;
    notice?: string;
    /** Signed, verified against this route's own `tripId` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
    confirmName?: string;
    confirmEmail?: string;
    confirmPhone?: string;
  }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { diverq, notice, gate, confirmName, confirmEmail, confirmPhone } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  const confirmMatches = confirmName ? await findSimilarDivers(db, shop.id, confirmName) : [];
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();
  const counter = shopPath(shopSlug, "trips", trip.id);
  // The door is drawn only while the counter is open for this boat and it has
  // not sailed; a typed URL outside that lands on the departure's Divers tab.
  const now = nowDate();
  const arrivals = arrivalsWindow(now);
  if (
    trip.startsAt < arrivals.from ||
    trip.startsAt > arrivals.to ||
    hasSailed(trip.startsAt, now)
  ) {
    redirect(counter);
  }
  const query = diverq?.trim() ?? "";
  const candidates = await listBookableDivers(db, shop.id, trip.id, { query });
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  const gateRefusal =
    notice === "walkin-trip-prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "trip", id: tripId })
      : null;

  return (
    <div className="max-w-2xl">
      {/* The way up is the boat's own Divers tab, which is where this door is. */}
      <ShopPageHeader
        eyebrow={t("trips.tabs.divers")}
        eyebrowHref={counter}
        title={t("checkIn.walkIn.title")}
      />
      {banner ? (
        <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)} className="mt-6">
          {gateRefusal ? tripAdmissionRefusalText(t, gateRefusal, locale) : t(banner.key)}
        </ShopNotice>
      ) : null}

      <SelectedTripCard
        className="mt-6"
        label={t("checkIn.walkIn.tripLabel")}
        summary={t("seatDiver.tripSummary", {
          title: trip.title,
          date: formatShortDate(trip.startsAt, locale, shop.timezone),
          time: formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone),
          booked: trip.booked,
          capacity: trip.capacity,
        })}
      />

      <SeatDiverPanel
        surface="walk-in"
        shopSlug={shopSlug}
        tripId={trip.id}
        query={query}
        candidates={candidates}
        confirmName={confirmName}
        confirmEmail={confirmEmail}
        confirmPhone={confirmPhone}
        confirmMatches={confirmMatches}
        copy={{
          findHeading: t("seatDiver.findHeading"),
          findLabel: t("seatDiver.findLabel"),
          findPlaceholder: t("seatDiver.findPlaceholder"),
          noEmailOnFile: t("seatDiver.noEmailOnFile"),
          adding: t("seatDiver.adding"),
          addLabel: t("checkIn.walkIn.addToBoat"),
          addPersonAriaLabel: (name) => t("checkIn.walkIn.addPersonAriaLabel", { name }),
          noMatchesHeading: t("seatDiver.noMatchesHeading"),
          noMatches: t("seatDiver.noMatches", { query }),
          noMatchesAction: t("seatDiver.noMatchesAction"),
          addDiver: t("seatDiver.addDiver"),
          addDiverAction: t("seatDiver.addDiverAction"),
          addDiverPrompt: t.raw("seatDiver.addDiverPrompt"),
          addNewDiverAction: t.raw("seatDiver.addNewDiverAction"),
          confirmMatchesTitle: t("divers.page.confirmMatchesTitle", { name: confirmName ?? "" }),
          confirmMatchesLastDive: (at) =>
            t("divers.page.confirmMatchesLastDive", {
              date: formatShortDate(at, locale, shop.timezone),
            }),
          confirmMatchesNoDiveDay: t("divers.page.confirmMatchesNoDiveDay"),
          confirmMatchesBorn: (dateOfBirth) =>
            t("divers.page.confirmMatchesBorn", { date: formatCalendarDate(dateOfBirth, locale) }),
          confirmMatchesSubmit: t("divers.page.confirmMatchesSubmit"),
        }}
      />
    </div>
  );
}
