"use server";

import { z } from "zod";
import {
  setShopCrewLead,
  setShopDeskPayment,
  setShopDockDayRhythm,
  setShopMinTurnaround,
} from "@/db/shops";
import { defineAction, land, type NoticeOf } from "@/features/server-action";
import { DESK_PAYMENTS } from "@/lib/desk-payment";
import { DOCK_DAY_FIELDS, parseDockDayRhythm } from "@/lib/diver-planning";
import { parseCrewLeadMinutes } from "@/lib/dock-call";
import { formValue, text } from "@/lib/form-parse";
import { parseMinTurnaroundMinutes } from "@/lib/move-preflight";
import { SETTINGS_GATE } from "../action-gates";

/** Each dock-day amount as posted, `null` when absent; `parseDockDayRhythm` holds the bounds. */
const dockDayForm = z.object(
  Object.fromEntries(DOCK_DAY_FIELDS.map((field) => [field, formValue()])) as Record<
    (typeof DOCK_DAY_FIELDS)[number],
    ReturnType<typeof formValue>
  >,
);

/**
 * The rest of the form as posted: the minimum turnaround and the crew time
 * (their parsers hold the bounds, and an empty crew time clears it) and how
 * divers pay at the desk, read raw and held to {@link deskPayment} below.
 */
const dockDayPost = dockDayForm.extend({
  minTurnaroundMinutes: text(),
  crewLeadMinutes: text(),
  deskPayment: formValue(),
});

/** One of the three codes, or "" (or nothing) for "Don't say". Anything else is refused. */
const deskPayment = z.union([z.enum(DESK_PAYMENTS), z.literal("")]);

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
export const saveDockDayAction = defineAction({
  gate: [SETTINGS_GATE],
  input: dockDayPost,
  async run({ db, shopId, path }, form) {
    const page = path("settings", "dock-day");
    const rhythm = parseDockDayRhythm(form);
    if (!rhythm) return land(page, "dock-invalid");
    const crewLead = parseCrewLeadMinutes(form.crewLeadMinutes);
    if (!crewLead.ok) return land(page, "crew-lead-invalid");
    const turnaround = parseMinTurnaroundMinutes(form.minTurnaroundMinutes);
    if (turnaround === null) return land(page, "turnaround-invalid");
    const desk = deskPayment.safeParse(form.deskPayment ?? "");
    if (!desk.success) return land(page, "desk-payment-invalid");

    await setShopDockDayRhythm(db, shopId, rhythm);
    await setShopCrewLead(db, shopId, crewLead.minutes);
    await setShopMinTurnaround(db, shopId, turnaround);
    await setShopDeskPayment(db, shopId, desk.data || null);
    return land(page, "dock-day-saved");
  },
});

/** What `/settings/dock-day` can be told after a save (`dockDayNoticeMessages`). */
export type DockDayNotice = NoticeOf<typeof saveDockDayAction>;
