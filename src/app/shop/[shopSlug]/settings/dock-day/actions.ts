"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  setShopCrewLead,
  setShopDeskPayment,
  setShopDockDayRhythm,
  setShopMinTurnaround,
} from "@/db/shops";
import { DESK_PAYMENTS } from "@/lib/desk-payment";
import { DOCK_DAY_FIELDS, parseDockDayRhythm } from "@/lib/diver-planning";
import { parseCrewLeadMinutes } from "@/lib/dock-call";
import { formValue, parseForm, readForm, single, text } from "@/lib/form-parse";
import { parseMinTurnaroundMinutes } from "@/lib/move-preflight";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "../action-helpers";

/** Each dock-day amount as posted, `null` when absent; `parseDockDayRhythm` holds the bounds. */
const dockDayForm = z.object(
  Object.fromEntries(DOCK_DAY_FIELDS.map((field) => [field, formValue()])) as Record<
    (typeof DOCK_DAY_FIELDS)[number],
    ReturnType<typeof formValue>
  >,
);

/** The minimum turnaround as posted; `parseMinTurnaroundMinutes` holds the bounds. */
const turnaroundForm = z.object({ minTurnaroundMinutes: text() });

/** The crew time as posted; `parseCrewLeadMinutes` holds the bounds, and empty clears it. */
const crewLeadForm = z.object({ crewLeadMinutes: text() });

/** One of the three codes, or "" (or nothing) for "Don't say". Anything else is refused. */
const deskPaymentForm = z.object({
  deskPayment: single(z.union([z.enum(DESK_PAYMENTS), z.literal("")]), ""),
});

/**
 * **The dock day, one form and one Save** (visual review 2026-10-24, A01;
 * "One form, one Save", Aaron 2026-10-23): the six minute amounts of the
 * rhythm, the crew's lead time, the turnaround between departures and how
 * divers pay at the desk.
 *
 * Every section is read and checked before anything is written, against the
 * same bounds each had when it was a form of its own (`parseDockDayRhythm`,
 * `parseCrewLeadMinutes`, `parseMinTurnaroundMinutes`, the desk-payment
 * codes). A refusal names the section that failed with that section's own
 * notice and saves nothing, so the page never half-lands.
 *
 * - The rhythm: refused whole if any one amount is not a whole number inside
 *   its bounds, the same bounds the table's CHECK constraints enforce.
 * - Crew arrive before divers (H-20261022-crew-arrive-before-divers): empty clears it, and crew read the
 *   divers' time.
 * - The turnaround (issue #2141): advice for the Move panel; zero turns the
 *   line off.
 * - How divers pay (fifth-loop ideas, item 21): "Don't say" clears it.
 */
export async function saveDockDayAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "dock-day");
  await settingsBlock(session);

  const rhythm = parseDockDayRhythm(readForm(dockDayForm, formData));
  if (!rhythm) redirect(noticeUrl(page, "dock-invalid"));
  const crewLead = parseCrewLeadMinutes(readForm(crewLeadForm, formData).crewLeadMinutes);
  if (!crewLead.ok) redirect(noticeUrl(page, "crew-lead-invalid"));
  const turnaround = parseMinTurnaroundMinutes(
    readForm(turnaroundForm, formData).minTurnaroundMinutes,
  );
  if (turnaround === null) redirect(noticeUrl(page, "turnaround-invalid"));
  const desk = parseForm(deskPaymentForm, formData);
  if (!desk.ok) redirect(noticeUrl(page, "desk-payment-invalid"));

  const db = await getDb();
  await setShopDockDayRhythm(db, session.user.shopId, rhythm);
  await setShopCrewLead(db, session.user.shopId, crewLead.minutes);
  await setShopMinTurnaround(db, session.user.shopId, turnaround);
  await setShopDeskPayment(db, session.user.shopId, desk.data.deskPayment || null);
  revalidateAndRedirect(page, noticeUrl(page, "dock-day-saved"));
}
