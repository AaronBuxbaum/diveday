"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  decideCrewAssignmentRequest,
  deleteCrewAvailabilityBlock,
  requestCrewAssignment,
  saveCrewAvailabilityBlock,
} from "@/db/crew-requests";
import { getShopById } from "@/db/shops";
import {
  createStaffCredential,
  deleteStaffCredential,
  reviewStaffCredential,
} from "@/db/staff-credentials";
import { createStaffShift, deleteStaffShift } from "@/db/staffing";
import { changeTripCrew } from "@/db/trips-crew";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { WEEK_PARAM, weekStartOf } from "@/lib/week-board";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

const shiftSchema = z.object({
  personId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().trim().max(120),
});

const credentialSchema = z.object({
  personId: z.string().uuid(),
  kind: z.enum([
    "instructor_rating",
    "divemaster_rating",
    "liability_insurance",
    "first_aid_cpr",
    "oxygen_provider",
    "captains_licence",
    "other",
  ]),
  name: z.string().trim().min(1).max(160),
  issuingBody: z.string().trim().max(160),
  identifier: z.string().trim().max(120),
  issuedAt: z.string().refine((value) => value === "" || isValidCalendarDate(value)),
  renewsAt: z.string().refine((value) => value === "" || isValidCalendarDate(value)),
});

/**
 * The week the staffer was working in, as the extra `noticeUrl` merges into
 * every redirect back to the page.
 *
 * Without it every act on this page landed on *this* week: adding next
 * Saturday's shift answered "Shift saved." above a week the shift is not in,
 * and the natural recovery — adding it again — is refused with "That person
 * already has an overlapping shift." Delete had the same shape, so a staffer
 * could not see the removal they had just made.
 *
 * The value is bound by the page from its own resolved `?week=`, so it is not
 * something a submitter chooses; it is still normalised to a Monday and
 * dropped when it is not a real date, because a bound argument still arrives
 * over the wire and a value that reached the URL unchecked would page the
 * board to nowhere. `resolveWeekStart` would forgive it on the way back in —
 * this refuses to write it in the first place.
 */
function weekExtra(week: string): { week?: string } {
  return isValidCalendarDate(week) ? { [WEEK_PARAM]: weekStartOf(week) } : {};
}

async function requireStaffingManager(week: Record<string, string | undefined>) {
  const session = await requireStaffSession();
  const allowed = await canPersonManageStaffAccounts(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) {
    redirect(noticeUrl(shopPath(session.user.shopSlug, "staffing"), "not-authorized", week));
  }
  return session;
}

export async function createShiftAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffingManager(at);
  const path = shopPath(session.user.shopSlug, "staffing");
  const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
  const shop = await getShopById(await getDb(), session.user.shopId);
  if (!parsed.success || !shop) redirect(noticeUrl(path, "invalid", at));
  const starts = parseWallTime(parsed.data.date, parsed.data.startTime);
  const ends = parseWallTime(parsed.data.date, parsed.data.endTime);
  if (!starts || !ends) redirect(noticeUrl(path, "invalid", at));
  const result = await createStaffShift(await getDb(), {
    shopId: session.user.shopId,
    personId: parsed.data.personId,
    startsAt: wallTimeToUtc(starts, shop.timezone),
    endsAt: wallTimeToUtc(ends, shop.timezone),
    note: parsed.data.note,
    createdByPersonId: session.user.personId,
  });
  // `result.reason` is a domain code in the domain's own casing (`staff_not_found`);
  // `noticeUrl` encodes it and normalises it to the one spelling the page's
  // notice map holds, so it is no longer interpolated raw.
  const notice = result.ok ? "shift-saved" : result.reason;
  revalidateAndRedirect(path, noticeUrl(path, notice, at));
}

export async function deleteShiftAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffingManager(at);
  const path = shopPath(session.user.shopSlug, "staffing");
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!z.string().uuid().safeParse(shiftId).success) redirect(noticeUrl(path, "invalid", at));
  const deleted = await deleteStaffShift(await getDb(), session.user.shopId, shiftId);
  revalidateAndRedirect(path, noticeUrl(path, deleted ? "shift-deleted" : "invalid", at));
}

export async function saveStaffCredentialAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffingManager(at);
  const path = shopPath(session.user.shopSlug, "staffing");
  const parsed = credentialSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(path, "credential-invalid", at));
  const row = await createStaffCredential(await getDb(), {
    shopId: session.user.shopId,
    personId: parsed.data.personId,
    kind: parsed.data.kind,
    name: parsed.data.name,
    issuingBody: parsed.data.issuingBody || null,
    identifier: parsed.data.identifier || null,
    issuedAt: parsed.data.issuedAt || null,
    renewsAt: parsed.data.renewsAt || null,
  });
  revalidateAndRedirect(path, noticeUrl(path, row ? "credential-saved" : "credential-invalid", at));
}

export async function reviewStaffCredentialAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffingManager(at);
  const path = shopPath(session.user.shopSlug, "staffing");
  const id = z.string().uuid().safeParse(formData.get("credentialId"));
  const status = z.enum(["pending", "verified"]).safeParse(formData.get("status"));
  if (!id.success || !status.success) redirect(noticeUrl(path, "credential-invalid", at));
  const row = await reviewStaffCredential(await getDb(), {
    shopId: session.user.shopId,
    credentialId: id.data,
    status: status.data,
    reviewNote:
      String(formData.get("reviewNote") ?? "")
        .trim()
        .slice(0, 300) || null,
    reviewedByPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    path,
    noticeUrl(path, row ? "credential-reviewed" : "credential-invalid", at),
  );
}

export async function deleteStaffCredentialAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffingManager(at);
  const path = shopPath(session.user.shopSlug, "staffing");
  const id = z.string().uuid().safeParse(formData.get("credentialId"));
  if (!id.success) redirect(noticeUrl(path, "credential-invalid", at));
  const deleted = await deleteStaffCredential(
    await getDb(),
    session.user.shopId,
    id.data,
    session.user.personId,
  );
  revalidateAndRedirect(
    path,
    noticeUrl(path, deleted ? "credential-deleted" : "credential-invalid", at),
  );
}

/**
 * **The crew's own two acts, and the owner's answer** (issue #1235, ADR
 * 20260902-crew-requests-and-blackouts).
 *
 * These are the only writes on this page that are *not* behind
 * `requireStaffingManager`: the whole point of the slice is that a crew member
 * writes their own rows. What replaces the manager gate is the domain layer's
 * own check, which reads the actor's live roles from the database and refuses
 * anything that is not their own row — a session claim is not evidence, and a
 * person removed from the shop this morning must not be able to book
 * themselves onto Saturday's boat this afternoon.
 */
const awaySchema = z.object({
  personId: z.string().uuid(),
  startsOn: z.string().refine(isValidCalendarDate),
  endsOn: z.string().refine(isValidCalendarDate),
  note: z.string().trim().max(120),
});

export async function saveAwayAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffSession();
  const path = shopPath(session.user.shopSlug, "staffing");
  const parsed = awaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(path, "invalid", at));
  const db = await getDb();
  const outcome = await saveCrewAvailabilityBlock(db, {
    shopId: session.user.shopId,
    personId: parsed.data.personId,
    actorPersonId: session.user.personId,
    canManageRoster: await canPersonManageStaffAccounts(
      db,
      session.user.shopId,
      session.user.personId,
    ),
    startsOn: parsed.data.startsOn,
    endsOn: parsed.data.endsOn,
    note: parsed.data.note,
  });
  revalidateAndRedirect(path, noticeUrl(path, outcome.ok ? "away-saved" : outcome.reason, at));
}

export async function deleteAwayAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffSession();
  const path = shopPath(session.user.shopSlug, "staffing");
  const blockId = String(formData.get("blockId") ?? "");
  if (!z.string().uuid().safeParse(blockId).success) redirect(noticeUrl(path, "invalid", at));
  const db = await getDb();
  const outcome = await deleteCrewAvailabilityBlock(db, {
    shopId: session.user.shopId,
    blockId,
    actorPersonId: session.user.personId,
    canManageRoster: await canPersonManageStaffAccounts(
      db,
      session.user.shopId,
      session.user.personId,
    ),
  });
  revalidateAndRedirect(path, noticeUrl(path, outcome.ok ? "away-deleted" : outcome.reason, at));
}

/**
 * A crew member asks to work one departure. **Always for themselves** — the
 * person is the session's own, never a form field, so there is nothing here for
 * a client to name somebody else with.
 */
export async function requestCrewAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffSession();
  const path = shopPath(session.user.shopSlug, "staffing");
  const tripId = String(formData.get("tripId") ?? "");
  if (!z.string().uuid().safeParse(tripId).success) redirect(noticeUrl(path, "invalid", at));
  const outcome = await requestCrewAssignment(await getDb(), {
    shopId: session.user.shopId,
    tripId,
    personId: session.user.personId,
    actorPersonId: session.user.personId,
  });
  revalidateAndRedirect(path, noticeUrl(path, outcome.ok ? "request-sent" : outcome.reason, at));
}

/**
 * The owner answers. An approval stamps the decision and then runs the
 * **ordinary** assignment mutation, so the agency training ratio, the course
 * rules and the roll-call guard all still apply — a request is a request, never
 * a second way onto a boat (the ADR's decision 3).
 *
 * An approval whose assignment is then refused is reported as such rather than
 * as a success: the decision is recorded either way, and a shop that thinks it
 * has crewed a departure it has not is the failure worth being loud about.
 */
export async function decideCrewRequestAction(week: string, formData: FormData) {
  const at = weekExtra(week);
  const session = await requireStaffingManager(at);
  const path = shopPath(session.user.shopSlug, "staffing");
  const requestId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!z.string().uuid().safeParse(requestId).success) redirect(noticeUrl(path, "invalid", at));
  if (decision !== "approved" && decision !== "declined") {
    redirect(noticeUrl(path, "invalid", at));
  }
  const db = await getDb();
  const outcome = await decideCrewAssignmentRequest(db, {
    shopId: session.user.shopId,
    requestId,
    decision,
    decidedByPersonId: session.user.personId,
    canManageRoster: true,
  });
  if (!outcome.ok) {
    revalidateAndRedirect(path, noticeUrl(path, outcome.reason, at));
    return;
  }
  if (decision === "declined") {
    revalidateAndRedirect(path, noticeUrl(path, "request-declined", at));
    return;
  }
  const assigned = await changeTripCrew(db, session.user.shopId, outcome.tripId, {
    operation: "assign",
    personId: outcome.personId,
  });
  revalidateAndRedirect(
    path,
    noticeUrl(path, assigned ? "request-approved" : "request-approved-not-assigned", at),
  );
}
