"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { joinLastMinuteList } from "@/db/last-minute-list";
import { getShopById, getShopBySlug } from "@/db/shops";
import { createTrip, deleteTrip, duplicateTrip, moveTrip } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { trackEvent } from "@/lib/analytics";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { requireStaffSession } from "@/lib/session";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

const joinSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
  availableFrom: z.string().optional(),
  availableUntil: z.string().optional(),
});

export type LastMinuteListFormState = { error?: string; success?: boolean };

/**
 * Public, shop-wide opt-in: "tell me about last-minute deals" — distinct from
 * the per-trip wait list (docs ADR 20260727-last-minute-fill-promos). Never
 * checks capacity or a specific trip; it's a standing preference a diver can
 * update anytime by submitting again.
 */
export async function joinLastMinuteListAction(
  shopSlug: string,
  _prev: LastMinuteListFormState,
  formData: FormData,
): Promise<LastMinuteListFormState> {
  const ip = await clientIp();
  if (
    !checkRateLimit(rateLimitKey("last-minute-list", ip), RATE_LIMITS.lastMinuteListJoin).allowed
  ) {
    // Resolved here, not passed back as a code: this state reaches
    // LastMinuteListForm.tsx straight off `useActionState`, with no
    // Server Component render in between to translate it first.
    return { error: diverTranslator(await requestLocale())("common.rateLimited") };
  }

  const parsed = joinSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    availableFrom: formData.get("availableFrom") || undefined,
    availableUntil: formData.get("availableUntil") || undefined,
  });
  if (!parsed.success) return { error: "Enter a name and a valid email." };
  if (
    parsed.data.availableFrom &&
    parsed.data.availableUntil &&
    parsed.data.availableFrom > parsed.data.availableUntil
  ) {
    return { error: "The end date has to be on or after the start date." };
  }

  const dbi = await getDb();
  const shop = await getShopBySlug(dbi, shopSlug);
  if (!shop) return { error: "This shop isn't available right now." };

  await joinLastMinuteList(dbi, {
    shopId: shop.id,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    availableFrom: parsed.data.availableFrom,
    availableUntil: parsed.data.availableUntil,
  });
  return { success: true };
}

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

const boardPath = (shopSlug: string) => `/shop/${shopSlug}/schedule`;

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
