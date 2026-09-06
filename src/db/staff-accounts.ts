import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { type Role, STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { crewPublicNameToStore } from "@/lib/crew-public-name";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import { hashPassword } from "@/lib/password-hashing";
import { isSpokenLanguageTag } from "@/lib/spoken-languages";
import type { AppDb, DbExecutor } from "./client";
import { accountSessions, people, personRoles, pushSubscriptions, userAccounts } from "./schema";

export type StaffMember = {
  personId: string;
  fullName: string;
  email: string;
  roles: Role[];
  userAccountId: string;
  accountStatus: "invited" | "active" | "disabled";
  /**
   * Who to call for this staff member. Optional at every point — nobody is
   * asked for one at invite, and a shop that never fills these in loses nothing
   * it had before.
   *
   * It is on the *team* page rather than a new hiring flow because the boat
   * manifest prints it: the printed sheet a coastguard reads used to answer
   * "who do we call?" for every paying diver and for neither of the two staff
   * most reliably in the water (dive-domain review 20260810), and a fact that
   * has to reach paper needs somewhere a human can put it.
   */
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /** BCP-47 tags this person can hold a conversation in (issue #708). Empty until a shop records one. */
  spokenLanguages: string[];
  /**
   * The name this person publishes to divers, or null if they have not
   * consented (issue #1357).
   *
   * The shop is accountable for what its own public pages say, and until this
   * it could not read them without browsing `/s/<slug>/trips/<id>` departure by
   * departure — `crew_public_name` is typed by each person for themselves
   * (issue #1351), so it is the one string on a public page nobody at the shop
   * chose. Read-only on the roster, and deliberately: taking a name down is an
   * override of somebody else's consent and needs a human answer about what
   * happens to the consent afterwards, which is why the issue leaves it open.
   *
   * Null is *both* "declined" and "never asked", indistinguishably, which is
   * the boundary the whole feature rests on: a roster that showed who said no
   * would be a list of who said no.
   *
   * One column rather than two, but the equivalence is narrower than it looks
   * and the roster's reader is written for the narrow one.
   * `people_crew_public_name_with_consent` pairs the stamp with a name that is
   * non-blank **after Postgres `btrim`** — which strips ASCII space and nothing
   * else — so a tab-only name would satisfy it, and `'   '` beside a null stamp
   * satisfies it too. No writer can produce either today
   * (`crewPublicNameToStore` maps every `\p{Cc}` to a space and trims), and the
   * surface trims again rather than resting on that.
   *
   * The stamp is also not the whole condition for publishing: `tripPublicCrew`
   * requires an `active` account as well, and a disable deliberately leaves a
   * consent standing. So a surface stating what divers *see* reads
   * `accountStatus` beside this — both found by a security pass on the commit
   * that added the column to this projection.
   */
  crewPublicName: string | null;
  /**
   * When that person agreed to be named, shown beside the name and only there.
   * A declined row and a never-asked row both carry a null name and a null
   * stamp, so neither the name nor its date can tell them apart.
   */
  crewPublicConsentAt: Date | null;
};

/**
 * Every language *any* active staff member has recorded speaking, deduplicated
 * — the shop-wide "we speak …" line (issue #708), shown on the public
 * schedule so a diver sees it before booking, not only on a trip's crew list
 * afterward. Safe to call from a public page: it names no one, only the set
 * of languages the shop can point to somewhere among its team.
 */
export async function listShopSpokenLanguages(db: DbExecutor, shopId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ language: sql<string>`jsonb_array_elements_text(${people.spokenLanguages})` })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        eq(userAccounts.status, "active"),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    );
  return rows.map((row) => row.language);
}

/** Every non-deleted person in the shop holding at least one staff role, name-sorted. */
export async function listShopStaff(db: DbExecutor, shopId: string): Promise<StaffMember[]> {
  const rows = await db
    .select({
      personId: people.id,
      fullName: people.fullName,
      email: people.email,
      emergencyContactName: people.emergencyContactName,
      emergencyContactPhone: people.emergencyContactPhone,
      spokenLanguages: people.spokenLanguages,
      crewPublicName: people.crewPublicName,
      crewPublicConsentAt: people.crewPublicConsentAt,
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
      emergencyContactName: row.emergencyContactName,
      emergencyContactPhone: row.emergencyContactPhone,
      spokenLanguages: row.spokenLanguages,
      crewPublicName: row.crewPublicName,
      crewPublicConsentAt: row.crewPublicConsentAt,
    });
  }
  return [...byPerson.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Its own result type rather than a widened `StaffMutationResult`: `half_filled`
 * cannot happen to any other staff mutation, and adding it to the shared union
 * would make every existing caller handle a reason it can never receive.
 */
export type StaffEmergencyContactResult =
  | { ok: true }
  | { ok: false; reason: "half_filled" | "not_found" };

/**
 * Set (or clear) one staff member's emergency contact.
 *
 * Scoped by `shopId` and by holding a staff role, so this cannot be pointed at
 * an arbitrary `people` row: a shop's diver records are edited from the diver
 * record, and only the team page's own subjects are reachable here.
 *
 * Both halves move together and an empty string stores `null`. A name with no
 * number is the shape that fails at the moment it is needed, so the pair is
 * written whole or cleared whole rather than left half-filled.
 */
export async function setStaffEmergencyContact(
  db: DbExecutor,
  {
    shopId,
    personId,
    name,
    phone,
  }: { shopId: string; personId: string; name: string; phone: string },
): Promise<StaffEmergencyContactResult> {
  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();
  if (Boolean(trimmedName) !== Boolean(trimmedPhone)) return { ok: false, reason: "half_filled" };

  const updated = await db
    .update(people)
    .set({
      emergencyContactName: trimmedName || null,
      emergencyContactPhone: trimmedPhone || null,
    })
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        // Only a person who actually holds a staff role — the team page's own
        // subjects. Without this the action is a general-purpose writer for any
        // `people` row in the shop, reached by editing one hidden field.
        inArray(
          people.id,
          db
            .select({ id: personRoles.personId })
            .from(personRoles)
            .where(inArray(personRoles.role, [...STAFF_ROLES])),
        ),
      ),
    )
    .returning({ id: people.id });

  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * Set (or clear) the languages one staff member speaks (issue #708) — the
 * same scoping `setStaffEmergencyContact` above uses, and the same reason:
 * this cannot be pointed at an arbitrary `people` row, only the team page's
 * own staff subjects.
 *
 * Filters to `COMMON_SPOKEN_LANGUAGES` rather than trusting the submitted
 * list outright: the form only ever offers that set, so anything else can
 * only be a stale or tampered request, and this is the one place that
 * decides what "a language tag" means for the column.
 */
export async function setStaffLanguages(
  db: DbExecutor,
  { shopId, personId, languages }: { shopId: string; personId: string; languages: string[] },
): Promise<boolean> {
  const spokenLanguages = [
    ...new Set(languages.filter((language) => isSpokenLanguageTag(language))),
  ];
  const updated = await db
    .update(people)
    .set({ spokenLanguages })
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(
          people.id,
          db
            .select({ id: personRoles.personId })
            .from(personRoles)
            .where(inArray(personRoles.role, [...STAFF_ROLES])),
        ),
      ),
    )
    .returning({ id: people.id });
  return updated.length > 0;
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
      //
      // **The words for this refusal say what to do, not what was found.** The
      // condition is a fact about *another tenant*, and until 2026-08-27 the
      // message stated it outright ("That email is already registered to a
      // different shop"). It is a narrow oracle — the caller must already be
      // authenticated staff and already know the address — but it is a fact
      // about a shop this one has no relationship with, crossing a boundary the
      // rest of this codebase defends carefully, and it bought the inviting
      // shop nothing: what they need is a different address, and that is now
      // all they are told (issue #721).
      //
      // Deliberately **not** collapsed into `already_on_team`. The two are
      // different conditions and only one is about this tenant: "that person
      // already has an account here" is a fact about the caller's own team,
      // which they can read off the page behind the form, and telling a shop
      // that about somebody who is *not* on their team would be a lie that also
      // gives them the wrong instruction. Same-message-for-both closes nothing
      // extra either: any refusal at all already says the address is
      // unavailable, because the unique index leaves no version of this that
      // succeeds. What was worth removing was the sentence naming another
      // shop's existence, and that is gone.
      //
      // Whether one human may hold accounts at two shops at all is the open
      // question behind this refusal, not something to settle here — see H-60
      // in docs/product/human-decisions.md.
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
    // Keep the session row until the next request. `requireStaffSession()`
    // must be able to read the unchanged session and turn the live account
    // status check into `/sign-in?session=ended`; deleting it here makes
    // `auth()` return an ordinary `/sign-in` redirect, which the edge cache
    // can mistake for a still-valid staff session and bounce back to `/shop`.
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
    // Revoke any session issued before this instant, same reasoning as
    // setStaffAccountStatus above.
    await tx.delete(accountSessions).where(eq(accountSessions.userAccountId, input.userAccountId));
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
    // And withdraw their agreement to be named to divers (issue #1181), for the
    // same reason and one step further: a removed person has no login, so there
    // is no path left by which *they* can withdraw it. Leaving the stamp makes
    // republishing their name a one-tap owner decision — the Undo banner, a
    // plain re-enable, or a re-invite at the same email months later all put
    // them back on public trip pages without them ever being asked again. Note
    // this is deliberately not done by `setStaffAccountStatus("disabled")`: a
    // temporary disable should not destroy a standing answer, because the
    // person is still here to change it.
    await tx
      .update(people)
      .set({ crewPublicConsentAt: null, crewPublicName: null })
      .where(and(eq(people.shopId, input.shopId), eq(people.id, input.personId)));
    return { ok: true };
  });
}

/**
 * **Record, or withdraw, one staff member's agreement to be named to divers**
 * (issue #1181, D21).
 *
 * Same shape and same staff-subject guard as `setStaffLanguages` above, and
 * one deliberate difference in who may call it: languages are an operational
 * fact a manager curates, and this is a consent. The action above this refuses
 * any `personId` but the caller's own, because a consent somebody else
 * recorded on your behalf is not one — that is the whole of what the column
 * means, and the reason it is a separate write rather than a field on the
 * languages form.
 *
 * Withdrawing writes null rather than a second timestamp. The standing answer
 * is the fact worth keeping; a shop holding a former employee's revoked
 * consent date serves nobody, and H-02 would have to age it out.
 */
export async function setCrewPublicConsent(
  db: DbExecutor,
  {
    shopId,
    personId,
    actorPersonId,
    consented,
    publicName,
    now = nowDate(),
  }: {
    shopId: string;
    personId: string;
    /** Whose session is writing. Anything but `personId` is refused here, not
     * only at the one action that calls this today. */
    actorPersonId: string;
    consented: boolean;
    /** What the person typed as the name divers see; blank falls back to the
     * first token of their record. Ignored when withdrawing. */
    publicName?: string | null;
    now?: Date;
  },
): Promise<boolean> {
  // **The subject is the actor, and that is enforced here.** A consent somebody
  // else recorded on your behalf is not a consent -- it is the whole of what
  // this column means, and unlike the blackout beside it there is no case where
  // a manager may record it for you, so there is no `canManageRoster` escape.
  // The action above already refuses it; this refuses it for the next surface
  // that wants a "name divers see" control and does not think to.
  if (actorPersonId !== personId) return false;

  // The stored name is read off the shop's own record before the write, not
  // taken from the caller alone, so an empty box still publishes something
  // sensible and a request that names a person who is not here writes nothing.
  let nameToStore: string | null = null;
  if (consented) {
    const [row] = await db
      .select({ fullName: people.fullName })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
      .limit(1);
    if (!row) return false;
    nameToStore = crewPublicNameToStore(publicName, row.fullName);
    // Nothing to show. Refused rather than written, because the alternative is
    // a consent that renders an empty crew line -- and the check constraint on
    // `people` would reject it anyway.
    if (nameToStore === null) return false;
  }

  const updated = await db
    .update(people)
    .set({
      crewPublicConsentAt: consented ? now : null,
      // Withdrawing clears the name too. Keeping it would leave the string
      // somebody chose sitting on the row, ready to republish the moment
      // anything set the stamp again -- the same hazard the security pass
      // found in `removeStaffMember`, one field over.
      crewPublicName: nameToStore,
    })
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(
          people.id,
          db
            .select({ id: personRoles.personId })
            .from(personRoles)
            .where(inArray(personRoles.role, [...STAFF_ROLES])),
        ),
      ),
    )
    .returning({ id: people.id });
  return updated.length > 0;
}
