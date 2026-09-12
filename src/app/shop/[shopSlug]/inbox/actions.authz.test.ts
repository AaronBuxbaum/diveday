import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { countUnansweredMessages } from "@/db/inbound-messages";
import { inboundMessages } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **Deleting a stranger's message** (issue #1506).
 *
 * The row this action deletes holds an address and a message from someone the
 * shop has no record of, which is why it is worth an authz test of its own
 * even though the surface it sits on carries no predicate.
 *
 * Two invariants live in `deleteStrangerInboundMessage`'s `where` rather than
 * in any gate line visible from the action, which is why they are pinned here
 * from the action's own side: the **tenant scope**, the only thing standing
 * between one shop's inbox and another's, and **`person_id is null`**, the
 * only thing standing between this action and a diver's own message. The
 * component declines to draw the button on a diver's row, but the action takes
 * a posted id, and the reply composer prints one into a hidden input on every
 * diver record. The captain case pins the open gate the 2026-09-10 amendment
 * (issues #1505/#1518) decided on, so a predicate cannot come back by
 * accident.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { deleteInboxMessageAction } = await import("./actions");

/** The seeded row from an address nobody on the roster holds (`src/db/seed-inbox.ts`). */
async function strangerMessageId(db: AppDb, shopId: string): Promise<string> {
  const [row] = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        isNull(inboundMessages.personId),
        isNull(inboundMessages.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new Error("seeded shop has no unknown-sender message");
  return row.id;
}

async function deletedAt(db: AppDb, messageId: string): Promise<Date | null> {
  const [row] = await db
    .select({ deletedAt: inboundMessages.deletedAt })
    .from(inboundMessages)
    .where(eq(inboundMessages.id, messageId));
  if (!row) throw new Error("message vanished");
  return row.deletedAt;
}

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    message: await strangerMessageId(db, shop.id),
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

function form(messageId: string): FormData {
  const formData = new FormData();
  formData.set("messageId", messageId);
  return formData;
}

describe("deleting a message from a sender nobody on the roster holds", () => {
  it("clears the worklist row and Today's unanswered count in one write", async () => {
    const { db, shop, message, owner } = await context();
    const before = await countUnansweredMessages(db, shop.id);
    signIn(shop, owner);

    const to = await redirectedTo(() => deleteInboxMessageAction(form(message)));

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=deleted`);
    expect(await deletedAt(db, message)).not.toBeNull();
    // Both readers go through `liveMessage`, so the stamp is the whole write.
    expect(await countUnansweredMessages(db, shop.id)).toBe(before - 1);
  });

  it("lets a captain do it — the inbox carries no predicate since 2026-09-10", async () => {
    // Issues #1505/#1518 deleted `canPersonAnswerShopInbox` rather than
    // relaxing it. This is the test that goes red if a gate comes back here
    // without the ADR amendment that would have to come with it.
    const { db, shop, message, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => deleteInboxMessageAction(form(message)));

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=deleted`);
    expect(await deletedAt(db, message)).not.toBeNull();
  });

  it("404s a session whose claimed shop is not the acting person's", async () => {
    // A real owner, a session claiming a shop they do not belong to. The
    // binding between the claim and the person is asserted before the delete
    // runs, so this never reaches the query at all — it is `notFound()`, the
    // same answer every cross-tenant staff surface gives, rather than a notice
    // about a message.
    //
    // That assert is the outer of two refusals, not a replacement for the
    // inner one: `deleteStrangerInboundMessage`'s own `where` still refuses a
    // foreign `shopId`, pinned directly in
    // `src/db/inbound-messages.test.ts` ("refuses to answer or delete another
    // shop's message"), so removing either one leaves a test red.
    const { db, shop, message, owner } = await context();
    const otherShop = { id: "00000000-0000-4000-8000-000000000000", slug: "other-shop" };
    signIn(otherShop, owner);

    await expect(deleteInboxMessageAction(form(message))).rejects.toThrow("NOT_FOUND");

    expect(await deletedAt(db, message)).toBeNull();
    expect(await countUnansweredMessages(db, shop.id)).toBeGreaterThan(0);
  });

  it("leaves a diver's own message alone, whoever posts its id", async () => {
    // The id is real, live, and this shop's — it just has a person behind it.
    // Nothing about the post says where the staffer got it, and the reply
    // composer on every diver record renders one into a hidden input, so the
    // refusal has to come from the query. Losing this row would take what a
    // diver wrote out of their conversation with no way back and close the
    // 24-hour window the shop has to answer them.
    const { db, shop, owner } = await context();
    const [linked] = await db
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.shopId, shop.id),
          isNotNull(inboundMessages.personId),
          isNull(inboundMessages.deletedAt),
        ),
      )
      .limit(1);
    if (!linked) throw new Error("seeded shop has no diver-linked message");
    signIn(shop, owner);

    const to = await redirectedTo(() => deleteInboxMessageAction(form(linked.id)));

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=gone`);
    expect(await deletedAt(db, linked.id)).toBeNull();
  });

  it("answers a posted id that is not an id at all with the same refusal", async () => {
    // Narrowed before it reaches a `uuid` comparison: unparsed, Postgres would
    // raise rather than return, and a hand-built post would be a 500.
    const { shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => deleteInboxMessageAction(form("not-a-uuid")));

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=gone`);
  });

  it("says gone rather than deleted the second time, so nobody is told twice", async () => {
    const { shop, message, owner } = await context();
    signIn(shop, owner);
    await redirectedTo(() => deleteInboxMessageAction(form(message)));

    const to = await redirectedTo(() => deleteInboxMessageAction(form(message)));

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=gone`);
  });
});
