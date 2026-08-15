import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type CertificationLevel,
  certificationRank,
  isUnsightedSelfDeclaration,
} from "@/lib/readiness";
import type { DbExecutor } from "./client";
import { certifications, nitroxCertifications, people } from "./schema";

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
  /** False and undefined are the same thing here: an unticked box says nothing. */
  nitrox?: boolean;
  now?: Date;
};

export type RecordSelfDeclaredCardsOutcome = {
  level: SelfDeclarationOutcome;
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
  const [locked] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1)
    .for("update");
  // Not this shop's person (or not a person at all). Every write below is
  // narrowed by `shopId` as well, so this is a second door on the same rule —
  // but returning here keeps a caller holding a foreign id from getting an
  // outcome that reads like something was considered.
  if (!locked) return { level: "not_said", nitrox: "not_said" };
  return {
    level: await recordLevel(tx, input, now),
    nitrox: await recordNitrox(tx, input, now),
  };
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

  // `find`, not `live[0]`: every row here passed the guard above, but choosing
  // by predicate rather than by position means a record that somehow holds more
  // than one row cannot be arbitrated by insertion order.
  const own = live.find(isUnsightedSelfDeclaration);
  if (own) {
    await tx
      .update(certifications)
      .set({ level: input.level, selfDeclaredAt: now })
      .where(
        and(
          eq(certifications.id, own.id),
          eq(certifications.shopId, input.shopId),
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
    // The forms never ask which agency, and inventing one would be the same
    // laundering the `selfDeclaredAt` stamp exists to prevent. `other` is the
    // enum's honest "unstated"; the staff surfaces render the level alone for a
    // still-pending self-declaration rather than naming an agency nobody gave.
    agency: "other",
    level: input.level,
    identifier: null,
    status: "pending",
    selfDeclaredAt: now,
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
 */
export type DeclaredDiveProfile = {
  level: CertificationLevel | null;
  /** True when `level` is a still-unsighted self-declaration. */
  levelSelfDeclared: boolean;
  nitrox: boolean;
  /** True when the nitrox card behind `nitrox` is a still-unsighted claim. */
  nitroxSelfDeclared: boolean;
};

/**
 * The profile above for a set of people at one shop, as a map keyed by person
 * id. Empty input short-circuits — an empty `inArray` is a query that cannot
 * match and should not be sent.
 *
 * Two reads rather than one join: level and nitrox live in separate tables by
 * design (a specialty is not a ladder rung), and a join across them would
 * multiply rows for a diver holding several of each. Sequential, never
 * `Promise.all` — this can be handed a transaction.
 */
export async function listDeclaredDiveProfiles(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, DeclaredDiveProfile>> {
  const profiles = new Map<string, DeclaredDiveProfile>();
  if (personIds.length === 0) return profiles;

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
    const current = profiles.get(row.personId) ?? blankProfile();
    // A card the shop actually holds beats a claim outright, whatever the
    // rungs say; between two of the same kind, the higher rung wins.
    const better =
      current.level === null ||
      (current.levelSelfDeclared && !selfDeclared) ||
      (current.levelSelfDeclared === selfDeclared &&
        certificationRank(row.level) > certificationRank(current.level));
    profiles.set(row.personId, {
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
    const current = profiles.get(row.personId) ?? blankProfile();
    profiles.set(row.personId, {
      ...current,
      nitrox: true,
      // One real card among the claims settles it: the mark says "nothing here
      // is checked", so it must come off the moment something is.
      nitroxSelfDeclared: current.nitrox
        ? current.nitroxSelfDeclared && selfDeclared
        : selfDeclared,
    });
  }

  return profiles;
}

function blankProfile(): DeclaredDiveProfile {
  return { level: null, levelSelfDeclared: false, nitrox: false, nitroxSelfDeclared: false };
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
