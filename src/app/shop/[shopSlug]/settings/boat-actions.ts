"use server";

import { redirect } from "next/navigation";
import {
  type BoatPapersInput,
  createBoat,
  deleteBoat,
  upcomingBoatDepartures,
  updateBoat,
} from "@/db/boats";
import { getDb } from "@/db/client";
import {
  getShopById,
  setShopDivingOptions,
  setShopDockDayRhythm,
  setShopEmergencyReference,
} from "@/db/shops";
import { type BoatSeatsRefusal, boatSeatsRefusal } from "@/lib/boat-safety";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { DOCK_DAY_FIELDS, parseDockDayRhythm } from "@/lib/diver-planning";
import { MAX_EMERGENCY_LINES, normalizeEmergencyReference } from "@/lib/emergency-reference";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { settingsBlock } from "./action-helpers";
import { boatRowId } from "./boats/certificate-error";

/**
 * The shop's whole dock-day rhythm: the arrival call plus the five minute
 * amounts the rest of the day is built from (src/lib/diver-planning.ts).
 *
 * One save for all six, and `parseDockDayRhythm` refuses the lot if any one of
 * them is not a whole number inside its own bounds — the same bounds the form's
 * `min`/`max` carry and the same the table's CHECK constraints enforce, read
 * from the one table rather than retyped here.
 */
export async function saveDockDayRhythmAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "dock-day");
  await settingsBlock(session);
  const rhythm = parseDockDayRhythm(
    Object.fromEntries(DOCK_DAY_FIELDS.map((field) => [field, formData.get(field)])),
  );
  if (!rhythm) {
    redirect(noticeUrl(page, "dock-invalid"));
  }
  await setShopDockDayRhythm(await getDb(), session.user.shopId, rhythm);
  revalidateAndRedirect(page, noticeUrl(page, "dock-saved"));
}

/**
 * **The numbers a crew dials during** — chamber, dive-accident hotline,
 * coastguard, vessel, shore contact and the shop's own plan (issue #688).
 *
 * Free text throughout, and DiveDay validates only that a line has something to
 * dial. The nearest chamber differs by dock and the hotline differs by country,
 * so any shape this imposed would be wrong somewhere — and a wrong number on
 * the one screen a crew reads offshore is worse than an empty one.
 */
export async function saveEmergencyReferenceAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "emergency-reference");
  await settingsBlock(session);
  const reference = normalizeEmergencyReference({
    lines: Array.from({ length: MAX_EMERGENCY_LINES }, (_, index) => ({
      label: String(formData.get(`emergencyLabel-${index}`) ?? "").slice(0, 80),
      phone: String(formData.get(`emergencyPhone-${index}`) ?? "").slice(0, 40),
    })),
    vessel: String(formData.get("emergencyVessel") ?? "").slice(0, 120),
    shoreContact: String(formData.get("emergencyShoreContact") ?? "").slice(0, 160),
    plan: String(formData.get("emergencyPlan") ?? "").slice(0, 2000),
  });
  await setShopEmergencyReference(await getDb(), session.user.shopId, reference);
  revalidateAndRedirect(page, noticeUrl(page, "emergency-saved"));
}

/** Saves which of boat, shore and pool diving the shop runs. */
export async function saveDivingOptionsAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);

  const hasBoatDiving = formData.get("hasBoatDiving") === "on";
  const hasShoreDiving = formData.get("hasShoreDiving") === "on";
  const hasPoolDiving = formData.get("hasPoolDiving") === "on";

  // Unticking all three would leave the builder with no mode to offer and trip
  // creation still defaulting to `boat` — a shop disowning the only kind of
  // departure it can make. The DB check refuses it too; this is the half that
  // says so in words instead of raising.
  if (!hasBoatDiving && !hasShoreDiving && !hasPoolDiving) {
    revalidateAndRedirect(
      settings,
      noticeUrl(settings, "diving-options-none", { form: "divingOptions" }),
    );
    return;
  }

  const db = await getDb();
  await setShopDivingOptions(db, session.user.shopId, {
    hasBoatDiving,
    hasShoreDiving,
    hasPoolDiving,
  });

  revalidateAndRedirect(
    settings,
    noticeUrl(settings, "diving-options-saved", { saved: "divingOptions" }),
  );
}

/** The storefront's one line about a hull: trimmed, bounded, and null when empty. */
function boatDescription(formData: FormData): string | null {
  const text = String(formData.get("description") ?? "")
    .trim()
    .slice(0, 200);
  return text.length > 0 ? text : null;
}

/**
 * The certificate's passenger limit and the boat's three paper dates, as the
 * fleet row posts them. Every one optional, and an empty box is a cleared
 * value; anything that is not a whole number of passengers or a real calendar
 * day refuses the save rather than being dropped, so a typo is never stored as
 * "nothing said" (roadmap N-10).
 */
function boatPapers(formData: FormData): BoatPapersInput | "invalid" {
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const day = (name: string): string | null | "invalid" => {
    const value = text(name);
    if (!value) return null;
    return isValidCalendarDate(value) ? value : "invalid";
  };
  const passengersText = text("certifiedPassengers");
  const certifiedPassengers = passengersText ? Number(passengersText) : null;
  if (
    certifiedPassengers !== null &&
    (!Number.isInteger(certifiedPassengers) || certifiedPassengers < 1 || certifiedPassengers > 999)
  ) {
    return "invalid";
  }
  const inspectionDueOn = day("inspectionDueOn");
  const registrationExpiresOn = day("registrationExpiresOn");
  const insuranceExpiresOn = day("insuranceExpiresOn");
  if (
    inspectionDueOn === "invalid" ||
    registrationExpiresOn === "invalid" ||
    insuranceExpiresOn === "invalid"
  ) {
    return "invalid";
  }
  return { certifiedPassengers, inspectionDueOn, registrationExpiresOn, insuranceExpiresOn };
}

/**
 * Redirects with the fleet row's field error when the boat's numbers break
 * the certificate (H-107). `boat` names the row the error belongs on ("new"
 * for the add form), and the numbers ride along so the sentence can say them.
 */
function certificateRefusal(page: string, boat: string, refusal: BoatSeatsRefusal | null) {
  if (!refusal) return;
  // The fragment scrolls to the row the error is on (`boatRowId`).
  const row = `${page}#${boatRowId(boat)}`;
  redirect(
    refusal.code === "seats_above_certificate"
      ? noticeUrl(row, "boat-above-certificate", {
          boat,
          capacity: refusal.capacity,
          limit: refusal.limit,
        })
      : noticeUrl(row, "boat-departures-above-certificate", {
          boat,
          count: refusal.departures,
          limit: refusal.limit,
          dates: refusal.firstDates.join(","),
        }),
  );
}

/** Creates a new boat for the shop. */
export async function createBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "boats");
  await settingsBlock(session);

  const name = String(formData.get("name") ?? "").trim();
  const capacity = Number(formData.get("capacity") ?? 0);
  const description = boatDescription(formData);
  const papers = boatPapers(formData);

  if (!name || Number.isNaN(capacity) || capacity <= 0 || papers === "invalid") {
    redirect(noticeUrl(page, "boat-invalid"));
  }

  // H-107: no seat above the certificate is sold, so none is put on sale.
  certificateRefusal(page, "new", boatSeatsRefusal({ capacity, ...papers }));

  const db = await getDb();
  await createBoat(db, session.user.shopId, name, capacity, description, papers);

  revalidateAndRedirect(page, noticeUrl(page, "boat-created"));
}

/** Updates an existing boat: its name, seats, line, certificate and papers. */
export async function updateBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "boats");
  await settingsBlock(session);

  const rawBoatId = formData.get("boatId");
  const boatId = typeof rawBoatId === "string" ? uuidParam(rawBoatId) : null;
  const name = String(formData.get("name") ?? "").trim();
  const capacity = Number(formData.get("capacity") ?? 0);
  const description = boatDescription(formData);
  const papers = boatPapers(formData);

  if (!boatId || !name || Number.isNaN(capacity) || capacity <= 0 || papers === "invalid") {
    redirect(noticeUrl(page, "boat-invalid"));
  }

  const db = await getDb();
  // H-107, on every save of the row: a hull already over its certificate
  // keeps sailing, but this is the save that has to put it right. Upcoming
  // departures are read too, so a certificate cannot be lowered under seats
  // a departure is still selling.
  certificateRefusal(
    page,
    boatId,
    boatSeatsRefusal({
      capacity,
      ...papers,
      upcomingDepartures: papers.certifiedPassengers
        ? await upcomingBoatDepartures(db, {
            shopId: session.user.shopId,
            boatId,
            timeZone: (await getShopById(db, session.user.shopId))?.timezone ?? "UTC",
          })
        : [],
    }),
  );
  await updateBoat(db, session.user.shopId, boatId, name, capacity, description, papers);

  revalidateAndRedirect(page, noticeUrl(page, "boat-updated"));
}

/** Deletes a boat from the shop. */
export async function deleteBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "boats");
  await settingsBlock(session);

  const rawBoatId = formData.get("boatId");
  const boatId = typeof rawBoatId === "string" ? uuidParam(rawBoatId) : null;
  if (!boatId) {
    redirect(noticeUrl(page, "boat-invalid"));
  }

  const db = await getDb();
  await deleteBoat(db, session.user.shopId, boatId);

  revalidateAndRedirect(page, noticeUrl(page, "boat-deleted"));
}
