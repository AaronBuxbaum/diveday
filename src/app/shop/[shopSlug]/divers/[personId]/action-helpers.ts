/**
 * What the diver record's action files share: the session-and-live-staff gate every one of them
 * opens with (`requireDiverActionContext`), and where an outcome lands the reader (`backTo`,
 * `successUrl`). The actions themselves are split by the object they act on — `card-actions.ts`,
 * `details-actions.ts`, `fit-actions.ts`, `note-actions.ts`, `record-actions.ts`,
 * `waiver-actions.ts` — so a one-line fix to a card does not open the whole record's doors.
 * Not a `"use server"` module: nothing here is callable from the client.
 */
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadActiveStaffRoles } from "@/db/authz";
import { type AppDb, getDb } from "@/db/client";
import { people } from "@/db/schema";
import { isStaff } from "@/lib/authz";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { diverRecordIsClear } from "./_lib/status-load";

/**
 * Where on the record a form's outcome should put the reader.
 *
 * A server action redirects, and a redirect resets the scroll to the top — so
 * rendering an outcome inside its own section is only half the fix. Without the
 * anchor, saving a rental fit halfway down a ~6,400px record still lands the
 * staffer at the `<h1>` with the confirmation two screens below them, which is
 * the same complaint in the other direction. The ids are `DiverSection`'s
 * (`_components/DiverSections.tsx`) and the destructive tail's own headings.
 */
export const FORM_ANCHORS: Record<string, string> = {
  cards: "#certifications",
  waiver: "#waiver",
  fit: "#gear",
  shelf: "#shelf",
  story: "#the-story",
  notes: "#notes",
  reply: "#conversation",
  book: "#book-departure",
  remove: "#remove",
  restore: "#removed-heading",
  erase: "#erase-heading",
  "guardian-email": "#guardian-email-heading",
  merge: "#merge",
  // `details` sits under the header, which is where a redirect lands anyway.
};

/**
 * The record's URL carrying one form's outcome: the code, the form it belongs
 * to (`resolveDiverNotice`), and the anchor that puts that form on screen.
 */
export function backTo(base: string, notice: string, form?: string, card?: string) {
  // The anchor rides on the path so `noticeUrl` keeps the query ahead of it;
  // `form` and `card` drop out of the query entirely when there is none.
  return noticeUrl(`${base}${form ? (FORM_ANCHORS[form] ?? "") : ""}`, notice, { form, card });
}

/**
 * **Is this token still somebody's job?** — the liveness gate every card action
 * on this page passes before it writes.
 *
 * Deliberately **not** a role predicate. `isStaff` asks "are you staff at this
 * shop at all", which every crew role answers yes to, so capturing, reviewing,
 * deleting and restoring a card stay exactly as open as they have always been
 * and H-48 — the open product-owner question about *which* roles may sight a
 * card — is untouched. What it adds is the one thing a JWT cannot tell you: an
 * account since demoted, removed or disabled still holds a valid token until it
 * expires, and `requireStaffSession` will hand it back.
 *
 * It matters most on the strongest acts, which is where it was missing longest.
 * `reviewCertification` and `reviewNitroxCertification` are the single moment a
 * stranger's typing becomes `verified` — the state readiness,
 * `decideTripAdmission`, every course prerequisite, the depth advisory and the
 * nitrox fill gate all read — and `createCertification` mints that state
 * outright. A revoked account could do both (`security-reviewer`, 2026-08-15).
 * One helper rather than a copy per action, so the next card action added here
 * cannot quietly ship without it.
 */
export async function isLiveStaff(db: AppDb, shopId: string, personId: string): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  return Boolean(roles && isStaff(roles));
}

/**
 * Shared preamble for every mutation bound to this record's route segment.
 *
 * The subject id is not a form field, but it is still caller-controlled when
 * a server action is replayed by hand. Narrow it before any uuid query, then
 * re-read the staffer's live role before the action's more specific gate. A
 * malformed required subject is a 404, not a notice on a page that cannot
 * render it.
 */
export async function requireDiverActionContext(
  shopSlug: string,
  rawPersonId: string,
  unauthorizedNotice: string,
  form?: string,
) {
  const personId = uuidParam(rawPersonId);
  if (!personId) notFound();

  const staff = await requireStaffSession();
  const db = await getDb();
  const base = shopPath(shopSlug, "divers", personId);
  if (!(await isLiveStaff(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, unauthorizedNotice, form));
  }
  // A form opened on a record that has since been merged away posts here with
  // the old id. Every write below would land on a deleted pointer row the
  // staffer can no longer see, so it lands nowhere: the staffer is sent to the
  // kept record, told nothing was saved, and makes the change there.
  const [row] = await db
    .select({ mergedInto: people.mergedIntoPersonId })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, staff.user.shopId)))
    .limit(1);
  if (row?.mergedInto) {
    const kept = shopPath(shopSlug, "divers", row.mergedInto);
    revalidateAndRedirect(kept, noticeUrl(kept, "merged-record-moved"));
  }
  return { base, db, personId, staff };
}

/**
 * **The one card a staffer is holding, whichever table it belongs in.**
 *
 * Two forms — one for a level, one for a specialty or a nitrox card — became
 * one when the record's two certification sections merged into a single group
 * (ADR 20260827-people-not-lists, decision 1). The form asks *what card is
 * this*, with the ladder and the specialties as two option groups, and the
 * value carries its own kind: `level:<rung>`, `specialty:<kind>`, or `nitrox`.
 *
 * Splitting it here rather than in the component is what keeps the closed
 * enums as the gate: the rung and the specialty are still parsed against
 * `certificationLevel`/`specialtySchema`, so a hand-posted `card=level:god`
 * is a refusal, not a row.
 */
/**
 * **The success notice, unless that was the last thing.**
 *
 * The three acts that can close a record's final open item — verifying a level
 * card, verifying a specialty or nitrox card, recording a paper signature —
 * ask the record afterwards whether anything is still waiting, and answer with
 * `diver-clear` when nothing is (ADR 20260827-people-not-lists's "Delight —
 * the last thing clears"; the accent rule is 20260827-clearwater-surface-language
 * decision 11).
 *
 * It re-reads the record rather than reasoning from what was just written,
 * because "nothing is waiting" is a claim about the whole record. It is asked
 * only on the success path, so a refusal costs nothing; and the moment is
 * carried by a `?notice=` that `FlashParams` strips from the URL on arrival,
 * so it is transient by construction and a reload cannot re-celebrate it.
 *
 * `markCertifiedAction` is deliberately not one of them: it answers in place
 * with a toast and never redirects, and giving it a redirect back would undo
 * the reason it stopped redirecting.
 */
export async function successUrl(
  context: { base: string; db: AppDb; personId: string; staff: { user: { shopId: string } } },
  notice: string,
  form: string,
  succeeded: boolean,
): Promise<string> {
  if (!succeeded) return backTo(context.base, notice, form);
  const clear = await diverRecordIsClear(context.db, context.staff.user.shopId, context.personId);
  // No `?form=`: the moment belongs to the masthead, which is where the
  // `diver-clear` entry in `NOTICE_KEYS` files it.
  return clear ? backTo(context.base, "diver-clear") : backTo(context.base, notice, form);
}
