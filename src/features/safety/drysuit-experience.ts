import { and, eq, isNull } from "drizzle-orm";
import { livePerson } from "@/db/trips";
import { loadActiveStaffRoles } from "../../db/authz";
import { specialtyCardSpecialty } from "../../db/card-columns";
import type { AppDb, DbExecutor } from "../../db/client";
import { activityEvents, cards, people, rentalFitProfiles } from "../../db/schema/index";
import { nowDate } from "../../lib/clock";
import {
  canClearDrysuitExperience,
  canRecordDrysuitExperience,
  DRYSUIT_EXPERIENCE_NOTE_MAX,
  drysuitExperienceRecordable,
} from "../../lib/drysuit-card";

/**
 * **A staffer's "I have seen this diver dive dry"** (issue #2136, Aaron
 * 2026-10-13; domain review A4/A5, security review X2/X3): the one writer of
 * `people.drysuit_experience_seen_*`. It clears the roster's drysuit-card
 * advisory (`checkDrysuitCard`) and nothing else — it is not a card, never
 * touches `cards` (kind = specialty), and no readiness or admission gate
 * reads it.
 *
 * Every precondition lives here, not only in the diver record's UI: the
 * actor's *live* roles include a diving lead, the actor is not the diver, a
 * short note says what was seen, and the diver dives dry with no drysuit card
 * on file (`drysuitExperienceRecordable`). Recording and clearing each leave
 * an append-only line on the diver's trail, so a cleared recording is still
 * history. Staff-only by construction: no public form, `/ready` included, may
 * ever call this.
 *
 * Idempotent: a second submit leaves the first recording's date, author and
 * note standing, so the trail never claims a later act by a different person.
 */
export type RecordDrysuitExperienceOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_authorized"
        | "self"
        | "note_required"
        | "not_recordable"
        | "already_recorded";
    };

export type ClearDrysuitExperienceOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_authorized" | "nothing_to_clear" };

async function lockDiver(tx: DbExecutor, shopId: string, personId: string) {
  const [row] = await tx
    .select({
      name: people.fullName,
      seenAt: people.drysuitExperienceSeenAt,
      seenBy: people.drysuitExperienceSeenByPersonId,
    })
    .from(people)
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        livePerson(),
        isNull(people.anonymizedAt),
      ),
    )
    .for("no key update");
  return row ?? null;
}

async function actorName(tx: DbExecutor, shopId: string, personId: string) {
  const [row] = await tx
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), livePerson()))
    .limit(1);
  return row?.name ?? null;
}

export async function recordDrysuitExperienceSeen(
  db: AppDb,
  input: { shopId: string; personId: string; byPersonId: string; note: string; now?: Date },
): Promise<RecordDrysuitExperienceOutcome> {
  return db.transaction(async (tx) => {
    const diver = await lockDiver(tx, input.shopId, input.personId);
    if (!diver) return { ok: false, reason: "not_found" } as const;
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.byPersonId);
    const actor = await actorName(tx, input.shopId, input.byPersonId);
    if (!roles || !actor || !canRecordDrysuitExperience(roles)) {
      return { ok: false, reason: "not_authorized" } as const;
    }
    if (input.byPersonId === input.personId) return { ok: false, reason: "self" } as const;
    const note = input.note.trim();
    if (note.length === 0 || note.length > DRYSUIT_EXPERIENCE_NOTE_MAX) {
      return { ok: false, reason: "note_required" } as const;
    }
    if (diver.seenAt) return { ok: false, reason: "already_recorded" } as const;

    const [fit] = await tx
      .select({ divesDry: rentalFitProfiles.divesDry })
      .from(rentalFitProfiles)
      .where(
        and(
          eq(rentalFitProfiles.personId, input.personId),
          eq(rentalFitProfiles.shopId, input.shopId),
        ),
      )
      .limit(1);
    const specialtyCards = await tx
      .select({ specialty: specialtyCardSpecialty })
      .from(cards)
      .where(
        and(
          eq(cards.kind, "specialty"),
          eq(cards.personId, input.personId),
          eq(cards.shopId, input.shopId),
          isNull(cards.deletedAt),
        ),
      );
    if (!drysuitExperienceRecordable(fit?.divesDry === true, specialtyCards)) {
      return { ok: false, reason: "not_recordable" } as const;
    }

    const at = input.now ?? nowDate();
    await tx
      .update(people)
      .set({
        drysuitExperienceSeenAt: at,
        drysuitExperienceSeenByPersonId: input.byPersonId,
        drysuitExperienceSeenNote: note,
      })
      .where(eq(people.id, input.personId));
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.byPersonId,
      subjectPersonId: input.personId,
      code: "drysuit_experience_recorded",
      params: { actor, diver: diver.name },
      occurredAt: at,
    });
    return { ok: true } as const;
  });
}

/**
 * Take the recording back, all three halves, so the advisory returns to the
 * roster. Only the recorder (still holding a recording role) or an owner or
 * manager may; the trail keeps both lines.
 */
export async function clearDrysuitExperienceSeen(
  db: AppDb,
  input: { shopId: string; personId: string; byPersonId: string },
): Promise<ClearDrysuitExperienceOutcome> {
  return db.transaction(async (tx) => {
    const diver = await lockDiver(tx, input.shopId, input.personId);
    if (!diver) return { ok: false, reason: "not_found" } as const;
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.byPersonId);
    const actor = await actorName(tx, input.shopId, input.byPersonId);
    if (!roles || !actor) return { ok: false, reason: "not_authorized" } as const;
    if (!diver.seenAt) return { ok: false, reason: "nothing_to_clear" } as const;
    if (!canClearDrysuitExperience(roles, diver.seenBy === input.byPersonId)) {
      return { ok: false, reason: "not_authorized" } as const;
    }
    await tx
      .update(people)
      .set({
        drysuitExperienceSeenAt: null,
        drysuitExperienceSeenByPersonId: null,
        drysuitExperienceSeenNote: null,
      })
      .where(eq(people.id, input.personId));
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.byPersonId,
      subjectPersonId: input.personId,
      code: "drysuit_experience_cleared",
      params: { actor, diver: diver.name },
      occurredAt: nowDate(),
    });
    return { ok: true } as const;
  });
}
