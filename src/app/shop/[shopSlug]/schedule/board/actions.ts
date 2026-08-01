"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { createTrip, deleteTrip, duplicateTrip, moveTrip } from "@/db/trips";
import { trackEvent } from "@/lib/analytics";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

/* -------------------------------------------------------------------------- *
 * The schedule builder
 *
 * Four small mutations behind the staff board's inline controls: put a
 * departure on the board, slide one to another day, copy one forward, and take
 * an untouched one back off. Each is a whole edit on its own — the builder never
 * holds a half-finished draft, so a staff member who closes the tab mid-thought
 * has changed exactly what they already saved and nothing more.
 *
 * Everything deeper than "when is it and how many seats" — dives, sites,
 * requirements, crew, conditions, the roster — stays on the trip's own page.
 * The builder is the board, not a second trip editor.
 * -------------------------------------------------------------------------- */

const boardPath = (shopSlug: string) => `/shop/${shopSlug}/schedule/board`;

/**
 * Trip definition is owner/manager/instructor work (H-14, ADR
 * 20260724-role-authorization) — re-checked against live roles, never trusted
 * from the session's JWT.
 */
async function requireBoardAuthor(shopSlug: string) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonConfigureTrips(db, session.user.shopId, session.user.personId))) {
    redirect(`${boardPath(shopSlug)}?builder=not-authorized`);
  }
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(boardPath(shopSlug));
  return { session, db, shop };
}

const addSchema = z.object({
  title: z.string().trim().min(1).max(120),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
  plannedDives: z.coerce.number().int().min(1).max(4),
  courseId: z.preprocess((value) => value || undefined, z.uuid().optional()),
  diveSiteId: z.preprocess((value) => value || undefined, z.uuid().optional()),
});

export async function addDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop } = await requireBoardAuthor(shopSlug);
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  const { title, date, startTime, endTime, capacity, plannedDives, courseId, diveSiteId } =
    parsed.data;

  const startWall = parseWallTime(date, startTime);
  const endWall = parseWallTime(date, endTime);
  if (!startWall || !endWall) {
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  const startsAt = wallTimeToUtc(startWall, shop.timezone);
  const endsAt = wallTimeToUtc(endWall, shop.timezone);
  if (endsAt <= startsAt) {
    await trackEvent({
      name: "schedule_builder_action",
      action: "add",
      outcome: "end_before_start",
    });
    redirect(`${back}?builder=end-before-start`);
  }

  const created = await createTrip(db, {
    shopId: shop.id,
    courseId,
    diveSiteId,
    title,
    startsAt,
    endsAt,
    capacity,
    plannedDives,
  });
  if (!created) {
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "ok" });
  revalidateAndRedirect(back, `${back}?builder=added`);
}

const moveSchema = z.object({
  tripId: z.uuid(),
  date: z.string(),
  startTime: z.string(),
});

export async function moveDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop } = await requireBoardAuthor(shopSlug);
  const parsed = moveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await trackEvent({ name: "schedule_builder_action", action: "move", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }

  const wall = parseWallTime(parsed.data.date, parsed.data.startTime);
  if (!wall) {
    await trackEvent({ name: "schedule_builder_action", action: "move", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  const outcome = await moveTrip(
    db,
    shop.id,
    parsed.data.tripId,
    wallTimeToUtc(wall, shop.timezone),
  );
  if (!outcome.ok) {
    await trackEvent({ name: "schedule_builder_action", action: "move", outcome: outcome.reason });
    redirect(`${back}?builder=${outcome.reason.replace(/_/g, "-")}`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "move", outcome: "ok" });
  revalidateAndRedirect(back, `${back}?builder=moved`);
}

const duplicateSchema = z.object({
  tripId: z.uuid(),
  date: z.string(),
  startTime: z.string(),
});

export async function duplicateDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop } = await requireBoardAuthor(shopSlug);
  const parsed = duplicateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }

  const wall = parseWallTime(parsed.data.date, parsed.data.startTime);
  if (!wall) {
    await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  const copy = await duplicateTrip(
    db,
    shop.id,
    parsed.data.tripId,
    wallTimeToUtc(wall, shop.timezone),
  );
  if (!copy) {
    await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "ok" });
  revalidateAndRedirect(back, `${back}?builder=copied`);
}

export async function removeDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop } = await requireBoardAuthor(shopSlug);
  const tripId = z.uuid().safeParse(formData.get("tripId"));
  if (!tripId.success) {
    await trackEvent({ name: "schedule_builder_action", action: "remove", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }

  const outcome = await deleteTrip(db, shop.id, tripId.data);
  if (!outcome.ok) {
    await trackEvent({
      name: "schedule_builder_action",
      action: "remove",
      outcome: outcome.reason,
    });
    redirect(`${back}?builder=${outcome.reason.replace(/_/g, "-")}`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "remove", outcome: "ok" });
  revalidateAndRedirect(back, `${back}?builder=removed`);
}
