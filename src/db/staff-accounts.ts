import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { type Role, STAFF_ROLES } from "@/lib/authz";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import { hashPassword } from "@/lib/password-hashing";
import type { AppDb, DbExecutor } from "./client";
import { people, personRoles, pushSubscriptions, userAccounts } from "./schema";

export type StaffMember = {
  personId: string;
  fullName: string;
  email: string;
  roles: Role[];
  userAccountId: string;
  accountStatus: "invited" | "active" | "disabled";
};

/** Every non-deleted person in the shop holding at least one staff role, name-sorted. */
export async function listShopStaff(db: DbExecutor, shopId: string): Promise<StaffMember[]> {
  const rows = await db
    .select({
      personId: people.id,
      fullName: people.fullName,
      email: people.email,
      role: personRoles.role,
      userAccountId: userAccounts.id,
      accountStatus: userAccounts.status,
    })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(people.fullName);

  const byPerson = new Map<string, StaffMember>();
  for (const row of rows) {
    const existing = byPerson.get(row.personId);
    if (existing) {
      existing.roles.push(row.role as Role);
      continue;
    }
    byPerson.set(row.personId, {
      personId: row.personId,
      fullName: row.fullName,
      email: row.email ?? "",
      roles: [row.role as Role],
      userAccountId: row.userAccountId,
      accountStatus: row.accountStatus,
    });
  }
  return [...byPerson.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Case-insensitive, mirrors `people_shop_email_unique` (schema.ts). */
async function selectActivePersonByEmail(tx: DbExecutor, shopId: string, email: string) {
  const [row] = await tx
    .select()
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        sql`lower(${people.email}) = ${email}`,
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Whether `personId` is a live (non-deleted) person in this shop — the
 * tenant-scoping check every staff mutation below must pass before touching
 * `person_roles`/`user_accounts` by id alone, since those tables carry no
 * `shop_id` of their own to filter a `WHERE` on directly (security review
 * finding: a mutation that only re-derives the shop for its *last-owner*
 * check, and not for the write itself, lets one shop's owner/manager edit a
 * different shop's roster given the target's raw id).
 */
async function personInShop(tx: DbExecutor, shopId: string, personId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .limit(1);
  return Boolean(row);
}

/** As {@link personInShop}, and also that `userAccountId` is that exact person's own account. */
async function staffAccountInShop(
  tx: DbExecutor,
  shopId: string,
  personId: string,
  userAccountId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .where(
      and(
        eq(userAccounts.id, userAccountId),
        eq(userAccounts.personId, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Whether this personId is the shop's only person currently holding the `owner` role. */
async function isLastOwner(tx: DbExecutor, shopId: string, personId: string): Promise<boolean> {
  const owners = await tx
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(personRoles.role, "owner"), eq(people.shopId, shopId), isNull(people.deletedAt)));
  const ownerIds = new Set(owners.map((row) => row.personId));
  return ownerIds.has(personId) && ownerIds.size === 1;
}

export type InviteStaffResult =
  | { ok: true; personId: string; userAccountId: string }
  | { ok: false; reason: "already_on_team" | "email_registered_elsewhere" | "email_reserved" };

/**
 * Invites a new staff member: reuses the shop's existing active person by
 * email when there is one (a diver who's about to start crewing keeps their
 * one record — glossary Modeling notes), otherwise creates a new person.
 * Adds the requested roles and a fresh `user_accounts` row in `invited`
 * status with an unusable random password (never handed to anyone — the
 * invitee sets their own on `/invite/[token]`). Returns a discriminated
 * result rather than throwing for the two known refusal cases, mirroring
 * `onboardAction`'s tx.rollback() + outer-error-variable idiom
 * (20260726-staff-invite-accounts).
 */
export async function inviteStaffMember(
  db: AppDb,
  input: { shopId: string; fullName: string; email: string; roles: Role[] },
): Promise<InviteStaffResult> {
  const email = input.email.toLowerCase();

  // The reserved demo namespace is not an address a real teammate can be
  // invited at. ADR 20260803-demo-bypass-containment's third condition rests on
  // "no real shop's account is in `*.demo.invalid`", and until now that held
  // only because this function mails the invite and `.invalid` never
  // resolves — an emergent property, not an enforced one. Enforced here, the
  // last combination closes: a tenant whose `is_demo` is flipped can no longer
  // already contain an account the demo password would open. Refused with a
  // code; the caller picks the words.
  if (isDemoAccountEmail(email)) return { ok: false, reason: "email_reserved" };

  let refusal: InviteStaffResult | null = null;

  try {
    const created = await db.transaction(async (tx) => {
      // A different shop's account already owns this email — user_accounts.email
      // is globally unique, so this must be refused before the insert throws a
      // raw constraint error.
      const [crossShopAccount] = await tx
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .innerJoin(people, eq(people.id, userAccounts.personId))
        .where(and(eq(userAccounts.email, email), ne(people.shopId, input.shopId)))
        .limit(1);
      if (crossShopAccount) {
        refusal = { ok: false, reason: "email_registered_elsewhere" };
        tx.rollback();
      }

      const existingPerson = await selectActivePersonByEmail(tx, input.shopId, email);
      let personId: string;
      if (existingPerson) {
        const [existingAccount] = await tx
          .select({ id: userAccounts.id })
          .from(userAccounts)
          .where(eq(userAccounts.personId, existingPerson.id))
          .limit(1);
        if (existingAccount) {
          refusal = { ok: false, reason: "already_on_team" };
          tx.rollback();
        }
        personId = existingPerson.id;
      } else {
        const [inserted] = await tx
          .insert(people)
          .values({ shopId: input.shopId, fullName: input.fullName, email })
          .returning({ id: people.id });
        if (!inserted) throw new Error("inviteStaffMember: failed to create person");
        personId = inserted.id;
      }

      if (input.roles.length > 0) {
        await tx
          .insert(personRoles)
          .values(input.roles.map((role) => ({ personId, role })))
          .onConflictDoNothing();
      }

      // Never given to anyone: the invitee chooses their real password when
      // they accept the invite, and until then this hash cannot match any
      // submitted password.
      const hashedPassword = await hashPassword(randomBytes(32).toString("hex"));
      const [account] = await tx
        .insert(userAccounts)
        .values({ personId, email, hashedPassword, status: "invited" })
        .returning({ id: userAccounts.id });
      if (!account) throw new Error("inviteStaffMember: failed to create user account");

      return { personId, userAccountId: account.id };
    });
    return { ok: true, personId: created.personId, userAccountId: created.userAccountId };
  } catch (error) {
    if (refusal) return refusal;
    throw error;
  }
}

/**
 * The live `STAFF_ROLES` subset a person currently holds — a snapshot taken
 * before `removeStaffMember` strips them, so a land-then-undo toast has what
 * it needs to hand back to `setStaffRoles` on restore.
 */
export async function getStaffRoles(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<Role[]> {
  const rows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(
      and(
        eq(personRoles.personId, personId),
        eq(people.shopId, shopId),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    );
  return rows.map((row) => row.role as Role);
}

export type StaffMutationResult = { ok: true } | { ok: false; reason: "last_owner" | "not_found" };

/**
 * Replaces exactly the `STAFF_ROLES` subset of a person's roles — a `diver`
 * row (if any) is untouched, since staff-ness and diver-ness are independent
 * facts about the same person. Refuses if `personId` isn't a live person in
 * this shop, or if the change would leave the shop with zero owners.
 */
export async function setStaffRoles(
  db: AppDb,
  input: { shopId: string; personId: string; roles: Role[] },
): Promise<StaffMutationResult> {
  return db.transaction(async (tx) => {
    if (!(await personInShop(tx, input.shopId, input.personId))) {
      return { ok: false, reason: "not_found" };
    }
    if (!input.roles.includes("owner") && (await isLastOwner(tx, input.shopId, input.personId))) {
      return { ok: false, reason: "last_owner" };
    }
    await tx
      .delete(personRoles)
      .where(
        and(eq(personRoles.personId, input.personId), inArray(personRoles.role, [...STAFF_ROLES])),
      );
    if (input.roles.length > 0) {
      await tx
        .insert(personRoles)
        .values(input.roles.map((role) => ({ personId: input.personId, role })));
    }
    return { ok: true };
  });
}

/**
 * Disables (revokes sign-in for) or re-enables a staff member's account.
 * Refuses if `userAccountId` isn't this exact `personId`'s own account in
 * this shop.
 */
export async function setStaffAccountStatus(
  db: AppDb,
  input: { shopId: string; personId: string; userAccountId: string; status: "active" | "disabled" },
): Promise<StaffMutationResult> {
  return db.transaction(async (tx) => {
    if (!(await staffAccountInShop(tx, input.shopId, input.personId, input.userAccountId))) {
      return { ok: false, reason: "not_found" };
    }
    if (input.status === "disabled" && (await isLastOwner(tx, input.shopId, input.personId))) {
      return { ok: false, reason: "last_owner" };
    }
    await tx
      .update(userAccounts)
      .set({ status: input.status })
      .where(eq(userAccounts.id, input.userAccountId));
    return { ok: true };
  });
}

/**
 * Removes someone from the team: strips every staff role (a `diver` row, if
 * any, is untouched) and disables their account. Never soft-deletes the
 * `people` row — that's the separately-gated `canDeleteDiver` action, for a
 * different purpose. Refuses if `userAccountId` isn't this exact `personId`'s
 * own account in this shop.
 */
export async function removeStaffMember(
  db: AppDb,
  input: { shopId: string; personId: string; userAccountId: string },
): Promise<StaffMutationResult> {
  return db.transaction(async (tx) => {
    if (!(await staffAccountInShop(tx, input.shopId, input.personId, input.userAccountId))) {
      return { ok: false, reason: "not_found" };
    }
    if (await isLastOwner(tx, input.shopId, input.personId)) {
      return { ok: false, reason: "last_owner" };
    }
    await tx
      .delete(personRoles)
      .where(
        and(eq(personRoles.personId, input.personId), inArray(personRoles.role, [...STAFF_ROLES])),
      );
    await tx
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.id, input.userAccountId));
    // Revoke this person's push subscriptions in the same transaction (ADR
    // 20260804-manifest-web-push). Disabling the account does not reach them:
    // the `people` row deliberately survives, so the row's ON DELETE CASCADE
    // never fires, and the send path filters on shop and trip rather than on
    // who still works here. Without this a departed divemaster's phone keeps
    // being told a boat's manifest changed, after their login stopped working.
    await tx
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.shopId, input.shopId),
          eq(pushSubscriptions.personId, input.personId),
        ),
      );
    return { ok: true };
  });
}
