import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { createTrip, createTripSeries } from "@/db/trips";
import { revalidateAndRedirect } from "@/lib/navigation";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import {
  MAX_SERIES_OCCURRENCES,
  MIN_SERIES_OCCURRENCES,
  weeklyOccurrences,
} from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

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

  // The times must be a coherent single day before we shift them across weeks;
  // every occurrence inherits this same wall-clock start/end.
  const startsAt = wallTimeToUtc(startWall, shop.timezone);
  const endsAt = wallTimeToUtc(endWall, shop.timezone);
  if (endsAt <= startsAt)
    redirect(`/shop/${session.user.shopSlug}/trips/new?error=end-before-start`);

  const dives = tripDiveDraftsFromForm(formData, plannedDives);
  const priceCents = priceDollars === undefined ? null : Math.round(priceDollars * 100);
  const depositCents = depositDollars === undefined ? null : Math.round(depositDollars * 100);
  const cancellationWindowHoursValue = cancellationWindowHours ?? null;
  const shopHref = `/shop/${session.user.shopSlug}`;

  if (repeatIntervalWeeks > 0) {
    const occurrenceWalls = weeklyOccurrences(
      { start: startWall, end: endWall },
      {
        frequency: "weekly",
        intervalWeeks: repeatIntervalWeeks,
        occurrenceCount: repeatCount ?? 8,
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
      occurrences: occurrenceWalls.map((occurrence) => ({
        startsAt: wallTimeToUtc(occurrence.start, shop.timezone),
        endsAt: wallTimeToUtc(occurrence.end, shop.timezone),
      })),
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
    endsAt,
    capacity,
    plannedDives,
    dives,
    priceCents,
    depositCents,
    cancellationWindowHours: cancellationWindowHoursValue,
  });
  if (!created) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
  revalidateAndRedirect(shopHref, `${shopHref}?created=${encodeURIComponent(title)}`);
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That didn't save — check the date, times, and capacity, then try again.",
  "end-before-start": "The trip has to end after it starts — check the times.",
};

export default async function NewTripPage({
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
  const [courseList, diveSiteList] = await Promise.all([
    listActiveCourses(db, session.user.shopId),
    listDiveSites(db, session.user.shopId),
  ]);
  const selectedCourse = courseList.find((course) => course.id === selectedCourseId);
  const message = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        title="Schedule a trip or course session"
        description="Times are local to the shop. Course sessions inherit their admission rules when you put them on the board."
      />

      {message ? (
        <ShopNotice tone="danger" role="alert">
          {message}
        </ShopNotice>
      ) : null}

      <form action={scheduleTrip} className="mt-8 flex flex-col gap-5">
        <FieldGrid columns={1} className="gap-y-5">
          <Field
            label="Course"
            hint="(optional)"
            description={
              selectedCourse ? (
                <>
                  {selectedCourse.minimumCertificationLevel
                    ? `${CERTIFICATION_LEVEL_LABELS[selectedCourse.minimumCertificationLevel]} card required at enrollment`
                    : "No existing C-card required"}
                  {" · add an instructor before sharing the session"}
                </>
              ) : undefined
            }
          >
            <select
              name="courseId"
              defaultValue={selectedCourse?.id ?? ""}
              className={controlClass}
            >
              <option value="">Ordinary charter / trip</option>
              {courseList.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input
              name="title"
              type="text"
              required
              maxLength={120}
              placeholder={
                selectedCourse
                  ? `${selectedCourse.title} — Session 1`
                  : "Two-Tank Reef — Molasses & French"
              }
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <TripDiveFields
          diveSites={diveSiteList.map((site) => ({ id: site.id, name: site.name }))}
        />
        <FieldGrid columns={1}>
          <Field label="Description" hint="(optional)">
            <textarea
              name="description"
              rows={2}
              maxLength={500}
              placeholder="Sites, conditions, who it's for, required certs."
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={3} className="gap-y-5">
          <Field label="Date">
            <input name="date" type="date" required className={controlClass} />
          </Field>
          <Field label="Departs">
            <input name="startTime" type="time" required className={controlClass} />
          </Field>
          <Field label="Returns">
            <input name="endTime" type="time" required className={controlClass} />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1} className="sm:w-40">
          <Field label="Capacity">
            <input
              name="capacity"
              type="number"
              required
              min={1}
              max={60}
              defaultValue={12}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
        </FieldGrid>
        {/* The field is narrow; its helper text is not, so only the input is capped. */}
        <FieldGrid columns={1}>
          <Field
            label="Price per diver"
            hint="(optional)"
            description="Pre-fills the trip fee when staff invoice a diver from this trip's roster."
          >
            <input
              name="priceDollars"
              type="number"
              step="0.01"
              min={0}
              placeholder="$0.00"
              className={`${controlClass} tabular-nums sm:w-40`}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border bg-surface p-5">
          <legend className="px-1 text-sm font-medium">Pay at booking</legend>
          <p className="text-sm text-muted">
            Optional. When the trip is priced and the shop takes card payments, divers pay online as
            they book. Leave the deposit blank to charge the full fare up front.
          </p>
          <FieldGrid columns={2} className="mt-4 gap-x-5 gap-y-5">
            <Field
              label="Deposit per diver"
              hint="(optional)"
              description="Charged now; the balance is still owed at the dock. Ignored if it's blank or not below the price."
            >
              <input
                name="depositDollars"
                type="number"
                step="0.01"
                min={0}
                placeholder="$0.00"
                className={`${controlClass} tabular-nums sm:w-40`}
              />
            </Field>
            <Field
              label="Free cancellation window"
              hint="(optional)"
              description="Hours before departure a diver can cancel for a refund. Shown to divers; refunds stay staff-run."
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
                <span className="text-sm text-muted">hours</span>
              </div>
            </Field>
          </FieldGrid>
        </fieldset>
        <fieldset className="rounded-lg border border-border bg-surface p-5">
          <legend className="px-1 text-sm font-medium">Repeat</legend>
          <p className="text-sm text-muted">
            Put the same trip on the board for several weeks at once. Each date is created as its
            own trip — book, crew, and edit them one at a time.
          </p>
          <FieldGrid columns={2} className="mt-4 gap-y-5">
            <Field label="How often">
              <select name="repeatIntervalWeeks" defaultValue="0" className={controlClass}>
                <option value="0">Doesn't repeat</option>
                <option value="1">Every week</option>
                <option value="2">Every 2 weeks</option>
                <option value="4">Every 4 weeks</option>
              </select>
            </Field>
            <Field
              label="Number of trips"
              description={`Up to ${MAX_SERIES_OCCURRENCES}, counting the first. Ignored when it doesn't repeat.`}
            >
              <input
                name="repeatCount"
                type="number"
                min={MIN_SERIES_OCCURRENCES}
                max={MAX_SERIES_OCCURRENCES}
                defaultValue={8}
                className={`${controlClass} tabular-nums`}
              />
            </Field>
          </FieldGrid>
        </fieldset>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            className={buttonClass({ size: "lg", className: "rounded-xl text-base" })}
          >
            Put it on the board
          </button>
          <Link
            href={`/shop/${shopSlug}`}
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
