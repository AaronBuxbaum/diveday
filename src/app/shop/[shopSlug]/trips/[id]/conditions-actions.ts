"use server";

/**
 * A departure's predicted conditions: crew-entered operating work, open to
 * every staffer (`actions.authz.test.ts`).
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { getShopById } from "@/db/shops";
import { listTripDiverContacts, updateTripConditions } from "@/db/trips";
import { toDiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { depthToMeters, maxEnteredVisibility } from "@/lib/depth-units";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { publicTripPath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import {
  maxEnteredTemperature,
  minEnteredTemperature,
  temperatureToCelsius,
  temperatureUnitFor,
} from "@/lib/temperature-units";
import { tripPath } from "./roster-booking";

/**
 * Water temperature and visibility arrive in whatever units the shop works in
 * (`shops.temperature_unit` / `shops.depth_unit`), so the real bounds can only
 * be applied once the unit is known — these are the loose outer guards, and
 * `saveConditionsAction` re-reads the shop and re-checks against the shop-unit
 * bounds before converting to the canonical Celsius/metres that get stored.
 * Same shape the dive-site depth entry uses (`shop/[shopSlug]/dive-sites/new`).
 */
const conditionsSchema = z.object({
  conditionsHold: z.string().optional(),
  conditionsSummary: z.string().trim().max(600),
  waterTemperature: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(-100).max(200).optional(),
  ),
  visibility: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(1_000).optional(),
  ),
  surfaceConditions: z.string().trim().max(300),
});

export async function saveConditionsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  // Predicted conditions are crew-entered — the divemaster/captain on the water
  // record water temp, viz, and surface state and own the go/no-go call
  // (glossary). This is operating work, not trip definition, so it stays open to
  // all staff even though the rest of Overview is config-gated (H-20260724-staff-role-reach).
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = conditionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  const db = await getDb();
  // The units come from the shop row, never from the form. A hidden input would
  // let a crafted post store a 27 typed as °C as if it were °F — a 16-degree
  // error on every diver's brief — the same reason the dive-site depth entry
  // re-reads the shop rather than trusting what was submitted.
  const shop = await getShopById(db, s.user.shopId);
  if (!shop) redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  const temperatureUnit = temperatureUnitFor(shop);
  const { waterTemperature, visibility } = parsed.data;
  if (
    waterTemperature !== undefined &&
    (waterTemperature < minEnteredTemperature(temperatureUnit) ||
      waterTemperature > maxEnteredTemperature(temperatureUnit))
  ) {
    redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  }
  if (visibility !== undefined && visibility > maxEnteredVisibility(shop.depthUnit)) {
    redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  }
  const { trip: saved, holdStarted } = await updateTripConditions(db, s.user.shopId, tripId, {
    conditionsSummary: parsed.data.conditionsSummary,
    surfaceConditions: parsed.data.surfaceConditions,
    waterTemperatureC:
      waterTemperature === undefined
        ? undefined
        : temperatureToCelsius(waterTemperature, temperatureUnit),
    visibilityMeters:
      visibility === undefined ? undefined : depthToMeters(visibility, shop.depthUnit),
    conditionsHold: parsed.data.conditionsHold === "on",
    changeActorPersonId: s.user.personId,
  });
  if (saved && holdStarted) {
    const contacts = await listTripDiverContacts(db, s.user.shopId, tripId);
    const origin = publicAppUrl();
    if (origin) {
      const publishedAt = nowDate();
      await Promise.allSettled(
        contacts.flatMap((contact) =>
          contact.email
            ? [
                sendNotification(db, {
                  kind: "trip_conditions_hold",
                  tripId,
                  shopId: shop.id,
                  to: contact.email,
                  locale: toDiverLocale(shop.defaultLocale),
                  diverName: contact.fullName,
                  shopName: shop.name,
                  tripTitle: saved.title,
                  startsAt: saved.startsAt,
                  timezone: shop.timezone,
                  conditionsSummary: saved.conditionsSummary,
                  tripUrl: new URL(publicTripPath(shopSlug, tripId), `${origin}/`).toString(),
                  publishedAt,
                }),
              ]
            : [],
        ),
      );
    }
  }
  revalidateAndRedirect(
    back,
    noticeUrl(back, saved ? "conditions" : "invalid", { form: "conditions" }),
  );
}

export async function clearConditionsAction(shopSlug: string, tripId: string) {
  const back = tripPath(shopSlug, tripId);
  // Crew-entered conditions (see saveConditionsAction) — operating work, open to
  // all staff.
  const s = (await requireShopSurface(shopSlug)).session;
  const { trip: saved } = await updateTripConditions(await getDb(), s.user.shopId, tripId, {
    changeActorPersonId: s.user.personId,
  });
  revalidateAndRedirect(
    back,
    noticeUrl(back, saved ? "conditions-cleared" : "invalid", { form: "conditions" }),
  );
}
