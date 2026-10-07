import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { recordInboundMessage } from "@/db/inbound-messages";
import {
  people,
  personRoles,
  staffReplies,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "@/db/schema";
import { STAFF_ROLES } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The diver record holds the two most consequential buttons in the product:
 * "Refund" moves money out, and "Erase" destroys identifying and medical data
 * one way. `divers/[personId]/page.tsx` hides each from the roles that may not
 * use it, but hiding is a courtesy — a form post reaches the action regardless,
 * which is exactly what ADR-0006 says a UI check is never allowed to be the only
 * layer. Each test below runs the real action against a real seeded shop and
 * asserts both the refusal notice and that the row is as it was.
 *
 * Erasure has a *second* gate underneath: `anonymizeDiver` re-runs
 * `canPersonErasePersonalData` inside its own transaction (src/db/anonymize.ts),
 * because "the route forgot to check" has no remedy for a one-way write. The
 * action-level gate tested here is the first of the two, and the one that
 * produces the notice staff actually see — deleting it turns these tests red on
 * the notice (`erase-refused` instead of `not-authorized-erase`) while the diver's
 * data survives, which is precisely what defense in depth is supposed to look
 * like. Removal has no such second layer: `deleteDiver` writes whatever it is
 * handed, so for that one the assertions below are the only thing standing
 * behind the gate line.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { deletePersonAction, eraseGuardianEmailAction, erasePersonAction, replyToDiverAction } =
  await import("./actions");

/**
 * A seeded diver — someone with no *staff* role. `anonymizeDiver` refuses to
 * erase a staff member outright, so picking one would test the wrong refusal.
 */
async function seededDiverId(db: AppDb, shopId: string): Promise<string> {
  const staffIds = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .where(inArray(personRoles.role, [...STAFF_ROLES]))
    .then((rows) => rows.map((row) => row.personId));
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        staffIds.length > 0 ? notInArray(people.id, staffIds) : undefined,
      ),
    )
    .orderBy(people.fullName)
    .limit(1);
  if (!diver) throw new Error("seeded shop has no non-staff diver");
  return diver.id;
}

/** A manager who is *not* an owner — the role that separates "remove" from "erase". */
async function makeManager(db: AppDb, shopId: string): Promise<string> {
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: "Morgan Manager", email: "morgan.manager@demo.invalid" })
    .returning();
  if (!person) throw new Error("failed to insert manager");
  await db.insert(personRoles).values({ personId: person.id, role: "manager" });
  await db.insert(userAccounts).values({
    personId: person.id,
    email: "morgan.manager@demo.invalid",
    hashedPassword: "x",
    status: "active",
  });
  return person.id;
}

async function personRow(db: AppDb, personId: string) {
  const [row] = await db.select().from(people).where(eq(people.id, personId));
  if (!row) throw new Error("person vanished");
  return row;
}

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    diver: await seededDiverId(db, shop.id),
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

/**
 * **There is no refund control on this record any more** (ADR
 * 20260827-people-not-lists: "Orders remain first-class on the Orders ledger;
 * here they are the row's money facts"). The block that used to stand here
 * covered `refundPaymentAction`'s owner/manager gate; the act moved whole to
 * `/shop/[slug]/orders/[id]`, whose own `refundAction` re-checks
 * `canPersonRefund` against live roles before it looks the order up, and which
 * can send back a partial amount this one never could.
 */
describe("removing a diver from the roster", () => {
  it("refuses a captain and leaves the person on the roster", async () => {
    const { db, shop, diver, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => deletePersonAction(shop.slug, diver, new FormData()));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${diver}?notice=not-authorized-delete&form=remove#remove`,
    );
    expect((await personRow(db, diver)).deletedAt).toBeNull();
  });

  it("lets an owner remove the diver", async () => {
    const { db, shop, diver, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => deletePersonAction(shop.slug, diver, new FormData()));

    expect(to).toBe(
      `/shop/${shop.slug}/divers?notice=deleted&deleted=${encodeURIComponent(diver)}`,
    );
    expect((await personRow(db, diver)).deletedAt).not.toBeNull();
  });
});

describe("erasing a diver's personal and medical data", () => {
  it("refuses a captain, and their name is still on the record afterwards", async () => {
    const { db, shop, diver, captain } = await context();
    const before = await personRow(db, diver);
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("confirmName", before.fullName);

    const to = await redirectedTo(() => erasePersonAction(shop.slug, diver, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${diver}?notice=not-authorized-erase&form=erase#erase-heading`,
    );
    const after = await personRow(db, diver);
    expect(after.fullName).toBe(before.fullName);
    expect(after.anonymizedAt).toBeNull();
  });

  it("refuses a manager too — erasure is owner-only, stricter than removal", async () => {
    // The gate that separates the two buttons on the same card: a manager may
    // take a diver off the roster (reversible) but may not make the shop's own
    // record of them unrecoverable (ADR 20260802-diver-data-erasure).
    const { db, shop, diver } = await context();
    const manager = await makeManager(db, shop.id);
    const before = await personRow(db, diver);
    signIn(shop, manager);
    const formData = new FormData();
    formData.set("confirmName", before.fullName);

    const to = await redirectedTo(() => erasePersonAction(shop.slug, diver, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${diver}?notice=not-authorized-erase&form=erase#erase-heading`,
    );
    expect((await personRow(db, diver)).anonymizedAt).toBeNull();
  });

  /**
   * The state gate, which is not an authorization gate and is deliberately
   * tested beside them: erasure is offered on a **deleted** record only, so the
   * owner who may do it is still refused while the diver is on the roster
   * (ADR 20260802-diver-data-erasure, 2026-08-21 amendment). The record's page
   * renders the control by the same rule, but a tab left open on a diver who was
   * deleted and then restored would post this exactly — which is the whole
   * reason the action does not take the page's word for it.
   */
  it("refuses an owner while the diver is still on the roster", async () => {
    const { db, shop, diver, owner } = await context();
    const before = await personRow(db, diver);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("confirmName", before.fullName);

    const to = await redirectedTo(() => erasePersonAction(shop.slug, diver, formData));

    // No `&form=`: on a live record the erase section is not rendered, so the
    // refusal reads in the page banner instead of a section that is not there.
    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=erase-requires-delete`);
    const after = await personRow(db, diver);
    expect(after.fullName).toBe(before.fullName);
    expect(after.anonymizedAt).toBeNull();
  });

  it("lets an owner erase a deleted diver, once they have typed the name back", async () => {
    const { db, shop, diver, owner } = await context();
    const before = await personRow(db, diver);
    signIn(shop, owner);
    // Through the real removal, not a hand-written `deleted_at`: the two acts
    // are one sequence now, and this is the order a staffer runs them in.
    await redirectedTo(() => deletePersonAction(shop.slug, diver, new FormData()));
    const formData = new FormData();
    formData.set("confirmName", before.fullName);

    const to = await redirectedTo(() => erasePersonAction(shop.slug, diver, formData));

    expect(to).toMatch(new RegExp(`^/shop/${shop.slug}/divers\\?notice=erased`));
    const after = await personRow(db, diver);
    expect(after.anonymizedAt).not.toBeNull();
    expect(after.fullName).not.toBe(before.fullName);
  });
});

/**
 * **A co-signing guardian's address, erased on its own** (H-101, issue #1673).
 * Owner-only like the diver's erasure, typed back to confirm, and on a live
 * record — the child stays a diver.
 */
describe("erasing a guardian's email from a diver's releases", () => {
  async function coSigned(db: AppDb, shopId: string, personId: string) {
    const [template] = await db
      .select({ id: waiverTemplates.id })
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shopId))
      .limit(1);
    if (!template) throw new Error("seeded shop has no waiver template");
    const [record] = await db
      .insert(waiverRecords)
      .values({
        shopId,
        personId,
        templateId: template.id,
        templateTitle: "Release",
        templateVersion: 1,
        templateBody: "Body",
        tokenHash: `guardian-erasure-${personId}`,
        expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        status: "completed",
        guardianName: "Jonas Fischer",
        guardianRelationship: "parent",
        guardianSignatureMethod: "typed_consent",
        guardianConsentedAt: new Date("2026-07-18T12:00:00.000Z"),
        guardianSignedAt: new Date("2026-07-18T12:00:00.000Z"),
        guardianEmail: "jonas@example.com",
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("waiver insert failed");
    return record.id;
  }
  async function guardianEmailOf(db: AppDb, id: string) {
    const [row] = await db
      .select({ email: waiverRecords.guardianEmail })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, id));
    return row?.email;
  }
  const anchor = "form=guardian-email#guardian-email-heading";

  it("refuses a manager, and the address is still on the release", async () => {
    const { db, shop, diver } = await context();
    const id = await coSigned(db, shop.id, diver);
    signIn(shop, await makeManager(db, shop.id));
    const formData = new FormData();
    formData.set("email", "jonas@example.com");
    formData.set("confirmEmail", "jonas@example.com");

    const to = await redirectedTo(() => eraseGuardianEmailAction(shop.slug, diver, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${diver}?notice=not-authorized-guardian-email&${anchor}`,
    );
    expect(await guardianEmailOf(db, id)).toBe("jonas@example.com");
  });

  it("refuses an owner whose typed address does not match", async () => {
    const { db, shop, diver, owner } = await context();
    const id = await coSigned(db, shop.id, diver);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("email", "jonas@example.com");
    formData.set("confirmEmail", "jonas@example.org");

    const to = await redirectedTo(() => eraseGuardianEmailAction(shop.slug, diver, formData));

    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=guardian-email-mismatch&${anchor}`);
    expect(await guardianEmailOf(db, id)).toBe("jonas@example.com");
  });

  it("refuses an address that is not on this diver's releases, typed back or not", async () => {
    const { db, shop, diver, owner } = await context();
    const id = await coSigned(db, shop.id, diver);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("email", "someone@example.com");
    formData.set("confirmEmail", "someone@example.com");

    const to = await redirectedTo(() => eraseGuardianEmailAction(shop.slug, diver, formData));

    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=guardian-email-not-found&${anchor}`);
    expect(await guardianEmailOf(db, id)).toBe("jonas@example.com");
  });

  it("lets an owner erase it from a live diver's release, and the diver stays", async () => {
    const { db, shop, diver, owner } = await context();
    const id = await coSigned(db, shop.id, diver);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("email", "jonas@example.com");
    formData.set("confirmEmail", " JONAS@example.com ");

    const to = await redirectedTo(() => eraseGuardianEmailAction(shop.slug, diver, formData));

    expect(to).toBe(`/shop/${shop.slug}/divers/${diver}?notice=guardian-email-erased&${anchor}`);
    expect(await guardianEmailOf(db, id)).toBeNull();
    const person = await personRow(db, diver);
    expect(person.deletedAt).toBeNull();
    expect(person.anonymizedAt).toBeNull();
  });
});

/**
 * **Answering a diver is open to every live staff role** (issues #1505/#1518,
 * decided 2026-09-10 as an H-14 amendment). `replyToDiverAction` carried
 * `canPersonAnswerShopInbox` on top of the live-staff check until then; with
 * that predicate deleted, this is the test that catches the gate coming back
 * by accident, and the one that names the check still standing —
 * `requireDiverActionContext`'s `isLiveStaff`.
 *
 * The send itself goes nowhere: no notification provider is configured under
 * test, so `sendStaffReply` records the attempt and reports `not_configured`.
 * That is the right evidence anyway — what a refused captain leaves behind is
 * *no row at all*, so the row on `staff_replies` with their name on it is the
 * authorization decision, not the delivery.
 */
describe("answering a diver from their record", () => {
  /** A seeded diver with an address a message can arrive from. */
  async function diverWithEmail(db: AppDb, shopId: string) {
    const staffIds = await db
      .select({ personId: personRoles.personId })
      .from(personRoles)
      .where(inArray(personRoles.role, [...STAFF_ROLES]))
      .then((rows) => rows.map((row) => row.personId));
    const [diver] = await db
      .select({ id: people.id, email: people.email })
      .from(people)
      .where(
        and(
          eq(people.shopId, shopId),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
          isNotNull(people.email),
          staffIds.length > 0 ? notInArray(people.id, staffIds) : undefined,
        ),
      )
      .orderBy(people.fullName)
      .limit(1);
    if (!diver?.email) throw new Error("seeded shop has no diver with an email");
    return diver as { id: string; email: string };
  }

  async function waitingMessage(db: AppDb, shopId: string, fromAddress: string) {
    const result = await recordInboundMessage(db, {
      shopId,
      channel: "email",
      fromAddress,
      subject: "Re: Your Saturday departure",
      body: "Could I switch to the afternoon boat?",
      receivedAt: new Date("2026-07-21T13:30:00.000Z"),
      providerMessageId: `email-${Math.random()}`,
      emailMessageId: "<diver-thread@example.com>",
    });
    if (result.status !== "recorded") throw new Error(`unexpected ${result.status}`);
    return result.id;
  }

  function reply(messageId: string, body: string) {
    const formData = new FormData();
    formData.set("messageId", messageId);
    formData.set("body", body);
    return formData;
  }

  it("lets a captain answer as the shop, and records what they typed", async () => {
    const { db, shop, captain } = await context();
    const diver = await diverWithEmail(db, shop.id);
    const messageId = await waitingMessage(db, shop.id, diver.email);
    signIn(shop, captain);

    const to = await redirectedTo(() =>
      replyToDiverAction(shop.slug, diver.id, reply(messageId, "You’re on the 1pm boat now.")),
    );

    expect(to).not.toContain("not-authorized-reply");
    const [recorded] = await db
      .select()
      .from(staffReplies)
      .where(eq(staffReplies.inboundMessageId, messageId));
    expect(recorded).toMatchObject({
      personId: diver.id,
      sentByPersonId: captain,
      body: "You’re on the 1pm boat now.",
    });
  });

  it("refuses someone whose staff roles are gone, and writes nothing", async () => {
    const { db, shop, captain } = await context();
    const diver = await diverWithEmail(db, shop.id);
    const messageId = await waitingMessage(db, shop.id, diver.email);
    // Demoted off every staff role between sign-in and the post — the window
    // `isLiveStaff` exists to close, and the only gate left on this action.
    await db.delete(personRoles).where(eq(personRoles.personId, captain));
    signIn(shop, captain);

    const to = await redirectedTo(() =>
      replyToDiverAction(shop.slug, diver.id, reply(messageId, "You’re on the 1pm boat now.")),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${diver.id}?notice=not-authorized-reply&form=reply#conversation`,
    );
    // Scoped to the message this test put there: the seeded shop ships a
    // conversation of its own, so a bare count would pass on someone else's row.
    expect(
      await db.select().from(staffReplies).where(eq(staffReplies.inboundMessageId, messageId)),
    ).toHaveLength(0);
  });
});
