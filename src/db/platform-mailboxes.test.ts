// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedPlatformMail } from "@/db/seed";
import { seededShopContext } from "@/test/db";
import {
  addPlatformMailboxMember,
  archivePlatformMailbox,
  createPlatformMailbox,
  findMailboxForAddress,
  listPlatformMailboxes,
  loadPlatformAccess,
  NO_PLATFORM_ACCESS,
  removePlatformMailboxMember,
} from "./platform-mailboxes";
import { people, shops, userAccounts } from "./schema";

/**
 * Managing DiveDay's own role addresses (20260724-resend-webhook-email-events).
 * Routing and read-access live in inbound-emails.test.ts; this file is about
 * the administration around them — who can be added, and what happens to a
 * mailbox that is retired.
 */

const ARCHIVED_AT = new Date("2026-07-24T12:00:00.000Z");

type TestDb = Awaited<ReturnType<typeof seededShopContext>>["db"];

async function seededMailbox() {
  const { db } = await seededShopContext();
  const created = await createPlatformMailbox(db, { address: "legal@dive.day", label: "Legal" });
  if (!created.ok) throw new Error("mailbox not created");
  return { db, mailboxId: created.id };
}

async function personIdByEmail(db: TestDb, email: string): Promise<string> {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.email, email))
    .limit(1);
  if (!person) throw new Error(`no person with email ${email}`);
  return person.id;
}

/**
 * `people` is unique on (shop_id, email), not on email alone, so the same
 * address legitimately names a different person at each of two shops.
 */
async function addPersonAtAnotherShop(db: TestDb, email: string): Promise<void> {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Coral Divers", slug: "coral-divers", timezone: "America/New_York" })
    .returning({ id: shops.id });
  await db.insert(people).values({ shopId: shop.id, fullName: "Marcus Elsewhere", email });
}

describe("createPlatformMailbox", () => {
  it("stores the address lowercased and trimmed, since it is the routing key", async () => {
    const { db } = await seededShopContext();
    await createPlatformMailbox(db, { address: "  Hello@Dive.Day ", label: "  General  " });

    await expect(listPlatformMailboxes(db)).resolves.toMatchObject([
      { address: "hello@dive.day", label: "General" },
    ]);
  });

  it("refuses a second mailbox for the same address rather than making routing a coin flip", async () => {
    const { db } = await seededMailbox();
    await expect(
      createPlatformMailbox(db, { address: "LEGAL@dive.day", label: "Legal, again" }),
    ).resolves.toEqual({ ok: false, reason: "duplicate_address" });
    await expect(listPlatformMailboxes(db)).resolves.toHaveLength(1);
  });
});

describe("listPlatformMailboxes", () => {
  it("lists a mailbox nobody reads yet, with no members rather than a phantom one", async () => {
    const { db } = await seededMailbox();
    await expect(listPlatformMailboxes(db)).resolves.toMatchObject([
      { address: "legal@dive.day", members: [] },
    ]);
  });

  it("hides a retired address so it can't be handed out again", async () => {
    const { db, mailboxId } = await seededMailbox();
    await archivePlatformMailbox(db, mailboxId, ARCHIVED_AT);
    await expect(listPlatformMailboxes(db)).resolves.toEqual([]);
  });
});

describe("addPlatformMailboxMember", () => {
  it("grants read access to the person who owns that address", async () => {
    const { db, mailboxId } = await seededMailbox();
    await expect(
      addPlatformMailboxMember(db, { mailboxId, email: " Marcus@BlueMantis.example " }),
    ).resolves.toEqual({ ok: true });

    await expect(listPlatformMailboxes(db)).resolves.toMatchObject([
      { members: [{ email: "marcus@bluemantis.example" }] },
    ]);
  });

  it("is idempotent, so adding the same reader twice doesn't duplicate them", async () => {
    const { db, mailboxId } = await seededMailbox();
    const email = "marcus@bluemantis.example";
    await addPlatformMailboxMember(db, { mailboxId, email });
    await expect(addPlatformMailboxMember(db, { mailboxId, email })).resolves.toEqual({ ok: true });

    const [mailbox] = await listPlatformMailboxes(db);
    expect(mailbox.members).toHaveLength(1);
  });

  it("refuses an address with nobody on file behind it", async () => {
    const { db, mailboxId } = await seededMailbox();
    await expect(
      addPlatformMailboxMember(db, { mailboxId, email: "nobody@nowhere.example" }),
    ).resolves.toEqual({ ok: false, reason: "unknown_person" });
  });

  it("can't be aimed at a roster row a tenant invented, only at a real login", async () => {
    // `people.email` is unique per shop, so any shop can put an arbitrary
    // address on its own roster — squatting jo@dive.day before the real Jo has
    // a row. Resolving through `user_accounts` (globally unique, minted only
    // with an account) is what makes that squat inert instead of a way to
    // receive somebody else's grant.
    const { db, mailboxId } = await seededMailbox();
    const email = "jo@dive.day";
    await addPersonAtAnotherShop(db, email);

    await expect(addPlatformMailboxMember(db, { mailboxId, email })).resolves.toEqual({
      ok: false,
      reason: "unknown_person",
    });
    await expect(listPlatformMailboxes(db)).resolves.toMatchObject([{ members: [] }]);
  });

  it("ignores a deleted person, so removing someone doesn't leave them grantable", async () => {
    const { db, mailboxId } = await seededMailbox();
    const email = "marcus@bluemantis.example";
    await db.update(people).set({ deletedAt: ARCHIVED_AT }).where(eq(people.email, email));

    await expect(addPlatformMailboxMember(db, { mailboxId, email })).resolves.toEqual({
      ok: false,
      reason: "unknown_person",
    });
  });

  it("refuses a mailbox that doesn't exist, or one already retired", async () => {
    const { db, mailboxId } = await seededMailbox();
    const email = "marcus@bluemantis.example";
    await expect(
      addPlatformMailboxMember(db, {
        mailboxId: "00000000-0000-4000-8000-000000000000",
        email,
      }),
    ).resolves.toEqual({ ok: false, reason: "unknown_mailbox" });

    await archivePlatformMailbox(db, mailboxId, ARCHIVED_AT);
    await expect(addPlatformMailboxMember(db, { mailboxId, email })).resolves.toEqual({
      ok: false,
      reason: "unknown_mailbox",
    });
  });
});

describe("removePlatformMailboxMember", () => {
  it("takes read access away, and reports honestly when there was none to take", async () => {
    const { db, mailboxId } = await seededMailbox();
    await addPlatformMailboxMember(db, { mailboxId, email: "marcus@bluemantis.example" });
    const personId = await personIdByEmail(db, "marcus@bluemantis.example");

    await expect(removePlatformMailboxMember(db, { mailboxId, personId })).resolves.toBe(true);
    await expect(loadPlatformAccess(db, personId, {})).resolves.toEqual(NO_PLATFORM_ACCESS);
    await expect(removePlatformMailboxMember(db, { mailboxId, personId })).resolves.toBe(false);
  });
});

describe("archivePlatformMailbox", () => {
  it("retires an address once, and says so when it was already retired", async () => {
    const { db, mailboxId } = await seededMailbox();
    await expect(archivePlatformMailbox(db, mailboxId, ARCHIVED_AT)).resolves.toBe(true);
    await expect(archivePlatformMailbox(db, mailboxId, ARCHIVED_AT)).resolves.toBe(false);
    await expect(findMailboxForAddress(db, "legal@dive.day")).resolves.toBeNull();
  });
});

describe("loadPlatformAccess", () => {
  it("gives a deleted person nothing, even while their memberships still exist", async () => {
    const { db, mailboxId } = await seededMailbox();
    await addPlatformMailboxMember(db, { mailboxId, email: "dana@bluemantis.example" });
    const personId = await personIdByEmail(db, "dana@bluemantis.example");
    await db.update(people).set({ deletedAt: ARCHIVED_AT }).where(eq(people.id, personId));

    await expect(
      loadPlatformAccess(db, personId, { PLATFORM_ADMIN_EMAILS: "dana@bluemantis.example" }),
    ).resolves.toEqual(NO_PLATFORM_ACCESS);
  });

  it("gives an unknown person nothing rather than throwing", async () => {
    const { db } = await seededMailbox();
    await expect(
      loadPlatformAccess(db, "00000000-0000-4000-8000-000000000000", {}),
    ).resolves.toEqual(NO_PLATFORM_ACCESS);
  });

  it("reads the allowlist against the login, not the rewritable profile email", async () => {
    // `people.email` is ordinary profile data that any staff member can edit
    // through the diver editor — including on their own row. If the allowlist
    // were matched against it, typing an operator address into your own
    // profile would make you a DiveDay operator on the next request.
    const { db } = await seededMailbox();
    const personId = await personIdByEmail(db, "marcus@bluemantis.example");
    await db.update(people).set({ email: "aaron@dive.day" }).where(eq(people.id, personId));

    await expect(
      loadPlatformAccess(db, personId, { PLATFORM_ADMIN_EMAILS: "aaron@dive.day" }),
    ).resolves.toEqual(NO_PLATFORM_ACCESS);
  });

  it("drops operator access when the login is no longer active", async () => {
    const { db } = await seededMailbox();
    const personId = await personIdByEmail(db, "dana@bluemantis.example");
    const env = { PLATFORM_ADMIN_EMAILS: "dana@bluemantis.example" };
    await expect(loadPlatformAccess(db, personId, env)).resolves.toMatchObject({ isAdmin: true });

    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, personId));
    await expect(loadPlatformAccess(db, personId, env)).resolves.toEqual(NO_PLATFORM_ACCESS);
  });
});

describe("the seed", () => {
  it("grants no mailbox membership, since seedIfEmpty also runs on a real deploy", async () => {
    // The only identity it could name is the demo shop's owner, whose login is
    // a published constant — a seeded membership would put DiveDay's own mail
    // one public password behind, with PLATFORM_ADMIN_EMAILS unset.
    const { db } = await seededShopContext();
    await seedPlatformMail(db);
    const personId = await personIdByEmail(db, "dana@bluemantis.example");

    await expect(loadPlatformAccess(db, personId, {})).resolves.toEqual(NO_PLATFORM_ACCESS);
  });
});
