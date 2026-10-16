import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { people } from "./schema";

/**
 * **A staffer's "I have seen this diver dive dry"** (issue #2136, Aaron
 * 2026-10-13): the one writer of `people.drysuit_experience_seen_at` and its
 * author. It clears the roster's drysuit-card advisory (`checkDrysuitCard`) and
 * nothing else — it is not a card, never touches `specialty_certifications`,
 * and no readiness or admission gate reads it.
 *
 * Staff-only by construction: the only callers are the diver record's staff
 * actions. No public form, `/ready` included, may ever call this.
 *
 * Idempotent: a second submit leaves the first recording's date and author
 * standing, so the trail never claims a later act by a different person.
 * Returns whether the row changed.
 */
export async function recordDrysuitExperienceSeen(
  db: DbExecutor,
  input: { shopId: string; personId: string; byPersonId: string; now?: Date },
): Promise<boolean> {
  const [row] = await db
    .update(people)
    .set({
      drysuitExperienceSeenAt: input.now ?? nowDate(),
      drysuitExperienceSeenByPersonId: input.byPersonId,
    })
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.drysuitExperienceSeenAt),
      ),
    )
    .returning({ id: people.id });
  return Boolean(row);
}

/**
 * Take the recording back, both halves: a staffer who marked the wrong diver
 * puts the advisory back on the roster. Idempotent; returns whether the row
 * changed.
 */
export async function clearDrysuitExperienceSeen(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<boolean> {
  const [row] = await db
    .update(people)
    .set({ drysuitExperienceSeenAt: null, drysuitExperienceSeenByPersonId: null })
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        isNotNull(people.drysuitExperienceSeenAt),
      ),
    )
    .returning({ id: people.id });
  return Boolean(row);
}
