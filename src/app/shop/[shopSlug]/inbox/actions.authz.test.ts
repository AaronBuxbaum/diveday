import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { countUnansweredMessages } from "@/db/inbound-messages";
import { messageSeats } from "@/db/running-late";
import { bookings, inboundMessages, shops } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

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
const { deleteInboxMessageAction, markInboxSenderLateAction, setInboxMessageDoneAction } =
  await import("./actions");

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
  const { db, shop } = ctx;
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

describe("marking a message done, and taking it back", () => {
  function doneForm(messageId: string, done: boolean): FormData {
    const formData = form(messageId);
    formData.set("done", done ? "true" : "false");
    return formData;
  }

  it("takes it off the worklist and Today's count, and puts it back", async () => {
    const { db, shop, message, captain } = await context();
    const before = await countUnansweredMessages(db, shop.id);
    // A captain: the inbox's open gate, the same as the delete's.
    signIn(shop, captain);

    expect(await redirectedTo(() => setInboxMessageDoneAction(doneForm(message, true)))).toBe(
      `/shop/${shop.slug}/inbox`,
    );
    expect(await countUnansweredMessages(db, shop.id)).toBe(before - 1);

    expect(await redirectedTo(() => setInboxMessageDoneAction(doneForm(message, false)))).toBe(
      `/shop/${shop.slug}/inbox`,
    );
    expect(await countUnansweredMessages(db, shop.id)).toBe(before);
  });

  it("404s a session whose claimed shop is not the acting person's", async () => {
    const { db, shop, message, owner } = await context();
    const before = await countUnansweredMessages(db, shop.id);
    signIn({ id: "00000000-0000-4000-8000-000000000000", slug: "other-shop" }, owner);

    await expect(setInboxMessageDoneAction(doneForm(message, true))).rejects.toThrow("NOT_FOUND");
    expect(await countUnansweredMessages(db, shop.id)).toBe(before);
  });

  it("answers another shop's real message with gone, and leaves it alone", async () => {
    const { db, shop, owner } = await context();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-inbox-done", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const [theirs] = await db
      .insert(inboundMessages)
      .values({
        shopId: rival.id,
        channel: "email",
        fromAddress: "someone@example.com",
        body: "Theirs, not ours.",
        providerMessageId: "rival-inbox-done-1",
        receivedAt: new Date("2026-07-21T13:30:00.000Z"),
      })
      .returning({ id: inboundMessages.id });
    if (!theirs) throw new Error("rival message insert failed");
    signIn(shop, owner);

    const to = await redirectedTo(() => setInboxMessageDoneAction(doneForm(theirs.id, true)));

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=gone`);
    const [row] = await db
      .select({ answeredAt: inboundMessages.answeredAt })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, theirs.id));
    expect(row?.answeredAt).toBeNull();
  });

  it("answers a posted id that is not an id with gone", async () => {
    const { shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => setInboxMessageDoneAction(doneForm("not-a-uuid", true)));

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=gone`);
  });
});

/**
 * UX review 2026-10-13, item 19: marking the sender of "Running about 15 min
 * late" running late from the Inbox row. Only a message id is posted; the
 * person and the seat come from the server's own reads.
 */
describe("marking a message's sender running late", () => {
  /** The late form posts the message and the seat the desk chose (issue #2551). */
  function lateForm(messageId: string, bookingId: string): FormData {
    const formData = form(messageId);
    formData.set("bookingId", bookingId);
    return formData;
  }

  /** The seat the row would offer for Diego's message: the server's own candidates. */
  async function offeredSeat(db: AppDb, shopId: string) {
    const late = await lateMessage(db, shopId);
    const seats = await messageSeats(db, shopId, [late], nowDate());
    const seat = seats.get(late.id)?.[0];
    if (!seat) throw new Error("seeded running-late message has no open seat");
    return { late, seat };
  }

  /** Diego's WhatsApp, written in his own words (`src/db/seed-inbox.ts`). */
  async function lateMessage(db: AppDb, shopId: string) {
    const [row] = await db
      .select({
        id: inboundMessages.id,
        personId: inboundMessages.personId,
        receivedAt: inboundMessages.receivedAt,
      })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.shopId, shopId),
          eq(inboundMessages.channel, "whatsapp"),
          isNotNull(inboundMessages.personId),
        ),
      )
      .limit(1);
    if (!row?.personId) throw new Error("seeded shop has no running-late WhatsApp");
    return { ...row, personId: row.personId };
  }

  async function marks(db: AppDb, shopId: string, personId: string) {
    return (
      await db
        .select({ at: bookings.runningLateAt })
        .from(bookings)
        .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)))
    )
      .map((row) => row.at)
      .filter((at): at is Date => at !== null);
  }

  it("puts the mark on his seat with the moment he wrote, for any staff role", async () => {
    const { db, shop, captain } = await context();
    const { late, seat } = await offeredSeat(db, shop.id);
    signIn(shop, captain);

    const to = await redirectedTo(() =>
      markInboxSenderLateAction(lateForm(late.id, seat.bookingId)),
    );

    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=late-marked`);
    expect(await marks(db, shop.id, late.personId)).toEqual([late.receivedAt]);
  });

  it("404s a session whose claimed shop is not the acting person's", async () => {
    const { db, shop, owner } = await context();
    const { late, seat } = await offeredSeat(db, shop.id);
    signIn({ id: "00000000-0000-4000-8000-000000000000", slug: "other-shop" }, owner);

    await expect(markInboxSenderLateAction(lateForm(late.id, seat.bookingId))).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(await marks(db, shop.id, late.personId)).toEqual([]);
  });

  it("answers a stranger's message and a non-id with gone, and writes nothing", async () => {
    const { shop, message, owner } = await context();
    signIn(shop, owner);

    for (const id of [message, "not-a-uuid"]) {
      expect(
        await redirectedTo(() =>
          markInboxSenderLateAction(lateForm(id, "00000000-0000-4000-8000-000000000000")),
        ),
      ).toBe(`/shop/${shop.slug}/inbox?notice=gone`);
    }
  });

  it("answers a post with no seat, or a malformed one, with gone, and writes nothing", async () => {
    const { db, shop, owner } = await context();
    const { late } = await offeredSeat(db, shop.id);
    signIn(shop, owner);

    for (const bookingId of ["", "not-a-uuid"]) {
      expect(
        await redirectedTo(() => markInboxSenderLateAction(lateForm(late.id, bookingId))),
      ).toBe(`/shop/${shop.slug}/inbox?notice=gone`);
    }
    expect(await redirectedTo(() => markInboxSenderLateAction(form(late.id)))).toBe(
      `/shop/${shop.slug}/inbox?notice=gone`,
    );
    expect(await marks(db, shop.id, late.personId)).toEqual([]);
  });

  it("refuses a booking id the message was not about, and writes nothing", async () => {
    const { db, shop, owner } = await context();
    const { late, seat } = await offeredSeat(db, shop.id);
    // A seat of somebody else's at this shop, and an id that names nothing.
    const [other] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.personId, late.personId)))
      .limit(1);
    if (!other) throw new Error("seeded shop has no other booking");
    signIn(shop, owner);

    for (const forged of [other.id, "00000000-0000-4000-8000-000000000000"]) {
      expect(forged).not.toBe(seat.bookingId);
      expect(await redirectedTo(() => markInboxSenderLateAction(lateForm(late.id, forged)))).toBe(
        `/shop/${shop.slug}/inbox?notice=late-closed`,
      );
    }
    expect(await marks(db, shop.id, late.personId)).toEqual([]);
    const anyMark = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), isNotNull(bookings.runningLateAt)));
    expect(anyMark.filter((row) => row.id === other.id)).toEqual([]);
  });
});
