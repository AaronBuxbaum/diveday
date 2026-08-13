import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SelectedTripCard } from "@/components/seat-diver/SelectedTripCard";
import { getDb } from "@/db/client";
import { listBookableDivers } from "@/db/divers";
import { getShopById } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";
import { SeatDiverPanel } from "../../../_components/SeatDiverPanel";

// `instant = true` asserts that navigating *into* this page paints
// immediately. Not a claim of a static shell: the staff shell layout declares
// `instant = false` (read its comment for why), so a cold direct visit still
// blocks on the session and shop row. What this validates is the navigation
// staff make all day — arriving from another `/shop` page, where the shell
// is already mounted. See ADR 20260804-instant-navigation.
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
  walkin_invalid: { tone: "danger", key: "checkIn.notice.walkinInvalid" },
  walkin_full: { tone: "danger", key: "checkIn.notice.walkinFull" },
  walkin_already: { tone: "neutral", key: "checkIn.notice.walkinAlready" },
  walkin_course_unstaffed: { tone: "danger", key: "checkIn.notice.walkinCourseUnstaffed" },
  walkin_course_prerequisite: { tone: "danger", key: "checkIn.notice.walkinCoursePrerequisite" },
  walkin_course_ratio_full: { tone: "danger", key: "checkIn.notice.walkinCourseRatioFull" },
  walkin_course_min_age: { tone: "danger", key: "checkIn.notice.walkinCourseMinAge" },
  walkin_trip_prerequisite: { tone: "danger", key: "checkIn.notice.walkinTripPrerequisite" },
  walkin_unavailable: { tone: "danger", key: "checkIn.notice.walkinUnavailable" },
};

/**
 * The fast counter path, step two: who is taking the seat?
 *
 * Either pick a returning diver by name/email/phone or hand-enter a fresh one —
 * email optional, the crew can collect it later. The second half is
 * `SeatDiverPanel` (../../../_components), the same panel the global
 * Add-booking door stands on: that door and this one were ~85% the same markup,
 * and the email rule they differ on is read there from `SEAT_SURFACES["walk-in"]`
 * rather than hand-copied into a `required` attribute.
 *
 * A seated diver lands on the check-in queue — the next thing to work. A
 * *refused* one lands right back here, boat still chosen, which is what the
 * departure being a path segment buys.
 */
export default async function WalkInDiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
  searchParams: Promise<{
    diverq?: string;
    notice?: string;
    /** Signed, verified against this route's own `tripId` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
  }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const session = await requireStaffSession();
  const { shopSlug, tripId } = await params;
  const { diverq, notice, gate } = await searchParams;
  const db = await getDb();
  // Scoped by the session's own shop, never the URL slug.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();
  const query = diverq?.trim() ?? "";
  const candidates = await listBookableDivers(db, shop.id, trip.id, { query });
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  const gateRefusal =
    notice === "walkin_trip_prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "trip", id: tripId })
      : null;
  const picker = `/shop/${shopSlug}/check-in/walk-in`;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("checkIn.walkIn.eyebrow")}
        title={t("checkIn.walkIn.title")}
        description={t("checkIn.walkIn.description")}
      />
      {/* Back means back one step — the boat picker — not out to the queue.
          The queue is where a *finished* walk-in lands. */}
      <Link
        href={picker}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t("checkIn.walkIn.backToPicker")}
      </Link>

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
        changeHref={picker}
        changeLabel={t("checkIn.walkIn.changeTrip")}
      />

      <SeatDiverPanel
        surface="walk-in"
        shopSlug={shopSlug}
        tripId={trip.id}
        query={query}
        candidates={candidates}
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
    </main>
  );
}
