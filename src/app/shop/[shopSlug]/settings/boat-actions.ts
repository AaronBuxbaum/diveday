"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type BoatPapersInput,
  createBoat,
  deleteBoat,
  updateBoatWithinCertificate,
} from "@/db/boats";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { recordShopActivity } from "@/db/shop-activity";
import {
  getShopById,
  setShopDivingOptions,
  setShopDockDayRhythm,
  setShopEmergencyReference,
  setShopMinTurnaround,
  setShopShoreAlertContact,
} from "@/db/shops";
import { issueShoreAlertConfirmation } from "@/db/shore-alert-tokens";
import { toDiverLocale } from "@/i18n/settings";
import { type BoatSeatsRefusal, boatSeatsRefusal } from "@/lib/boat-safety";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { confirmContactLinkPath } from "@/lib/contact-email-confirmation";
import { DOCK_DAY_FIELDS, parseDockDayRhythm } from "@/lib/diver-planning";
import {
  MAX_EMERGENCY_LINES,
  normalizeCallSign,
  normalizeEmergencyReference,
  normalizeMmsi,
  normalizeWorkingChannel,
} from "@/lib/emergency-reference";
import { checkbox, formValue, readForm, text, trimmedText } from "@/lib/form-parse";
import { parseMinTurnaroundMinutes } from "@/lib/move-preflight";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { requireStaffSession } from "@/lib/session";
import { nextShoreAlertContact } from "@/lib/shore-alert-contact";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { settingsBlock } from "./action-helpers";
import { boatRowId } from "./boats/certificate-error";

/** Each dock-day amount as posted, `null` when absent; `parseDockDayRhythm` holds the bounds. */
const dockDayForm = z.object(
  Object.fromEntries(DOCK_DAY_FIELDS.map((field) => [field, formValue()])) as Record<
    (typeof DOCK_DAY_FIELDS)[number],
    ReturnType<typeof formValue>
  >,
);

/** The minimum turnaround as posted; `parseMinTurnaroundMinutes` holds the bounds. */
const turnaroundForm = z.object({ minTurnaroundMinutes: text() });

/**
 * The reference's fixed lines, the shore contact's alert address and its
 * consent box (H-118), plus a numbered label and phone per contact on the
 * catch-all.
 */
const emergencyForm = z
  .object({
    emergencyVessel: text(),
    emergencyShoreContact: text(),
    emergencyPlan: text(),
    shoreAlertEmail: text(),
    shoreAlertConsent: checkbox(),
    /** The address the box was drawn ticked for; "" when it was drawn empty. */
    shoreAlertConsentFor: text(),
  })
  .catchall(text());

const divingOptionsForm = z.object({
  hasBoatDiving: checkbox(),
  hasShoreDiving: checkbox(),
  hasPoolDiving: checkbox(),
});

/** A fleet row as posted; the boat's papers are narrowed by `boatPapers`. */
const boatForm = z.object({
  boatId: formValue(),
  name: trimmedText(),
  capacity: formValue(),
  description: trimmedText(),
  certifiedPassengers: trimmedText(),
  certifiedTotalPersons: trimmedText(),
  coiExpiresOn: trimmedText(),
  inspectionDueOn: trimmedText(),
  registrationExpiresOn: trimmedText(),
  insuranceExpiresOn: trimmedText(),
  callSign: trimmedText(),
  mmsi: trimmedText(),
  workingChannel: trimmedText(),
});
type BoatForm = z.infer<typeof boatForm>;

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
  const rhythm = parseDockDayRhythm(readForm(dockDayForm, formData));
  if (!rhythm) {
    redirect(noticeUrl(page, "dock-invalid"));
  }
  await setShopDockDayRhythm(await getDb(), session.user.shopId, rhythm);
  revalidateAndRedirect(page, noticeUrl(page, "dock-saved"));
}

/**
 * **The shortest turnaround the shop wants between departures** (issue #2141):
 * on the same hull, or for crew leaving from a different meeting point. The
 * schedule builder's Move panel names a closer departure as advice; nothing
 * refuses a move on it. Zero turns the line off.
 */
export async function saveTurnaroundAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "dock-day");
  await settingsBlock(session);
  const { minTurnaroundMinutes } = readForm(turnaroundForm, formData);
  const minutes = parseMinTurnaroundMinutes(minTurnaroundMinutes);
  if (minutes === null) {
    redirect(noticeUrl(page, "turnaround-invalid"));
  }
  await setShopMinTurnaround(await getDb(), session.user.shopId, minutes);
  revalidateAndRedirect(page, noticeUrl(page, "turnaround-saved"));
}

/**
 * **The numbers a crew dials during** — chamber, dive-accident hotline,
 * coastguard, vessel, shore contact and the shop's own plan (issue #688).
 *
 * Free text throughout, and DiveDay validates only that a line has something to
 * dial. The nearest chamber differs by dock and the hotline differs by country,
 * so any shape this imposed would be wrong somewhere — and a wrong number on
 * the one screen a crew reads offshore is worse than an empty one.
 *
 * The one exception is the shore contact's alert address (H-118), which
 * DiveDay sends to: it must be an address, and it saves only with the box
 * that records the shore contact agreed to hear, drawn for that address
 * (`shoreAlertConsentFor`; a changed address never inherits the old tick).
 * Either refusal saves nothing, so the reference and the address never
 * half-land. A new or changed address is sent a link to confirm it before any
 * alert goes (`sendShoreAlertConfirmation`); a demo shop sends nothing.
 */
export async function saveEmergencyReferenceAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "emergency-reference");
  await settingsBlock(session);
  const form = readForm(emergencyForm, formData);
  const db = await getDb();
  const current = await getShopById(db, session.user.shopId);
  const shore = nextShoreAlertContact({
    current: {
      email: current?.shoreAlertEmail ?? null,
      consentAt: current?.shoreAlertConsentAt ?? null,
      consentByPersonId: current?.shoreAlertConsentByPersonId ?? null,
      confirmedAt: current?.shoreAlertConfirmedAt ?? null,
    },
    email: form.shoreAlertEmail,
    consented: form.shoreAlertConsent,
    consentFor: form.shoreAlertConsentFor,
    actorPersonId: session.user.personId,
    now: nowDate(),
  });
  if (!shore.ok) {
    redirect(
      noticeUrl(
        page,
        shore.reason === "invalid_email" ? "shore-alert-invalid" : "shore-alert-consent-missing",
      ),
    );
  }
  const reference = normalizeEmergencyReference({
    lines: Array.from({ length: MAX_EMERGENCY_LINES }, (_, index) => ({
      label: (form[`emergencyLabel-${index}`] ?? "").slice(0, 80),
      phone: (form[`emergencyPhone-${index}`] ?? "").slice(0, 40),
    })),
    vessel: form.emergencyVessel.slice(0, 120),
    shoreContact: form.emergencyShoreContact.slice(0, 160),
    plan: form.emergencyPlan.slice(0, 2000),
  });
  const shop = await setShopEmergencyReference(db, session.user.shopId, reference);
  // An unchanged address is left alone rather than written back: a write of
  // what this request read would undo a confirmation that landed meanwhile.
  if (shore.change === "unchanged") revalidateAndRedirect(page, noticeUrl(page, "emergency-saved"));

  await setShopShoreAlertContact(db, session.user.shopId, shore.value);
  await recordShopActivity(db, {
    shopId: session.user.shopId,
    actorPersonId: session.user.personId,
    write: { code: `shore_alert_contact_${shore.change}` },
  });
  if (shore.change === "cleared") {
    revalidateAndRedirect(page, noticeUrl(page, "shore-alert-cleared"));
  }
  const named = shop ?? current;
  const notice = await confirmationNotice(
    named ? { ...named, shoreAlertEmail: shore.value.email } : null,
  );
  revalidateAndRedirect(page, noticeUrl(page, notice));
}

/** "Send the link again" under an address still waiting for its confirmation. */
export async function resendShoreAlertConfirmationAction() {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "emergency-reference");
  await settingsBlock(session);
  const shop = await getShopById(await getDb(), session.user.shopId);
  if (!shop?.shoreAlertEmail || shop.shoreAlertConfirmedAt) {
    revalidateAndRedirect(page, noticeUrl(page, "emergency-saved"));
  }
  const notice = await confirmationNotice(shop);
  revalidateAndRedirect(page, noticeUrl(page, notice));
}

/** Sends the confirmation link when it may, and names the notice that says what happened. */
async function confirmationNotice(
  shop: {
    id: string;
    name: string;
    isDemo: boolean;
    defaultLocale: string;
    timezone: string;
    shoreAlertEmail: string | null;
  } | null,
) {
  if (!shop?.shoreAlertEmail) return "emergency-saved";
  // A demo shop's owner login is anybody's: it sends nothing, the link included.
  if (shop.isDemo) return "shore-alert-saved-demo";
  const sent = await sendShoreAlertConfirmation({ ...shop, shoreAlertEmail: shop.shoreAlertEmail });
  return sent ? "shore-alert-confirmation-sent" : "shore-alert-confirmation-not-sent";
}

/**
 * Mints a confirmation link for the shop's shore address and sends it there,
 * and nowhere else (H-118 security review). Rate-limited per shop, and per
 * recipient in the front desk confirmation's own bucket (issue #1288), so one
 * inbox has one hourly allowance whichever link the shop sends it (security
 * re-review #4): without them a save-and-resend loop is a branded-mail relay
 * to anybody's inbox. A refused or failed send leaves the address saved and
 * unconfirmed, which sends nothing; the resend control is still there.
 */
async function sendShoreAlertConfirmation(shop: {
  id: string;
  name: string;
  defaultLocale: string;
  timezone: string;
  shoreAlertEmail: string;
}): Promise<boolean> {
  const origin = publicAppUrl();
  if (!origin) return false;
  const [byShop, byRecipient] = await Promise.all([
    checkRateLimit(
      rateLimitKey("shore-alert-confirmation", "shop", shop.id),
      RATE_LIMITS.contactConfirmationByShop,
    ),
    checkRateLimit(
      rateLimitKey("contact-confirmation", "recipient", shop.shoreAlertEmail.toLowerCase()),
      RATE_LIMITS.contactConfirmationByRecipient,
    ),
  ]);
  if (!byShop.allowed || !byRecipient.allowed) return false;
  const db = await getDb();
  const issued = await issueShoreAlertConfirmation(db, {
    shopId: shop.id,
    email: shop.shoreAlertEmail,
  });
  const delivery = await sendNotification(db, {
    kind: "shore_alert_confirmation",
    shopId: shop.id,
    tokenId: issued.tokenId,
    to: shop.shoreAlertEmail,
    locale: toDiverLocale(shop.defaultLocale),
    shopName: shop.name,
    confirmUrl: new URL(confirmContactLinkPath(issued.token), `${origin}/`).toString(),
    expiresAt: issued.expiresAt,
    timezone: shop.timezone,
  });
  return delivery.status === "sent";
}

/** Saves which of boat, shore and pool diving the shop runs. */
export async function saveDivingOptionsAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);

  const { hasBoatDiving, hasShoreDiving, hasPoolDiving } = readForm(divingOptionsForm, formData);

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
function boatDescription(form: BoatForm): string | null {
  const text = form.description.slice(0, 200);
  return text.length > 0 ? text : null;
}

/**
 * The certificate's two limits (passengers, and total persons with the crew,
 * #2302) and the boat's four paper dates, as the fleet row posts them. Every
 * one optional, and an empty box is a cleared value; anything that is not a
 * whole number of people or a real calendar day refuses the save rather than
 * being dropped, so a typo is never stored as "nothing said" (roadmap N-10).
 * The radio identity rides with them (fourth review, item 11): an MMSI that is
 * not nine digits, or a working channel that is not a channel (#2672), refuses
 * the save the same way.
 */
function boatPapers(
  form: BoatForm,
): BoatPapersInput | "invalid" | "radio-invalid" | "channel-distress" {
  const day = (
    name: "coiExpiresOn" | "inspectionDueOn" | "registrationExpiresOn" | "insuranceExpiresOn",
  ): string | null | "invalid" => {
    const value = form[name];
    if (!value) return null;
    return isValidCalendarDate(value) ? value : "invalid";
  };
  const people = (name: "certifiedPassengers" | "certifiedTotalPersons") => {
    const value = form[name];
    if (!value) return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 999 ? number : "invalid";
  };
  const certifiedPassengers = people("certifiedPassengers");
  const certifiedTotalPersons = people("certifiedTotalPersons");
  const coiExpiresOn = day("coiExpiresOn");
  const inspectionDueOn = day("inspectionDueOn");
  const registrationExpiresOn = day("registrationExpiresOn");
  const insuranceExpiresOn = day("insuranceExpiresOn");
  if (
    certifiedPassengers === "invalid" ||
    certifiedTotalPersons === "invalid" ||
    coiExpiresOn === "invalid" ||
    inspectionDueOn === "invalid" ||
    registrationExpiresOn === "invalid" ||
    insuranceExpiresOn === "invalid"
  ) {
    return "invalid";
  }
  const callSign = normalizeCallSign(form.callSign ?? "");
  const mmsi = normalizeMmsi(form.mmsi ?? "");
  const workingChannel = normalizeWorkingChannel(form.workingChannel ?? "");
  // Its own refusal: "Provide a boat name and capacity." over a mistyped
  // MMSI sent the owner looking at the two fields that were fine.
  if (callSign === "invalid" || mmsi === "invalid" || workingChannel === "invalid") {
    return "radio-invalid";
  }
  // 16 and 70 are every boat's distress and calling channels: said in its own
  // words, because "check the working channel" over a real channel reads wrong.
  if (workingChannel === "distress") return "channel-distress";
  return {
    certifiedPassengers,
    certifiedTotalPersons,
    coiExpiresOn,
    inspectionDueOn,
    registrationExpiresOn,
    insuranceExpiresOn,
    callSign,
    mmsi,
    workingChannel,
  };
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
  if (refusal.code === "seats_above_total_persons") {
    redirect(
      noticeUrl(row, "boat-seats-above-persons", {
        boat,
        capacity: refusal.capacity,
        limit: refusal.limit,
      }),
    );
  }
  if (refusal.code === "passengers_above_total_persons") {
    redirect(
      noticeUrl(row, "boat-passengers-above-persons", {
        boat,
        passengers: refusal.passengers,
        limit: refusal.limit,
      }),
    );
  }
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
  const form = readForm(boatForm, formData);

  const name = form.name;
  const capacity = Number(form.capacity ?? 0);
  const description = boatDescription(form);
  const papers = boatPapers(form);

  if (papers === "radio-invalid") redirect(noticeUrl(page, "boat-radio-invalid"));
  if (papers === "channel-distress") redirect(noticeUrl(page, "boat-channel-distress"));
  if (!name || Number.isNaN(capacity) || capacity <= 0 || papers === "invalid") {
    redirect(noticeUrl(page, "boat-invalid"));
  }

  // H-107: no seat above the certificate is sold, so none is put on sale.
  certificateRefusal(page, "new", boatSeatsRefusal({ capacity, ...papers }));

  const db = await getDb();
  await createBoat(
    db,
    session.user.shopId,
    name,
    capacity,
    description,
    papers,
    session.user.personId,
  );

  revalidateAndRedirect(page, noticeUrl(page, "boat-created"));
}

/** Updates an existing boat: its name, seats, line, certificate and papers. */
export async function updateBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "boats");
  await settingsBlock(session);
  const form = readForm(boatForm, formData);

  const rawBoatId = form.boatId;
  const boatId = typeof rawBoatId === "string" ? uuidParam(rawBoatId) : null;
  const name = form.name;
  const capacity = Number(form.capacity ?? 0);
  const description = boatDescription(form);
  const papers = boatPapers(form);

  if (papers === "radio-invalid") redirect(noticeUrl(page, "boat-radio-invalid"));
  if (papers === "channel-distress") redirect(noticeUrl(page, "boat-channel-distress"));
  if (!boatId || !name || Number.isNaN(capacity) || capacity <= 0 || papers === "invalid") {
    redirect(noticeUrl(page, "boat-invalid"));
  }

  const db = await getDb();
  // H-107, on every save of the row: a hull already over its certificate
  // keeps sailing, but this is the save that has to put it right. Upcoming
  // departures are read too, so a certificate cannot be lowered under seats
  // a departure is still selling — checked and written in one transaction.
  const saved = await updateBoatWithinCertificate(db, {
    shopId: session.user.shopId,
    boatId,
    name,
    capacity,
    description,
    papers,
    timeZone: (await getShopById(db, session.user.shopId))?.timezone ?? "UTC",
    actorPersonId: session.user.personId,
  });
  if (!saved.ok && saved.reason === "certificate") certificateRefusal(page, boatId, saved.refusal);

  revalidateAndRedirect(page, noticeUrl(page, "boat-updated"));
}

/** Deletes a boat from the shop. */
export async function deleteBoatAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "boats");
  await settingsBlock(session);
  const form = readForm(boatForm, formData);

  const rawBoatId = form.boatId;
  const boatId = typeof rawBoatId === "string" ? uuidParam(rawBoatId) : null;
  if (!boatId) {
    redirect(noticeUrl(page, "boat-invalid"));
  }

  const db = await getDb();
  await deleteBoat(db, session.user.shopId, boatId);

  revalidateAndRedirect(page, noticeUrl(page, "boat-deleted"));
}
