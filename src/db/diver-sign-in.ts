import { and, eq, exists, isNull, sql } from "drizzle-orm";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { mintCapability, openCapability, spendCapability } from "./capabilities";
import type { AppDb, DbExecutor } from "./client";
import { capabilities, people } from "./schema";

/**
 * **A diver's own sign-in** (ADR 20261125-diver-sign-in): two `capabilities`
 * purposes over one person row in one shop. `diver_sign_in` is the emailed
 * link, spent once; `diver_session` is what the tap leaves in the diver's
 * cookie, opened on every request until it expires or they sign out.
 *
 * Every read here re-checks that the person is still a live row of the shop
 * the capability names: a delete, a merge or an erasure leaves the session
 * opening nothing, whatever the cookie still holds.
 */

/** The person a row names is still this shop's, and still someone (not deleted, merged or erased). */
function livePersonOfRow() {
  return exists(
    sql`(select 1 from ${people} where ${people.id} = ${capabilities.personId} and ${people.shopId} = ${capabilities.shopId} and ${people.deletedAt} is null and ${people.anonymizedAt} is null and ${people.mergedIntoPersonId} is null)`,
  );
}

async function livePerson(db: DbExecutor, shopId: string, personId: string) {
  const [person] = await db
    .select({
      id: people.id,
      fullName: people.fullName,
      email: people.email,
      locale: people.locale,
    })
    .from(people)
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  return person ?? null;
}

/**
 * Mints a sign-in link for the shop's live person at this address, or null
 * when there is none. The caller sends it to the address on the row, never to
 * the one typed, and answers the same either way.
 */
export async function issueDiverSignIn(
  db: DbExecutor,
  input: { shopId: string; email: string; now?: Date },
) {
  const email = input.email.trim().toLowerCase();
  if (!email) return null;
  const [person] = await db
    .select({
      id: people.id,
      fullName: people.fullName,
      email: people.email,
      locale: people.locale,
    })
    .from(people)
    .where(
      and(
        eq(people.shopId, input.shopId),
        sql`lower(${people.email}) = ${email}`,
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!person?.email) return null;
  const minted = await mintCapability(db, {
    purpose: "diver_sign_in",
    shopId: input.shopId,
    subjectId: person.id,
    now: input.now,
  });
  if (!minted.expiresAt) throw new Error("diver_sign_in must expire");
  return {
    token: minted.token,
    tokenId: minted.id,
    expiresAt: minted.expiresAt,
    person: { ...person, email: person.email },
  };
}

/**
 * Spends a sign-in link and opens a session for the person it names, in one
 * transaction: a link spent twice at once opens one session, and a link whose
 * person has gone since it was mailed opens none and stays unspent.
 */
export async function startDiverSession(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<{ token: string; shopId: string; personId: string; expiresAt: Date } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) return null;
  return db.transaction(async (tx) => {
    const spent = await spendCapability(tx, {
      purpose: "diver_sign_in",
      token: input.token,
      now: input.now,
      alsoRequire: livePersonOfRow(),
    });
    if (!spent) return null;
    const session = await mintCapability(tx, {
      purpose: "diver_session",
      shopId: spent.shopId,
      subjectId: spent.subjectId,
      now: input.now,
    });
    if (!session.expiresAt) throw new Error("diver_session must expire");
    return {
      token: session.token,
      shopId: spent.shopId,
      personId: spent.subjectId,
      expiresAt: session.expiresAt,
    };
  });
}

export type DiverSession = { capabilityId: string; shopId: string; personId: string };

/**
 * The signed-in diver a session cookie names **in this shop**, or null. A
 * session from another shop, an expired or signed-out one, and one whose
 * person was deleted, merged or erased all read as nobody.
 */
export async function readDiverSession(
  db: DbExecutor,
  input: { shopId: string; token: string | null | undefined; now?: Date },
): Promise<DiverSession | null> {
  if (!input.token || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) return null;
  const live = await openCapability(db, {
    purpose: "diver_session",
    token: input.token,
    now: input.now,
  });
  if (!live || live.shopId !== input.shopId) return null;
  if (!(await livePerson(db, input.shopId, live.subjectId))) return null;
  return { capabilityId: live.id, shopId: live.shopId, personId: live.subjectId };
}

/**
 * Re-proves a session inside a writer's transaction, after the writer has
 * taken its own locks: the same answer as {@link readDiverSession}, read where
 * a sign-out or an erasure committed meanwhile is seen.
 */
export async function lockDiverSession(
  tx: DbExecutor,
  input: { shopId: string; token: string; now?: Date },
): Promise<DiverSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) return null;
  const [row] = await tx
    .select({ id: capabilities.id, personId: capabilities.personId })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.purpose, "diver_session"),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        eq(capabilities.shopId, input.shopId),
        isNull(capabilities.revokedAt),
        sql`${capabilities.expiresAt} > ${input.now ?? nowDate()}`,
        livePersonOfRow(),
      ),
    )
    .for("share");
  return row?.personId
    ? { capabilityId: row.id, shopId: input.shopId, personId: row.personId }
    : null;
}

/** Sign out: the session this cookie holds opens nothing from now on. */
export async function endDiverSession(
  db: DbExecutor,
  input: { token: string | null | undefined; now?: Date },
): Promise<void> {
  if (!input.token) return;
  await db
    .update(capabilities)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(capabilities.purpose, "diver_session"),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        isNull(capabilities.revokedAt),
      ),
    );
}
