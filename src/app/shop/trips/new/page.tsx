import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createTrip, getShopById } from "@/db/queries";
import { requireStaffSession } from "@/lib/session";
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
});

async function scheduleTrip(formData: FormData) {
  "use server";
  const session = await requireStaffSession();

  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/shop/trips/new?error=invalid");
  const { title, description, date, startTime, endTime, capacity } = parsed.data;

  const startWall = parseWallTime(date, startTime);
  const endWall = parseWallTime(date, endTime);
  if (!startWall || !endWall) redirect("/shop/trips/new?error=invalid");

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect("/shop/trips/new?error=invalid");

  const startsAt = wallTimeToUtc(startWall, shop.timezone);
  const endsAt = wallTimeToUtc(endWall, shop.timezone);
  if (endsAt <= startsAt) redirect("/shop/trips/new?error=end-before-start");

  await createTrip(db, {
    shopId: shop.id,
    title,
    description: description || undefined,
    startsAt,
    endsAt,
    capacity,
  });
  redirect(`/shop?created=${encodeURIComponent(title)}`);
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Something didn't parse — check the fields and try again.",
  "end-before-start": "The trip has to end after it starts — check the times.",
};

export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireStaffSession();
  const { error } = await searchParams;
  const message = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <Link href="/shop" className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Schedule a trip</h1>
      <p className="mt-1 text-muted">Times are local to the shop.</p>

      {message ? (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {message}
        </p>
      ) : null}

      <form action={scheduleTrip} className="mt-8 flex flex-col gap-5">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title
          <input
            name="title"
            type="text"
            required
            maxLength={120}
            placeholder="Two-Tank Reef — Molasses & French"
            className="rounded-lg border border-border bg-background px-3 py-2 text-base font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Description <span className="font-normal text-muted">(optional)</span>
          <textarea
            name="description"
            rows={2}
            maxLength={500}
            placeholder="Sites, conditions, who it's for, required certs."
            className="rounded-lg border border-border bg-background px-3 py-2 text-base font-normal"
          />
        </label>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Date
            <input
              name="date"
              type="date"
              required
              className="rounded-lg border border-border bg-background px-3 py-2 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Departs
            <input
              name="startTime"
              type="time"
              required
              className="rounded-lg border border-border bg-background px-3 py-2 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Returns
            <input
              name="endTime"
              type="time"
              required
              className="rounded-lg border border-border bg-background px-3 py-2 text-base font-normal"
            />
          </label>
        </div>
        <label className="flex w-full flex-col gap-1 text-sm font-medium sm:w-40">
          Capacity
          <input
            name="capacity"
            type="number"
            required
            min={1}
            max={60}
            defaultValue={12}
            className="rounded-lg border border-border bg-background px-3 py-2 text-base font-normal tabular-nums"
          />
        </label>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
          >
            Put it on the board
          </button>
          <Link href="/shop" className="text-sm font-medium text-muted hover:text-foreground">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
