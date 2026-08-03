import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { listWalkInTrips } from "@/db/check-in";
import { getDb } from "@/db/client";
import { listBookableDivers } from "@/db/divers";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Walk-in — DiveDay",
};

/**
 * The fast counter path: pick today's (or the next day and a half's) boat,
 * then either pick a returning diver by name/email/phone or hand-enter a
 * fresh one — email optional, the crew can collect it later. One screen,
 * no trip page detour, no required email for someone who just walked up.
 *
 * Both halves submit through the shared seat-a-diver actions
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
        <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
          <p className="text-xs font-bold tracking-wide text-muted uppercase">
            {t("checkIn.walkIn.tripLabel")}
          </p>
          <p className="mt-1 font-semibold">
            {t("checkIn.walkIn.tripSummary", {
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
          </p>
          <Link
            href={`/shop/${shopSlug}/check-in/walk-in`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          >
            {t("checkIn.walkIn.changeTrip")}
          </Link>
        </section>
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
            <ul className="mt-3 flex flex-col gap-2">
              {trips.map((trip) => (
                <li key={trip.tripId}>
                  <Link
                    href={`/shop/${shopSlug}/check-in/walk-in?tripId=${trip.tripId}`}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-sm font-medium hover:border-primary/40"
                  >
                    <span>
                      {trip.title} ·{" "}
                      {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                    </span>
                    <span className="tabular-nums text-muted">
                      {trip.booked}/{trip.capacity}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selectedTrip ? (
        <>
          <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold">{t("checkIn.walkIn.findHeading")}</h2>
            <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="tripId" value={selectedTrip.tripId} />
              <Field label={t("checkIn.walkIn.findLabel")} className="min-w-0 flex-1">
                <input
                  type="search"
                  name="diverq"
                  defaultValue={query}
                  placeholder={t("checkIn.walkIn.findPlaceholder")}
                  maxLength={120}
                  autoComplete="off"
                  className={controlClass}
                />
              </Field>
              <SubmitButton
                pendingLabel={t("checkIn.walkIn.searching")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("checkIn.walkIn.search")}
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
                        <p className="font-medium">{person.fullName}</p>
                        <p className="text-sm text-muted">
                          {person.email ?? t("checkIn.walkIn.noEmailOnFile")}
                        </p>
                      </div>
                      <form action={seatExistingDiverAction.bind(null, "walk-in", shopSlug)}>
                        <input type="hidden" name="tripId" value={selectedTrip.tripId} />
                        <input type="hidden" name="personId" value={person.id} />
                        <SubmitButton
                          pendingLabel={t("checkIn.walkIn.adding")}
                          ariaLabel={t("checkIn.walkIn.addPersonAriaLabel", {
                            name: person.fullName,
                          })}
                          className={buttonClass({ size: "sm" })}
                        >
                          {t("checkIn.walkIn.addToBoat")}
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-4 text-center text-sm text-muted">
                  {t("checkIn.walkIn.noMatches", { query })}
                </p>
              )
            ) : null}
          </section>

          <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold">{t("checkIn.walkIn.handEntryHeading")}</h2>
            <p className="mt-1 text-sm text-muted">{t("checkIn.walkIn.handEntryDescription")}</p>
            <form action={seatNewDiverAction.bind(null, "walk-in", shopSlug)} className="mt-4">
              <input type="hidden" name="tripId" value={selectedTrip.tripId} />
              <FieldGrid columns={3}>
                <Field label={t("checkIn.walkIn.nameLabel")}>
                  <input
                    name="fullName"
                    required
                    maxLength={120}
                    autoComplete="name"
                    className={controlClass}
                  />
                </Field>
                <Field
                  label={t("checkIn.walkIn.emailLabel")}
                  hint={t("checkIn.walkIn.optionalHint")}
                >
                  <input
                    name="email"
                    type="email"
                    maxLength={200}
                    autoComplete="email"
                    className={controlClass}
                  />
                </Field>
                <Field
                  label={t("checkIn.walkIn.phoneLabel")}
                  hint={t("checkIn.walkIn.optionalHint")}
                >
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
                <SubmitButton pendingLabel={t("checkIn.walkIn.adding")} className={buttonClass()}>
                  {t("checkIn.walkIn.addToBoat")}
                </SubmitButton>
              </FieldActions>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
