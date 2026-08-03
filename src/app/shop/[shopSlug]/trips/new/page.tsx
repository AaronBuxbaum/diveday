import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { createTrip, createTripSeries } from "@/db/trips";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import {
  currencyFractionDigits,
  MAX_PRICE_MINOR_UNITS,
  majorToMinor,
  maxPriceMajor,
  toShopCurrency,
} from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import {
  MAX_SERIES_OCCURRENCES,
  MIN_SERIES_OCCURRENCES,
  weeklyOccurrences,
} from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS, tripMeetingDays } from "@/lib/trip-days";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { parseWallTime, type WallTime, wallTimeToUtc } from "@/lib/zoned";
import { RepeatFields } from "./_components/RepeatFields";

export const metadata: Metadata = {
  title: "Schedule a trip — DiveDay",
};

const formSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
  plannedDives: z.coerce.number().int().min(1).max(4),
  // A departure that meets on consecutive days is one trip, not a week of
  // look-alikes: one roster, one set of waivers, one crew (src/lib/trip-days.ts).
  dayCount: z.preprocess(
    (value) => (value === "" || value === undefined ? MIN_TRIP_DAYS : value),
    z.coerce.number().int().min(MIN_TRIP_DAYS).max(MAX_TRIP_DAYS),
  ),
  priceDollars: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().nonnegative().finite().optional(),
  ),
  depositDollars: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().nonnegative().finite().optional(),
  ),
  cancellationWindowHours: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(720).optional(),
  ),
  courseId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  // "0" means it does not repeat; any other value is the number of weeks between instances.
  repeatIntervalWeeks: z.preprocess(
    (value) => (value === "" || value === undefined ? "0" : value),
    z.coerce.number().int().min(0).max(8),
  ),
  repeatCount: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(MIN_SERIES_OCCURRENCES).max(MAX_SERIES_OCCURRENCES).optional(),
  ),
});

async function scheduleTrip(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  // Defining a trip is owner/manager/instructor work (H-14, ADR
  // 20260724-role-authorization), re-checked against live roles.
  if (!(await canPersonConfigureTrips(await getDb(), session.user.shopId, session.user.personId))) {
    revalidateAndRedirect(
      `/shop/${session.user.shopSlug}/trips/new`,
      `/shop/${session.user.shopSlug}/trips/new?error=not-authorized`,
    );
    return;
  }

  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
  const {
    title,
    description,
    date,
    startTime,
    endTime,
    capacity,
    plannedDives,
    dayCount,
    priceDollars,
    depositDollars,
    cancellationWindowHours,
    courseId,
    repeatIntervalWeeks,
    repeatCount,
  } = parsed.data;

  const startWall = parseWallTime(date, startTime);
  const endWall = parseWallTime(date, endTime);
  if (!startWall || !endWall) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);

  // The times must be a coherent single day before we shift them across days
  // or weeks; every meeting day and every occurrence inherits this same
  // wall-clock start/end.
  const startsAt = wallTimeToUtc(startWall, shop.timezone);
  const endsAt = wallTimeToUtc(endWall, shop.timezone);
  if (endsAt <= startsAt)
    redirect(`/shop/${session.user.shopSlug}/trips/new?error=end-before-start`);

  /**
   * One departure's meeting days, converted day by day through the shop's own
   * zone. Day-by-day rather than a single offset because a multi-day trip can
   * straddle a DST change, and what a shop promises is the wall-clock time —
   * "back at the dock at 12:30" on both days.
   */
  const meetingDaysFrom = (day: { start: WallTime; end: WallTime }) => {
    const days = tripMeetingDays(day, dayCount);
    if (!days) return null;
    return days.map((meeting, index) => ({
      dayNumber: index + 1,
      startsAt: wallTimeToUtc(meeting.start, shop.timezone),
      endsAt: wallTimeToUtc(meeting.end, shop.timezone),
    }));
  };
  const scheduleDays = meetingDaysFrom({ start: startWall, end: endWall });
  if (!scheduleDays) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
  // The trip itself spans its first day's departure to its last day's return,
  // so every "is it over?" question in the app — sailed guards, the board's
  // upcoming window, calendar feeds — sees the whole departure.
  const lastDay = scheduleDays[scheduleDays.length - 1];
  if (!lastDay) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);

  const dives = tripDiveDraftsFromForm(formData, plannedDives);
  // The shop's currency decides the multiplier: 5000 in a JPY shop's price
  // box is ¥5,000 and stores 5000, not a hundredfold ¥500,000.
  const currency = toShopCurrency(shop.currency);
  const priceCents = priceDollars === undefined ? null : majorToMinor(priceDollars, currency);
  const depositCents = depositDollars === undefined ? null : majorToMinor(depositDollars, currency);
  // Same ceiling every other price validator applies — see the matching check
  // in `trips/[id]/actions.ts`.
  if (
    (priceCents !== null && priceCents > MAX_PRICE_MINOR_UNITS) ||
    (depositCents !== null && depositCents > MAX_PRICE_MINOR_UNITS)
  ) {
    redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
  }
  const cancellationWindowHoursValue = cancellationWindowHours ?? null;
  const shopHref = `/shop/${session.user.shopSlug}`;

  if (repeatIntervalWeeks > 0) {
    // No fallback count: the form asks for one and requires it the moment a
    // cadence is picked, so an absent count here is a malformed submission,
    // not a shop that meant "eight".
    if (repeatCount === undefined) {
      redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
    }
    const occurrenceWalls = weeklyOccurrences(
      { start: startWall, end: endWall },
      {
        frequency: "weekly",
        intervalWeeks: repeatIntervalWeeks,
        occurrenceCount: repeatCount,
      },
    );
    if (!occurrenceWalls) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
    const series = await createTripSeries(db, {
      shopId: shop.id,
      courseId,
      title,
      description: description || undefined,
      capacity,
      plannedDives,
      dives,
      priceCents,
      depositCents,
      cancellationWindowHours: cancellationWindowHoursValue,
      frequency: "weekly",
      intervalWeeks: repeatIntervalWeeks,
      occurrences: occurrenceWalls.map((occurrence) => {
        const days = meetingDaysFrom(occurrence);
        const last = days?.at(-1);
        return {
          startsAt: wallTimeToUtc(occurrence.start, shop.timezone),
          endsAt: last ? last.endsAt : wallTimeToUtc(occurrence.end, shop.timezone),
          scheduleDays: days ?? undefined,
        };
      }),
    });
    if (!series) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
    revalidateAndRedirect(
      shopHref,
      `${shopHref}?created=${encodeURIComponent(title)}&series=${series.trips.length}`,
    );
  }

  const created = await createTrip(db, {
    shopId: shop.id,
    courseId,
    title,
    description: description || undefined,
    startsAt,
    endsAt: lastDay.endsAt,
    capacity,
    plannedDives,
    dives,
    priceCents,
    depositCents,
    cancellationWindowHours: cancellationWindowHoursValue,
    scheduleDays,
  });
  if (!created) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
  revalidateAndRedirect(shopHref, `${shopHref}?created=${encodeURIComponent(title)}`);
}

const ERROR_KEYS: Record<string, StaffMessageKey> = {
  invalid: "trips.new.errorInvalid",
  "end-before-start": "trips.new.errorEndBeforeStart",
  "not-authorized": "trips.new.errorNotAuthorized",
};

// Not `instant = false`, which (per
// node_modules/next/dist/docs/.../instant.md) is a dev-time validation
// opt-out only and has no effect on production rendering. Without a real
// Suspense boundary, this route still gets a Partial-Prerendered static
// shell with an implicit dynamic hole around the unwrapped
// `searchParams`/session reads — and a `redirect(...?error=...)` fired from
// the form's own submission raced that hole's own pending fetch (same class
// of bug fixed on /sign-in and /shop/[shopSlug]/dive-sites/new). An explicit
// boundary here makes the dynamic part exactly what streams in on redirect.
export default function NewTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ error?: string; course?: string }>;
}) {
  return (
    <Suspense
      fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10" />}
    >
      <NewTripBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function NewTripBody({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ error?: string; course?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { error, course: selectedCourseId } = await searchParams;
  const db = await getDb();
  const [courseList, diveSiteList, canConfigure, shop] = await Promise.all([
    listActiveCourses(db, session.user.shopId),
    listDiveSites(db, session.user.shopId),
    canPersonConfigureTrips(db, session.user.shopId, session.user.personId),
    getShopById(db, session.user.shopId),
  ]);
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  // Both price boxes follow the shop's currency: whole-number entry and a
  // symbol-only placeholder for a zero-decimal currency, where "$0.00" was
  // wrong twice over.
  const shopCurrency = toShopCurrency(shop?.currency);
  const priceDigits = currencyFractionDigits(shopCurrency);
  const priceStep = priceDigits === 0 ? "1" : `0.${"0".repeat(priceDigits - 1)}1`;
  const pricePlaceholder = formatMoneyCents(0, shopCurrency, locale);
  const selectedCourse = courseList.find((course) => course.id === selectedCourseId);
  const message = error && Object.hasOwn(ERROR_KEYS, error) ? t(ERROR_KEYS[error]) : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("trips.new.eyebrow")}
        title={t("trips.new.title")}
        description={t("trips.new.description")}
      />

      {message ? (
        <ShopNotice tone="danger" role="alert">
          {message}
        </ShopNotice>
      ) : null}

      {canConfigure ? null : (
        <div className="mt-8">
          <ShopNotice tone="neutral" role="status">
            {t("trips.new.viewOnlyNotice")}
          </ShopNotice>
        </div>
      )}

      {canConfigure ? (
        <form action={scheduleTrip} className="mt-8 flex flex-col gap-5">
          <FieldGrid columns={1} className="gap-y-5">
            <Field
              label={t("trips.new.courseLabel")}
              hint={t("trips.new.optionalHint")}
              description={
                selectedCourse
                  ? t("trips.new.courseDescription", {
                      requirement: selectedCourse.minimumCertificationLevel
                        ? t("trips.new.courseCertRequired", {
                            level: t(
                              CERTIFICATION_LEVEL_KEYS[selectedCourse.minimumCertificationLevel],
                            ),
                          })
                        : t("trips.new.courseNoCardRequired"),
                    })
                  : undefined
              }
            >
              <select
                name="courseId"
                defaultValue={selectedCourse?.id ?? ""}
                className={controlClass}
              >
                <option value="">{t("trips.new.ordinaryTrip")}</option>
                {courseList.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("trips.new.titleLabel")}>
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                placeholder={
                  selectedCourse
                    ? t("trips.new.titlePlaceholderCourse", { courseTitle: selectedCourse.title })
                    : t("trips.new.titlePlaceholderExample")
                }
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <TripDiveFields
            diveSites={diveSiteList.map((site) => ({ id: site.id, name: site.name }))}
            copy={{
              heading: t("shared.tripDiveFields.heading"),
              description: t("shared.tripDiveFields.description"),
              twoTankTrip: t("shared.tripDiveFields.twoTankTrip"),
              diveCountTrip: t("shared.tripDiveFields.diveCountTrip"),
              numberOfDivesLabel: t("shared.tripDiveFields.numberOfDivesLabel"),
              diveOptionOne: t("shared.tripDiveFields.diveOptionOne"),
              diveOptionOther: t("shared.tripDiveFields.diveOptionOther"),
              diveLegend: t("shared.tripDiveFields.diveLegend"),
              nameLabel: t("shared.tripDiveFields.nameLabel"),
              optionalHint: t("shared.tripDiveFields.optionalHint"),
              namePlaceholderFirst: t("shared.tripDiveFields.namePlaceholderFirst"),
              namePlaceholderOther: t("shared.tripDiveFields.namePlaceholderOther"),
              diveSiteLabel: t("shared.tripDiveFields.diveSiteLabel"),
              noSiteChosen: t("shared.tripDiveFields.noSiteChosen"),
              diverFacingDetailsLabel: t("shared.tripDiveFields.diverFacingDetailsLabel"),
              detailsPlaceholder: t("shared.tripDiveFields.detailsPlaceholder"),
              footerNote: t("shared.tripDiveFields.footerNote"),
            }}
          />
          <FieldGrid columns={1}>
            <Field label={t("trips.new.descriptionLabel")} hint={t("trips.new.optionalHint")}>
              <textarea
                name="description"
                rows={2}
                maxLength={500}
                placeholder={t("trips.new.descriptionPlaceholder")}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <FieldGrid columns={3} className="gap-y-5">
            <Field label={t("trips.new.dateLabel")}>
              <input name="date" type="date" required className={controlClass} />
            </Field>
            <Field label={t("trips.new.departsLabel")}>
              <input name="startTime" type="time" required className={controlClass} />
            </Field>
            <Field label={t("trips.new.returnsLabel")}>
              <input name="endTime" type="time" required className={controlClass} />
            </Field>
          </FieldGrid>
          <FieldGrid columns={2} className="gap-x-5 gap-y-5">
            <Field label={t("trips.new.capacityLabel")}>
              <input
                name="capacity"
                type="number"
                required
                min={1}
                max={60}
                defaultValue={12}
                className={`${controlClass} tabular-nums sm:w-40`}
              />
            </Field>
            {/* A course weekend or a liveaboard is one departure that meets on
                consecutive days — one roster, one set of waivers, one crew —
                and until this box existed the only way to put one on the board
                was several unrelated trips sharing a title. */}
            <Field
              label={t("trips.new.dayCountLabel")}
              description={t("trips.new.dayCountDescription")}
            >
              <input
                name="dayCount"
                type="number"
                required
                min={MIN_TRIP_DAYS}
                max={MAX_TRIP_DAYS}
                defaultValue={MIN_TRIP_DAYS}
                className={`${controlClass} tabular-nums sm:w-40`}
              />
            </Field>
          </FieldGrid>
          {/* The field is narrow; its helper text is not, so only the input is capped. */}
          <FieldGrid columns={1}>
            <Field
              label={t("trips.new.priceLabel")}
              hint={t("trips.new.optionalHint")}
              description={t("trips.new.priceDescription")}
            >
              <input
                name="priceDollars"
                type="number"
                step={priceStep}
                min={0}
                max={maxPriceMajor(shopCurrency)}
                placeholder={pricePlaceholder}
                className={`${controlClass} tabular-nums sm:w-40`}
              />
            </Field>
          </FieldGrid>
          <fieldset className="rounded-lg border border-border bg-surface p-5">
            <legend className="px-1 text-sm font-medium">
              {t("trips.new.payAtBookingLegend")}
            </legend>
            <p className="text-sm text-muted">{t("trips.new.payAtBookingDescription")}</p>
            <FieldGrid columns={2} className="mt-4 gap-x-5 gap-y-5">
              <Field
                label={t("trips.new.depositLabel")}
                hint={t("trips.new.optionalHint")}
                description={t("trips.new.depositDescription")}
              >
                <input
                  name="depositDollars"
                  type="number"
                  step={priceStep}
                  min={0}
                  max={maxPriceMajor(shopCurrency)}
                  placeholder={pricePlaceholder}
                  title={t("trips.new.depositTitle")}
                  className={`${controlClass} tabular-nums sm:w-40`}
                />
              </Field>
              <Field
                label={t("trips.new.cancellationWindowLabel")}
                hint={t("trips.new.optionalHint")}
                description={t("trips.new.cancellationWindowDescription")}
              >
                <div className="flex items-center gap-2">
                  <input
                    name="cancellationWindowHours"
                    type="number"
                    step={1}
                    min={0}
                    max={720}
                    placeholder="48"
                    className={`${controlClass} tabular-nums sm:w-28`}
                  />
                  <span className="text-sm text-muted">{t("trips.new.hoursSuffix")}</span>
                </div>
              </Field>
            </FieldGrid>
          </fieldset>
          <fieldset className="rounded-lg border border-border bg-surface p-5">
            <legend className="px-1 text-sm font-medium">{t("trips.new.repeatLegend")}</legend>
            <p className="text-sm text-muted">{t("trips.new.repeatDescription")}</p>
            <RepeatFields
              minOccurrences={MIN_SERIES_OCCURRENCES}
              maxOccurrences={MAX_SERIES_OCCURRENCES}
              copy={{
                howOftenLabel: t("trips.new.howOftenLabel"),
                doesntRepeat: t("trips.new.doesntRepeat"),
                everyWeek: t("trips.new.everyWeek"),
                every2Weeks: t("trips.new.every2Weeks"),
                every4Weeks: t("trips.new.every4Weeks"),
                numberOfTripsLabel: t("trips.new.numberOfTripsLabel"),
                numberOfTripsDescription: t("trips.new.numberOfTripsDescription", {
                  max: MAX_SERIES_OCCURRENCES,
                }),
                numberOfTripsPlaceholder: t("trips.new.numberOfTripsPlaceholder"),
              }}
            />
          </fieldset>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              className={buttonClass({ size: "lg", className: "rounded-xl text-base" })}
            >
              {t("trips.new.putOnBoard")}
            </button>
            <Link
              href={`/shop/${shopSlug}`}
              className="text-sm font-medium text-muted hover:text-foreground"
            >
              {t("trips.new.cancel")}
            </Link>
          </div>
        </form>
      ) : null}
    </main>
  );
}
