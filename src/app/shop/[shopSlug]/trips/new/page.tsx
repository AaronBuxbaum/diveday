import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { TripDiveFields } from "@/components/TripDiveFields";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { createTrip, getShopById } from "@/db/queries";
import { revalidateAndRedirect } from "@/lib/navigation";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

export const metadata: Metadata = {
  title: "Schedule a trip — Scuba",
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
  courseId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
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
    courseId,
  } = parsed.data;

  const startWall = parseWallTime(date, startTime);
  const endWall = parseWallTime(date, endTime);
  if (!startWall || !endWall) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);

  const startsAt = wallTimeToUtc(startWall, shop.timezone);
  const endsAt = wallTimeToUtc(endWall, shop.timezone);
  if (endsAt <= startsAt)
    redirect(`/shop/${session.user.shopSlug}/trips/new?error=end-before-start`);

  const created = await createTrip(db, {
    shopId: shop.id,
    courseId,
    title,
    description: description || undefined,
    startsAt,
    endsAt,
    capacity,
    plannedDives,
    dives: tripDiveDraftsFromForm(formData, plannedDives),
    priceCents: priceDollars === undefined ? null : Math.round(priceDollars * 100),
  });
  if (!created) redirect(`/shop/${session.user.shopSlug}/trips/new?error=invalid`);
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}`,
    `/shop/${session.user.shopSlug}?created=${encodeURIComponent(title)}`,
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That didn't save — check the date, times, and capacity, then try again.",
  "end-before-start": "The trip has to end after it starts — check the times.",
};

const inputClass =
  "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

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
        <label className="flex flex-col gap-1 text-sm font-medium">
          Course <span className="font-normal text-muted">(optional)</span>
          <select name="courseId" defaultValue={selectedCourse?.id ?? ""} className={inputClass}>
            <option value="">Ordinary charter / trip</option>
            {courseList.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
          {selectedCourse ? (
            <span className="mt-1 text-sm font-normal text-muted">
              {selectedCourse.minimumCertificationLevel
                ? `${CERTIFICATION_LEVEL_LABELS[selectedCourse.minimumCertificationLevel]} card required at enrollment`
                : "No existing C-card required"}
              {selectedCourse.requiresInstructor
                ? " · add an instructor before sharing the session"
                : ""}
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title
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
            className={inputClass}
          />
        </label>
        <TripDiveFields
          diveSites={diveSiteList.map((site) => ({ id: site.id, name: site.name }))}
        />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Description <span className="font-normal text-muted">(optional)</span>
          <textarea
            name="description"
            rows={2}
            maxLength={500}
            placeholder="Sites, conditions, who it's for, required certs."
            className={inputClass}
          />
        </label>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Date
            <input name="date" type="date" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Departs
            <input name="startTime" type="time" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Returns
            <input name="endTime" type="time" required className={inputClass} />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:w-40">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Capacity
            <input
              name="capacity"
              type="number"
              required
              min={1}
              max={60}
              defaultValue={12}
              className={`${inputClass} tabular-nums`}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium sm:w-40">
          Price per diver <span className="font-normal text-muted">(optional)</span>
          <input
            name="priceDollars"
            type="number"
            step="0.01"
            min={0}
            placeholder="$0.00"
            className={`${inputClass} tabular-nums`}
          />
          <span className="mt-1 text-sm font-normal text-muted">
            Pre-fills the trip fee when staff invoice a diver from this trip's roster.
          </span>
        </label>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-primary px-5 py-2.5 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
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
