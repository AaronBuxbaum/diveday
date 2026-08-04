import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
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

export const metadata: Metadata = {
  title: "Add a booking — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * Refusals, in the trip page's vocabulary — the same codes and mostly the same
 * words the Guests tab uses, because this door is that tab's add-a-diver
 * section with the departure chosen a step earlier. Success never lands here:
 * a seated diver goes to the trip's Guests tab with the roster's own toast
 * (`SEAT_SURFACES["new-booking"]`, src/app/actions/seat-diver-surfaces.ts).
 */
const NOTICE_KEYS: Record<string, { tone: "danger"; key: StaffMessageKey }> = {
  // Its own words, not the Guests tab's: that one asks for "a name and a valid
  // email", which is true there and false here — this door takes the no-email
  // diver the counter always could.
  "diver-invalid": { tone: "danger", key: "bookings.new.noticeInvalid" },
  "diver-full": { tone: "danger", key: "trips.notices.diverFull" },
  "diver-already": { tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": { tone: "danger", key: "trips.notices.diverCourseUnstaffed" },
  "diver-course-prerequisite": { tone: "danger", key: "trips.notices.diverCoursePrerequisite" },
  "diver-course-ratio-full": { tone: "danger", key: "trips.notices.diverCourseRatioFull" },
  "diver-course-min-age": { tone: "danger", key: "trips.notices.diverCourseMinAge" },
  "diver-trip-prerequisite": { tone: "danger", key: "trips.notices.diverTripPrerequisite" },
  "diver-unavailable": { tone: "danger", key: "trips.notices.diverUnavailable" },
};

/**
 * The global "Add a booking" door, step two: who is taking the seat?
 *
 * Same two halves as the counter walk-in — pick a returning diver, or hand-enter
 * a new one with the email optional — submitting through the shared seat-a-diver
 * actions (src/app/actions/seat-diver.ts), so a diver seated here owes exactly
 * the consequences a diver seated at any other door does.
 *
 * The departure lives in the path rather than a `?tripId=`, which is what lets
 * a refusal bounce back here by adding only its own `?notice=` to a URL that
 * had no query. Appending a second param to an already-queried URL is the one
 * shape a server-action redirect could not land on: the client router held the
 * page it already had and the submit button span forever.
 */
export default async function NewBookingDiverPage({
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

  // Read by id, not from the picker's page of options: a departure sitting past
  // the first page is still a legitimate place to stand.
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();
  const query = diverq?.trim() ?? "";
  const candidates = await listBookableDivers(db, shop.id, trip.id, { query });
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  // The trip's own cert gate refused this diver: say *which* requirement failed
  // and what they hold, rather than the one static sentence every refusal used
  // to share (src/lib/trip-admission.ts).
  const gateRefusal =
    notice === "diver-trip-prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "trip", id: tripId })
      : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("bookings.new.eyebrow")}
        title={t("bookings.new.title")}
        description={t("bookings.new.description")}
      />
      {/* R9: step two used to point back at the board, exactly like step one —
          so a staffer who picked the wrong departure had to leave the flow and
          re-enter it. Back, here, means back one step: the departure picker.
          Step one keeps the board link, because that is what is behind it. */}
      <Link
        href={`/shop/${shopSlug}/bookings/new`}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t("bookings.new.backToPicker")}
      </Link>

      {banner ? (
        <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)} className="mt-6">
          {gateRefusal ? tripAdmissionRefusalText(t, gateRefusal, locale) : t(banner.key)}
        </ShopNotice>
      ) : null}

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <p className="text-xs font-bold tracking-wide text-muted uppercase">
          {t("bookings.new.tripHeading")}
        </p>
        <p className="mt-1 font-semibold">
          {t("bookings.new.tripSummary", {
            title: trip.title,
            date: formatShortDate(trip.startsAt, locale, shop.timezone),
            time: formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone),
            booked: trip.booked,
            capacity: trip.capacity,
          })}
        </p>
        <Link
          href={`/shop/${shopSlug}/bookings/new`}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        >
          {t("bookings.new.changeTrip")}
        </Link>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">{t("bookings.new.findHeading")}</h2>
        {/* Server-fed search, same shape as the walk-in counter and the Guests
            tab: a GET reload carries `diverq`, no client state. */}
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <Field label={t("bookings.new.findLabel")} className="min-w-0 flex-1">
            <input
              type="search"
              name="diverq"
              defaultValue={query}
              placeholder={t("bookings.new.findPlaceholder")}
              maxLength={120}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
          <SubmitButton
            pendingLabel={t("bookings.new.searching")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("bookings.new.search")}
          </SubmitButton>
        </form>

        {query ? (
          candidates.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {candidates.map(({ person }) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/shop/${shopSlug}/divers/${person.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {person.fullName}
                    </Link>
                    <p className="text-sm text-muted">
                      {person.email ?? t("bookings.new.noEmailOnFile")}
                    </p>
                  </div>
                  <form action={seatExistingDiverAction.bind(null, "new-booking", shopSlug)}>
                    <input type="hidden" name="tripId" value={trip.id} />
                    <input type="hidden" name="personId" value={person.id} />
                    <SubmitButton
                      pendingLabel={t("bookings.new.adding")}
                      ariaLabel={t("bookings.new.addPersonAriaLabel", { name: person.fullName })}
                      className={buttonClass({ size: "sm" })}
                    >
                      {t("bookings.new.addToTrip")}
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            // The shared empty box, with the sentence's "below" as a real door
            // down to the hand-entry form.
            <EmptyState className="mt-4">
              <h3 className="font-medium">{t("bookings.new.noMatchesHeading")}</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                {t("bookings.new.noMatches", { query })}
              </p>
              <a
                href="#hand-entry"
                className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
              >
                {t("bookings.new.noMatchesAction")}
              </a>
            </EmptyState>
          )
        ) : null}
      </section>

      <section
        id="hand-entry"
        className="mt-6 scroll-mt-24 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6"
      >
        <h2 className="text-lg font-semibold">{t("bookings.new.handEntryHeading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("bookings.new.handEntryDescription")}</p>
        <form action={seatNewDiverAction.bind(null, "new-booking", shopSlug)} className="mt-4">
          <input type="hidden" name="tripId" value={trip.id} />
          <FieldGrid columns={3}>
            <Field label={t("bookings.new.nameLabel")}>
              <input
                name="fullName"
                required
                maxLength={120}
                autoComplete="name"
                className={controlClass}
              />
            </Field>
            <Field label={t("bookings.new.emailLabel")} hint={t("bookings.new.optionalHint")}>
              <input
                name="email"
                type="email"
                maxLength={200}
                autoComplete="email"
                className={controlClass}
              />
            </Field>
            <Field label={t("bookings.new.phoneLabel")} hint={t("bookings.new.optionalHint")}>
              <input
                name="phone"
                type="tel"
                maxLength={30}
                autoComplete="tel"
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <FieldActions className="mt-4">
            <SubmitButton pendingLabel={t("bookings.new.adding")} className={buttonClass()}>
              {t("bookings.new.addToTrip")}
            </SubmitButton>
          </FieldActions>
        </form>
      </section>
    </main>
  );
}
