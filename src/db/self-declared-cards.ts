import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type CertificationLevel,
  certificationRank,
  isUnsightedSelfDeclaration,
} from "@/lib/readiness";
import type { DbExecutor } from "./client";
import {
  type CertificationAgency,
  certifications,
  nitroxCertifications,
  people,
  specialtyCertifications,
} from "./schema";

/**
 * **What a diver said about themselves on a public opt-in, written down as
 * what it is.**
 *
 * Both of DiveDay's "tell me when something comes up" lists — the shop-wide
 * last-minute-deal list and a full trip's wait list — used to collect a name,
 * an email, and nothing about diving, so a discount blast could invite an Open
 * Water diver onto a deep wreck charter the admission gate would refuse
 * (FU-20260813). They now ask, optionally, for a level and whether the diver is
 * nitrox certified, and the answer lands here.
 *
 * It lands on the **person**, not as a parallel column on the list entry: both
 * lists resolve to one `people` row, the app already understands a card there,
 * and a card travels through export, erasure and the diver's own record for
 * free. It lands `pending` and stamped `selfDeclaredAt`, which is what keeps it
 * from being mistaken for evidence — see that column in schema.ts for the three
 * things that hang off the stamp, and `decideTripAdmission` for the gate that
 * ignores it.
 *
 * **The third answer is "I'm not certified yet", and it is not a card.** A
 * large share of joiners at a Florida or Caribbean shop hold none — Discover
 * Scuba customers, snorkellers, the non-diving half of a couple — and it lands
 * on `people.no_certification_declared_at` rather than in `certifications`,
 * because a Discover Scuba experience is not a certification and every row in
 * that table asserts a card exists (`recordNoCertification` below, ADR
 * 20260814-self-declared-cards).
 *
 * **This is informing, never gating.** Nothing written here filters a blast or
 * a wait-list invite. The change that stops the bad email is a staffer seeing
 * "Open Water (self-declared)" beside a name before they send.
 */

/**
 * **The anti-displacement rule, and why it is this strict.**
 *
 * The caller is an *unauthenticated* form. An anonymous poster who guesses (or
 * simply knows) an existing diver's email address resolves to that diver's
 * real `people` row — `findOrCreatePerson` matches on shop + email — and would
 * otherwise be writing certification data onto a stranger's safety record.
 *
 * So: **a real card always wins, and a claim never touches one.** If this
 * person already has any live card that is not itself a self-declaration —
 * staff-captured or CSV-imported, `pending` or `verified`, current or overdue —
 * nothing is written at all. Not a second row beside it, either: a "claims
 * Instructor" row sitting next to a verified Open Water card is a downgrade of
 * the shop's own record by presentation, and the panels that read this would
 * have to arbitrate between them at exactly the moment nobody wants ambiguity.
 *
 * A diver who has only ever declared, and declares again, updates their own
 * earlier statement. That is not a new exposure: the row was anonymous-writable
 * when it was created and says only what somebody typed.
 */
export type SelfDeclarationOutcome =
  /** Nothing was said — the fields are optional and most joiners skip them. */
  | "not_said"
  /** Written: a new self-declared card, or an update to their own earlier one. */
  | "recorded"
  /** A real card is already on file; the claim was dropped rather than recorded. */
  | "card_on_file";

export type RecordSelfDeclaredCardsInput = {
  shopId: string;
  personId: string;
  /** Absent/null means the joiner skipped the question. */
  level?: CertificationLevel | null;
  /**
   * The joiner answered "I'm not certified yet" — a statement that there is no
   * card, which is why it can never be a `level`. It lands as its own stamp on
   * the person (`people.no_certification_declared_at`) and never as a
   * `certifications` row: a Discover Scuba experience is not a certification.
   */
  noCertification?: boolean;
  /**
   * **The card the diver described, when they described one** — both optional,
   * both meaningless without a `level`, and neither gates anything (issue #630).
   *
   * They are written onto the same `pending`, `selfDeclaredAt`-stamped row the
   * level lands on, which changes nothing about how that row is *read*: the
   * anti-displacement rule below still refuses to touch a person who holds real
   * evidence, `decideTripAdmission` still believes the level and not the number,
   * and `reviewCertification` still refuses the one-tap promote until a staffer
   * types what is on the card in their hand. What they change is what the verify
   * queue has to work with before the dive date, which until now was nothing.
   *
   * The number lands in `certifications.declared_identifier`, a column outside
   * the unique index and outside every evidence read — see that column.
   */
  agency?: CertificationAgency | null;
  identifier?: string | null;
  /** False and undefined are the same thing here: an unticked box says nothing. */
  nitrox?: boolean;
  now?: Date;
};

export type RecordSelfDeclaredCardsOutcome = {
  level: SelfDeclarationOutcome;
  noCertification: SelfDeclarationOutcome;
  nitrox: SelfDeclarationOutcome;
};

/**
 * Records a joiner's optional self-declaration. Call it **inside** the join's
 * own transaction, with the `people` row already resolved and proven to belong
 * to `shopId` — every write here is narrowed by `shopId` as well, so a caller
 * holding a foreign person id still cannot reach across tenants.
 *
 * Deliberately sequential rather than a `Promise.all`: a drizzle transaction is
 * one checked-out client and fanning out over it is not parallel anyway
 * (`scripts/check-db-concurrency.mjs`).
 *
 * **The anti-displacement rule is check-then-act, so it has to be serialized.**
 * Both halves below read this person's live cards and then decide whether to
 * write. Under READ COMMITTED, two public joins for the same email — or one
 * join racing a staffer's `createCertification` — each read "no real card" and
 * each proceed, which is exactly the "claims Instructor beside a real card" row
 * the ADR forbids. A null `identifier` collides with nothing, so the partial
 * unique index cannot catch it either. The `people` row is the lock: every
 * writer of this person's evidence takes it first, and it is a row these
 * callers have already resolved, so nothing extra is read to find it.
 */
export async function recordSelfDeclaredCards(
  tx: DbExecutor,
  input: RecordSelfDeclaredCardsInput,
): Promise<RecordSelfDeclaredCardsOutcome> {
  const now = input.now ?? nowDate();
  // **`no key update`, not `update`, and the difference is a deadlock.**
  //
  // The caller has almost always just inserted a `bookings` row naming this
  // person, and that insert's foreign key takes a `FOR KEY SHARE` lock on this
  // very tuple, held to commit. `FOR UPDATE` conflicts with `FOR KEY SHARE`, so
  // two transactions that had each inserted a booking for the same diver then
  // both asked to upgrade — and each waited for the other's key-share to be
  // released by a commit that could not happen. Postgres broke it with `40P01`,
  // on **one row**: an ordering rule cannot fix a lock upgrade, because there is
  // no second lock to put in a different order.
  //
  // `FOR NO KEY UPDATE` does not conflict with `FOR KEY SHARE` (it is what an
  // ordinary `UPDATE` of a non-key column takes anyway, which is exactly what
  // `recordNoCertification` does below), while still conflicting with itself.
  // So the thing this lock exists for is unchanged — two declaration writers on
  // one diver are still serialized, and the read-then-write below still cannot
  // interleave — and the only concurrency it newly permits is a foreign key
  // pointing at this person, which never touches a card.
  const [locked] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1)
    .for("no key update");
  // Not this shop's person (or not a person at all). Every write below is
  // narrowed by `shopId` as well, so this is a second door on the same rule —
  // but returning here keeps a caller holding a foreign id from getting an
  // outcome that reads like something was considered.
  if (!locked) return { level: "not_said", noCertification: "not_said", nitrox: "not_said" };

  // **"Not certified yet" is answered first, and it answers for the others.**
  // One `<select>` cannot post a rung *and* "I hold no card", so a caller
  // sending both is contradicting itself — and the app must not turn one
  // contradiction into two claims sitting on a safety record. The statement
  // that there is nothing wins, in both directions: no level row is written,
  // and no nitrox row either, because "I have no card at all" plainly covers
  // the enriched-air one. Refusing to record a capability is always the
  // conservative direction.
  const noCertification = await recordNoCertification(tx, input, now);
  if (noCertification !== "not_said") {
    return { level: "not_said", noCertification, nitrox: "not_said" };
  }
  return {
    level: await recordLevel(tx, input, now),
    noCertification,
    nitrox: await recordNitrox(tx, input, now),
  };
}

/**
 * **The joiner's own word that they hold no card**, written as a stamp on the
 * person and never as a certification.
 *
 * The three rules it inherits, and the one it adds:
 *
 * - **Anti-displacement, unchanged and widened to all three card tables.** The
 *   claim here is "there is no card", so *any* live card the shop actually
 *   holds refutes it — a level card, a nitrox card or a specialty card,
 *   `pending` or `verified`, captured or imported, or a claim this shop has
 *   since sighted. Any of those and nothing is written at all. The forms are
 *   unauthenticated: anybody who knows a diver's name and email address reaches
 *   that diver's real record.
 * - **It retracts the joiner's own earlier claims, and only those.** A diver
 *   who declared "Instructor" last month and says "I'm not certified yet" today
 *   has corrected themselves *downward*, which is the direction that matters:
 *   leaving the higher claim live would let it outlive its own retraction on
 *   every panel that reads it. So their still-unsighted self-declared rows are
 *   archived (`deleted_at`, the repo's archive-not-delete semantics — the rows
 *   and their provenance survive), and the guard above means the only rows this
 *   can ever reach are rows an anonymous post could have written in the first
 *   place. Nothing a staffer captured or sighted is touchable here.
 * - **It gates nothing.** No blast is filtered, no mail reordered, no button
 *   disabled (ADR 20260814-self-declared-cards, decision 4). All it does is let
 *   a staffer tell this answer apart from the silence of somebody who skipped
 *   the question — which is the whole reason it exists, since today both read
 *   as "Level not said" and the shop mails a Discover Scuba customer a
 *   certified two-tank charter.
 */
/**
 * **`isUnsightedSelfDeclaration`, negated, in SQL.**
 *
 * The same question the TypeScript predicate answers over a row already in
 * memory — *is this a card somebody actually stood behind?* — expressed as a
 * `where` condition so an existence check can stop at the first match instead
 * of loading a diver's whole history to filter it.
 *
 * **Two spellings of one rule is the exact shape that caused the bug this file
 * was just fixed for**, so they are not merely kept in step by attention:
 * `self-declared-cards.test.ts` walks every combination of `status` and
 * `self_declared_at` through both and fails if they ever disagree. Change one
 * and that test tells you about the other.
 *
 * A row is real when a staffer verified it, **or** when nobody ever declared it
 * — a staff capture and a CSV import both land with a null stamp.
 */
function isRealCard(
  table: typeof certifications | typeof nitroxCertifications | typeof specialtyCertifications,
) {
  return or(eq(table.status, "verified"), isNull(table.selfDeclaredAt));
}

/**
 * True when this shop holds a card for this person in either of the two tables
 * {@link recordLevel} does not read — a nitrox card a staffer sighted, or any
 * specialty row at all.
 *
 * `recordNoCertification` asks the identical question inline rather than
 * through here, because it needs the nitrox *rows* a second time to archive the
 * diver's own earlier claims; this answers existence and stops. The two must
 * stay in step — the whole reason this exists is that they were not
 * (`security-reviewer`, 2026-08-20).
 *
 * `specialty_certifications` has no `self_declared_at` column, so every row
 * there is staff-captured or imported and its existence alone settles it — the
 * only one of the three tables where a row's mere presence is the answer.
 */
async function holdsRealCardOutsideLevels(
  tx: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<boolean> {
  // Sequential, never `Promise.all`: this runs inside the caller's transaction,
  // which is one checked-out client (`scripts/check-db-concurrency.mjs`).
  const [realNitrox] = await tx
    .select({ id: nitroxCertifications.id })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.shopId, input.shopId),
        eq(nitroxCertifications.personId, input.personId),
        isNull(nitroxCertifications.deletedAt),
        isRealCard(nitroxCertifications),
      ),
    )
    .limit(1);
  if (realNitrox) return true;

  // `isRealCard`, not mere presence: since 2026-08-20 a diver can type a
  // specialty card on their own readiness link, and a claim must never count as
  // the shop holding evidence about them — that is what suppresses their own
  // level declaration. Before the column existed, every row here was
  // staff-captured or imported and presence was the right test.
  const [liveSpecialty] = await tx
    .select({ id: specialtyCertifications.id })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.shopId, input.shopId),
        eq(specialtyCertifications.personId, input.personId),
        isNull(specialtyCertifications.deletedAt),
        isRealCard(specialtyCertifications),
      ),
    )
    .limit(1);
  return Boolean(liveSpecialty);
}

async function recordNoCertification(
  tx: DbExecutor,
  input: RecordSelfDeclaredCardsInput,
  now: Date,
): Promise<SelfDeclarationOutcome> {
  if (!input.noCertification) return "not_said";

  const liveLevels = await tx
    .select({
      id: certifications.id,
      status: certifications.status,
      selfDeclaredAt: certifications.selfDeclaredAt,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, input.shopId),
        eq(certifications.personId, input.personId),
        isNull(certifications.deletedAt),
      ),
    );
  if (liveLevels.some((card) => !isUnsightedSelfDeclaration(card))) return "card_on_file";

  // Nitrox is read in full rather than through `holdsRealCardOutsideLevels`,
  // because this function needs the rows twice: once as the guard, and again
  // below to archive the diver's *own* earlier claims. The helper answers
  // "does any real card exist" and deliberately stops there.
  //
  // Sequential, never `Promise.all`: this runs inside the join's transaction,
  // which is one checked-out client (`scripts/check-db-concurrency.mjs`).
  const liveNitrox = await tx
    .select({
      id: nitroxCertifications.id,
      status: nitroxCertifications.status,
      selfDeclaredAt: nitroxCertifications.selfDeclaredAt,
    })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.shopId, input.shopId),
        eq(nitroxCertifications.personId, input.personId),
        isNull(nitroxCertifications.deletedAt),
      ),
    );
  if (liveNitrox.some((card) => !isUnsightedSelfDeclaration(card))) return "card_on_file";

  // The third table, and the only one where a row's mere existence settles it.
  // `specialty_certifications` has no `self_declared_at` at all — these forms
  // cannot write there, so every row is a card a staffer captured or a CSV
  // brought in, and a diver holding a Deep card is not a diver with no card.
  const [liveSpecialty] = await tx
    .select({ id: specialtyCertifications.id })
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.shopId, input.shopId),
        eq(specialtyCertifications.personId, input.personId),
        isNull(specialtyCertifications.deletedAt),
      ),
    )
    .limit(1);
  if (liveSpecialty) return "card_on_file";

  for (const claim of liveLevels) {
    await tx
      .update(certifications)
      .set({ deletedAt: now })
      .where(
        and(
          eq(certifications.id, claim.id),
          eq(certifications.shopId, input.shopId),
          // Defence in depth, the same shape the level writer uses: the read
          // above already proved every one of these is a still-unsighted claim,
          // and re-stating it in the writing statement means no later refactor
          // of the read can archive a card a staffer holds.
          eq(certifications.status, "pending"),
          isNotNull(certifications.selfDeclaredAt),
          isNull(certifications.deletedAt),
        ),
      );
  }
  for (const claim of liveNitrox) {
    await tx
      .update(nitroxCertifications)
      .set({ deletedAt: now })
      .where(
        and(
          eq(nitroxCertifications.id, claim.id),
          eq(nitroxCertifications.shopId, input.shopId),
          eq(nitroxCertifications.status, "pending"),
          isNotNull(nitroxCertifications.selfDeclaredAt),
          isNull(nitroxCertifications.deletedAt),
        ),
      );
  }

  await tx
    .update(people)
    .set({
      noCertificationDeclaredAt: now,
      // **A fresh answer un-clears an old correction — but only the half that
      // is current state.** Without this, one `clearNoCertificationDeclaration`
      // would silently swallow every "I'm not certified yet" the diver gave
      // afterwards: a permanent, invisible gate on one answer of one form,
      // chosen by nobody. Nulling it is also what lets every reader below test
      // `clearedAt IS NULL` and nothing else — the frozen e2e clock makes two
      // timestamps genuinely incomparable, so "which statement is later" has to
      // be structural rather than chronological.
      noCertificationClearedAt: null,
      // **`clearedByPersonId` deliberately survives.** This function is reached
      // from an *unauthenticated* form, and the row it is writing carries a fact
      // a member of staff authored. Clearing that too would let an anonymous
      // post erase the shop's own audit of its own correction — the same shape
      // as the 2026-08-14 bug this ADR records, one column over — and would let
      // a griefer loop the stamp back on with nothing left saying a staffer had
      // ever disagreed (`security-reviewer`/`dive-domain-expert`, 2026-08-15).
      // A set `clearedByPersonId` with a null `clearedAt` is a real and
      // readable state: *corrected once, and stated again since*.
    })
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)));
  return "recorded";
}

/**
 * **A staffer saying this diver never told us that** — the eraser for a stamp
 * `recordNoCertification` wrote on an unauthenticated form.
 *
 * Those forms resolve a person by shop + email, so for a diver the shop holds
 * no card for, anybody holding a name and an email address off any manifest can
 * mark them *"Not certified yet — diver's word"* on the send lists and in every
 * CSV the shop exports from then on. Until this existed the only thing that
 * cleared it was owner-only erasure of the whole record.
 *
 * **It supersedes rather than deletes** (`people.no_certification_cleared_at`),
 * for the reason the ADR gives about `self_declared_at`: where a record began is
 * history, and an eraser that destroyed the evidence of its own subject leaves a
 * shop unable to answer whether the diver ever said it.
 *
 * **It cannot launder a claim into evidence, structurally.** Its only effect is
 * to move this person from a *stated* absence of a card to *no statement at
 * all* — the silence of somebody nobody asked. Evidence lives in
 * `certifications`, `nitrox_certifications` and `specialty_certifications`, and
 * this function touches none of them; nothing it writes can raise a level, add
 * a card, or move a row toward `verified`. That is the whole reason it is safe
 * to open to every staff role, which is what capturing a card already is —
 * H-48 is the open question about who may *sight* one, and this deliberately
 * does not pre-empt it by inventing a narrower gate for a weaker act.
 *
 * Shop-scoped like every writer here, so a staffer holding a foreign person id
 * still reaches nothing. Returns false when there was no stamp to clear, so the
 * surface can tell "corrected" from "nothing to correct" rather than reporting
 * a no-op as an act.
 */
export async function clearNoCertificationDeclaration(
  db: DbExecutor,
  input: { shopId: string; personId: string; byPersonId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const [cleared] = await db
    .update(people)
    .set({ noCertificationClearedAt: now, noCertificationClearedByPersonId: input.byPersonId })
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        isNotNull(people.noCertificationDeclaredAt),
        // Idempotent: a second submit of the same form (a double tap, a
        // back-button replay) must not rewrite the timestamp or the name on a
        // correction that already happened, which would make the trail lie
        // about when — and by whom — the record was actually corrected.
        isNull(people.noCertificationClearedAt),
      ),
    )
    .returning({ id: people.id });
  return Boolean(cleared);
}

async function recordLevel(
  tx: DbExecutor,
  input: RecordSelfDeclaredCardsInput,
  now: Date,
): Promise<SelfDeclarationOutcome> {
  if (!input.level) return "not_said";

  const live = await tx
    .select({
      id: certifications.id,
      // `status` is not decoration here: the rule is "still an unsighted
      // claim", and a claim a staffer has since verified off a real card keeps
      // its `selfDeclaredAt` stamp forever (provenance is history). Selecting
      // only the stamp asks "is this row not self-declared", which is a
      // different and much weaker question — see the guard below.
      status: certifications.status,
      selfDeclaredAt: certifications.selfDeclaredAt,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, input.shopId),
        eq(certifications.personId, input.personId),
        isNull(certifications.deletedAt),
      ),
    )
    // Deterministic, so "their own earlier statement" is the oldest one every
    // time rather than whatever the planner happened to return first.
    .orderBy(asc(certifications.createdAt));

  // The anti-displacement rule, stated with the shared predicate rather than
  // re-derived. `selfDeclaredAt !== null` was the bug: a card the diver
  // declared and a staffer then **sighted** still carries the stamp, so it did
  // not trip this — and an anonymous POST carrying only the diver's email and
  // the shop slug would overwrite the `level` on a `verified` row that keeps
  // its agency, its real card number and its `reviewedAt`. That is an anonymous
  // escalation to Instructor on evidence the shop believes it checked.
  if (live.some((card) => !isUnsightedSelfDeclaration(card))) return "card_on_file";

  // **And any real card in the other two tables settles it too.**
  //
  // Reading only `certifications` was a gap with no teeth while a claim was
  // inert: a diver whose shop had captured their verified nitrox card but never
  // typed a level card — an ordinary state, since the rung is the one a
  // divemaster eyeballs and does not transcribe — had an empty level table, so
  // an anonymous poster could write a level onto their record. Harmless while
  // `decideTripAdmission` ignored the row; not harmless from the moment it
  // started believing it (ADR 20260820-attested-at-booking-verified-at-boarding,
  // `security-reviewer`, 2026-08-20). It now refuses that diver's *next*
  // booking on a stranger's typing, which is precisely the exposure the ADR
  // claims cannot happen.
  //
  // So the trigger is what the sibling `recordNoCertification` already uses:
  // does this shop hold **real evidence of any kind** about this person? If it
  // does, an anonymous form does not get to add to the picture. The cost is a
  // genuine level statement dropped for a diver the shop half-knows, and they
  // can still tell a staffer; the alternative is a stranger moving a gate.
  if (await holdsRealCardOutsideLevels(tx, input)) return "card_on_file";

  // **The card the diver described**, in the two places it is safe to put it.
  //
  // The number goes to `declaredIdentifier`, never to `identifier`: that column
  // is a *key*, and writing a stranger's typing into it makes the sale fail on
  // a collision, answers "is this number on file here?" to anyone who watches,
  // and — via `heldForReview` — takes the card-entry form away from the real
  // diver. See the column's own note in schema.ts for the `security-reviewer`
  // findings behind each of those.
  //
  // The agency does go to `agency`, and that is safe for one specific reason: a
  // claim's `identifier` stays NULL, and a NULL is invisible to the unique
  // index. `other` when the diver did not say — the enum's honest "unstated",
  // never an invented agency.
  const card = {
    agency: input.agency ?? "other",
    declaredIdentifier: input.identifier?.trim() || null,
  } as const;

  // `find`, not `live[0]`: every row here passed the guard above, but choosing
  // by predicate rather than by position means a record that somehow holds more
  // than one row cannot be arbitrated by insertion order.
  const own = live.find(isUnsightedSelfDeclaration);
  if (own) {
    await tx
      .update(certifications)
      .set({ level: input.level, selfDeclaredAt: now, ...card })
      .where(
        and(
          eq(certifications.id, own.id),
          eq(certifications.shopId, input.shopId),
          // The read above filtered deleted rows; a staff `deleteCertification`
          // landing between the two would otherwise let an anonymous post edit
          // a card the shop has just retracted (`security-reviewer`).
          isNull(certifications.deletedAt),
          // Defence in depth: the guard above already proved this row is a
          // still-unsighted claim, and this re-states it in the statement that
          // actually writes, where no later refactor of the read can lose it.
          eq(certifications.status, "pending"),
          isNotNull(certifications.selfDeclaredAt),
        ),
      );
    return "recorded";
  }

  await tx.insert(certifications).values({
    shopId: input.shopId,
    personId: input.personId,
    level: input.level,
    // NULL, always: the shop holds no number for this person, and that is the
    // fact `heldForReview` and the diver's own checklist both read.
    identifier: null,
    status: "pending",
    selfDeclaredAt: now,
    ...card,
  });
  return "recorded";
}

/**
 * **What one list joiner can dive, as far as anybody here knows** — the row the
 * staff last-minute-deal and wait-list panels put beside a name so nobody mails
 * an Open Water diver a discount on a deep wreck.
 *
 * `selfDeclared` is the whole point of the shape. A shop's own record wins when
 * it has one: a real card renders as a plain level, and only a claim nobody has
 * checked carries the mark. That ordering also means the mark can never be
 * *missing* from a claim — the alternative reading, where an unmarked level
 * might be either, is exactly the laundering this feature was written to avoid.
 *
 * `null` for a person nothing is known about, which the panels state as "not
 * said" rather than leaving blank.
 *
 * **Named for what it is, after one rename.** It was `DeclaredDiveProfile`
 * until 2026-08-15, and to a diver a *dive profile* is the depth/time curve of
 * a dive that already happened — the opposite end of the sport from "what may
 * this person dive". Nothing user-visible ever carried the phrase, so this is
 * naming rather than copy; it is corrected because the next careless heading
 * would have made it a real credibility error in front of an instructor.
 */
export type CertificationSummary = {
  level: CertificationLevel | null;
  /** True when `level` is a still-unsighted self-declaration. */
  levelSelfDeclared: boolean;
  /**
   * True when this person said on a public opt-in that they hold no card at all
   * (`people.no_certification_declared_at`) **and nothing the shop holds
   * contradicts it**.
   *
   * The stamp is ignored rather than deleted (ADR 20260814-self-declared-cards),
   * and *ignored* is decided here, on the same three-table test the writer
   * applies: any live card that is not itself a still-unsighted claim — a
   * level, a nitrox card, or a specialty — supersedes it. A reader that
   * suppressed the stamp on a *level* alone would put "Not certified yet —
   * diver's word" beside a verified nitrox card, which is a sentence no
   * instructor would write and which the writer's own guard already refuses to
   * create (found in the 2026-08-15 `dive-domain-expert` review).
   *
   * A *claim* does not supersede it: a person who declared "no card" and later
   * declared a rung keeps both flags, and the phrase renders the rung — the
   * later, more specific statement.
   *
   * False too once a staffer has cleared it
   * (`clearNoCertificationDeclaration`): that is not a fact this reader is
   * choosing to ignore, it is a fact the shop has said was never stated.
   */
  noCertificationDeclared: boolean;
  nitrox: boolean;
  /** True when the nitrox card behind `nitrox` is a still-unsighted claim. */
  nitroxSelfDeclared: boolean;
};

/**
 * The profile above for a set of people at one shop, as a map keyed by person
 * id. Empty input short-circuits — an empty `inArray` is a query that cannot
 * match and should not be sent.
 *
 * Separate reads rather than one join: level, nitrox, specialty and "no card at
 * all" live in four places by design (a specialty is not a ladder rung, and the
 * absence of a card is not a card), and a join across them would multiply rows
 * for a diver holding several of each. Sequential, never `Promise.all` — this
 * can be handed a transaction.
 */
export async function listCertificationSummaries(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, CertificationSummary>> {
  const summaries = new Map<string, CertificationSummary>();
  if (personIds.length === 0) return summaries;

  // The stamp on the person, first, so a joiner whose only answer was "I'm not
  // certified yet" still gets a summary — the alternative is that the most
  // safety-relevant answer on the form is the one that renders as silence. It
  // is provisional until the card reads below have had their say: anything the
  // shop actually holds supersedes it.
  //
  // A stamp a staffer has **cleared** is out here rather than suppressed at the
  // end beside `carded`, and the difference matters: a cleared stamp is not a
  // statement this reader is choosing to ignore, it is a statement the shop has
  // said was never made. There is no pair of timestamps to compare because
  // `recordNoCertification` nulls the clear whenever a fresh answer arrives.
  const declaredRows = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(people.id, [...personIds]),
        isNotNull(people.noCertificationDeclaredAt),
        isNull(people.noCertificationClearedAt),
      ),
    );
  const declared = new Set(declaredRows.map((row) => row.id));
  /** People a real card refutes — the stamp comes off their summary at the end. */
  const carded = new Set<string>();
  for (const id of declared) {
    summaries.set(id, { ...blankSummary(), noCertificationDeclared: true });
  }

  const levelRows = await db
    .select({
      personId: certifications.personId,
      level: certifications.level,
      status: certifications.status,
      selfDeclaredAt: certifications.selfDeclaredAt,
    })
    .from(certifications)
    .where(
      and(
        eq(certifications.shopId, shopId),
        inArray(certifications.personId, [...personIds]),
        isNull(certifications.deletedAt),
      ),
    );

  for (const row of levelRows) {
    const selfDeclared = isUnsightedSelfDeclaration(row);
    if (!selfDeclared) carded.add(row.personId);
    const current = summaries.get(row.personId) ?? blankSummary();
    // A card the shop actually holds beats a claim outright, whatever the
    // rungs say; between two of the same kind, the higher rung wins.
    const better =
      current.level === null ||
      (current.levelSelfDeclared && !selfDeclared) ||
      (current.levelSelfDeclared === selfDeclared &&
        certificationRank(row.level) > certificationRank(current.level));
    summaries.set(row.personId, {
      ...current,
      ...(better ? { level: row.level, levelSelfDeclared: selfDeclared } : undefined),
    });
  }

  const nitroxRows = await db
    .select({
      personId: nitroxCertifications.personId,
      status: nitroxCertifications.status,
      selfDeclaredAt: nitroxCertifications.selfDeclaredAt,
    })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.shopId, shopId),
        inArray(nitroxCertifications.personId, [...personIds]),
        isNull(nitroxCertifications.deletedAt),
      ),
    );

  for (const row of nitroxRows) {
    const selfDeclared = isUnsightedSelfDeclaration(row);
    if (!selfDeclared) carded.add(row.personId);
    const current = summaries.get(row.personId) ?? blankSummary();
    summaries.set(row.personId, {
      ...current,
      nitrox: true,
      // One real card among the claims settles it: the mark says "nothing here
      // is checked", so it must come off the moment something is.
      nitroxSelfDeclared: current.nitrox
        ? current.nitroxSelfDeclared && selfDeclared
        : selfDeclared,
    });
  }

  // **Only for the stamp**, and only when there is a stamp to refute. A
  // specialty card says nothing about a rung, so it never joins the phrase —
  // but it is a card the shop holds, and "this diver has no card at all" is
  // false in front of one. `specialty_certifications` has no `self_declared_at`
  // at all, so a live row is always evidence.
  const unrefuted = [...declared].filter((id) => !carded.has(id));
  if (unrefuted.length > 0) {
    const specialtyRows = await db
      .select({ personId: specialtyCertifications.personId })
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, shopId),
          inArray(specialtyCertifications.personId, unrefuted),
          isNull(specialtyCertifications.deletedAt),
        ),
      );
    for (const row of specialtyRows) carded.add(row.personId);
  }

  // The stamp is *ignored*, never deleted — and this is where ignoring happens,
  // on the same test the writer refuses to write against. Without it a diver
  // whose shop holds a verified nitrox card, or a Deep card, and no level card
  // reads as "Not certified yet — diver's word", warning-toned, and is lifted
  // to the top of the send list over the departure's real risks.
  for (const id of carded) {
    const current = summaries.get(id);
    if (current?.noCertificationDeclared) {
      summaries.set(id, { ...current, noCertificationDeclared: false });
    }
  }

  return summaries;
}

function blankSummary(): CertificationSummary {
  return {
    level: null,
    levelSelfDeclared: false,
    noCertificationDeclared: false,
    nitrox: false,
    nitroxSelfDeclared: false,
  };
}

async function recordNitrox(
  tx: DbExecutor,
  input: RecordSelfDeclaredCardsInput,
  now: Date,
): Promise<SelfDeclarationOutcome> {
  // An unticked box is not "I am not nitrox certified", it is silence — so a
  // false never clears or contradicts anything already on file.
  if (!input.nitrox) return "not_said";

  const live = await tx
    .select({
      id: nitroxCertifications.id,
      status: nitroxCertifications.status,
      selfDeclaredAt: nitroxCertifications.selfDeclaredAt,
    })
    .from(nitroxCertifications)
    .where(
      and(
        eq(nitroxCertifications.shopId, input.shopId),
        eq(nitroxCertifications.personId, input.personId),
        isNull(nitroxCertifications.deletedAt),
      ),
    )
    .orderBy(asc(nitroxCertifications.createdAt));

  // The same one-line bug as the level twin, and the same fix. It costs less
  // here — a nitrox row has no level to escalate — but it still let an
  // anonymous post rewrite `selfDeclaredAt` on a card a staffer had sighted,
  // which is falsifying the provenance of the row that authorizes a gas fill.
  if (live.some((card) => !isUnsightedSelfDeclaration(card))) return "card_on_file";

  const own = live.find(isUnsightedSelfDeclaration);
  if (own) {
    // Nothing to change but the date they last said it — a nitrox card carries
    // no level, so re-declaring is only a fresher timestamp.
    await tx
      .update(nitroxCertifications)
      .set({ selfDeclaredAt: now })
      .where(
        and(
          eq(nitroxCertifications.id, own.id),
          eq(nitroxCertifications.shopId, input.shopId),
          eq(nitroxCertifications.status, "pending"),
          isNotNull(nitroxCertifications.selfDeclaredAt),
        ),
      );
    return "recorded";
  }

  await tx.insert(nitroxCertifications).values({
    shopId: input.shopId,
    personId: input.personId,
    agency: "other",
    identifier: null,
    status: "pending",
    selfDeclaredAt: now,
  });
  return "recorded";
}
