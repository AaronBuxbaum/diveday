import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { heldRows } from "@/test/held-sends";
import {
  claimHeldSend,
  executeHeldSend,
  HELD_SEND_CLAIM_MS,
  holdSend,
  undoHeldSend,
} from "./held-sends";
import { drainNotificationRetries } from "./notifications";
import { notificationSendQueue, people, personRoles, trips } from "./schema";

/**
 * **Held sends on the one send queue** (issue #2730): the adversarial half.
 * A held send may write to many divers, so the two failures this file hunts
 * are a send that leaves twice and a send that never leaves. The executor is
 * replaced by a counter, so "twice" is a number, not a guess.
 */
const sendDepartureNote = vi.hoisted(() => vi.fn());
vi.mock("./departure-notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./departure-notes")>()),
  sendDepartureNote,
}));

const ctx = fileScopedShopContext();
const now = new Date("2026-08-27T10:14:00Z");
const afterHold = new Date(now.getTime() + 60_000);

beforeEach(() => {
  sendDepartureNote.mockReset();
  sendDepartureNote.mockResolvedValue({ ok: true, noteId: "n", recipients: 3, delivered: 3 });
});
afterEach(() => vi.unstubAllEnvs());

async function hold() {
  const { db, shop } = ctx;
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  const [owner] = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!trip || !owner) throw new Error("fixture needs a trip and an owner");
  const held = await holdSend(db, {
    shopId: shop.id,
    actorPersonId: owner.personId,
    now,
    payload: { kind: "departure_note", tripId: trip.id, body: "Bring a jacket" },
  });
  return { db, shop, held, owner };
}

async function queueRow(id: string) {
  const [row] = await ctx.db
    .select()
    .from(notificationSendQueue)
    .where(eq(notificationSendQueue.id, id));
  return row;
}

describe("a held send leaves exactly once", () => {
  it("the client's release and the drain's sweep cannot both send it", async () => {
    const { db, shop, held } = await hold();
    const claim = await claimHeldSend(db, shop.id, held.id, now, { early: true });
    expect(claim.status).toBe("claimed");
    // The drain arrives while the client's send is still running.
    const sweep = await drainNotificationRetries(db, { now: afterHold, scope: "held" });
    expect(sweep.held).toEqual({ sent: 0, failed: 0 });
    if (claim.status === "claimed") await executeHeldSend(db, claim.row);
    expect(sendDepartureNote).toHaveBeenCalledTimes(1);
  });

  it("the drain's sweep first, then a late client release: still once", async () => {
    const { db, shop, held } = await hold();
    const sweep = await drainNotificationRetries(db, { now: afterHold, scope: "held" });
    expect(sweep.held).toEqual({ sent: 1, failed: 0 });
    expect(await claimHeldSend(db, shop.id, held.id, afterHold, { early: true })).toEqual({
      status: "gone",
    });
    expect(sendDepartureNote).toHaveBeenCalledTimes(1);
  });

  it("two sweeps of the same due row send it once", async () => {
    const { db } = await hold();
    await drainNotificationRetries(db, { now: afterHold, scope: "held" });
    await drainNotificationRetries(db, { now: new Date(afterHold.getTime() + 3_600_000) });
    expect(sendDepartureNote).toHaveBeenCalledTimes(1);
  });

  it("a send that died mid-way is settled interrupted, never sent again", async () => {
    const { db, shop, held } = await hold();
    const claim = await claimHeldSend(db, shop.id, held.id, now, { early: true });
    expect(claim.status).toBe("claimed");
    // The worker dies here: no execute, no settle. The lock lapses.
    const later = new Date(nowPlus(HELD_SEND_CLAIM_MS + 120_000));
    // The full drain, whose sealed-retry arm requeues lapsed claims: a held
    // row must not be among them.
    const pass = await drainNotificationRetries(db, { now: later });
    expect(pass.held).toEqual({ sent: 0, failed: 0 });
    await drainNotificationRetries(db, { now: new Date(later.getTime() + 3_600_000) });
    expect(sendDepartureNote).not.toHaveBeenCalled();
    const row = await queueRow(held.id);
    expect(row).toMatchObject({
      status: "failed",
      errorCode: "held_send_interrupted",
      intent: null,
      actorPersonId: null,
    });
  });

  it("Undo after the claim changes nothing and the send still goes", async () => {
    const { db, shop, held } = await hold();
    const claim = await claimHeldSend(db, shop.id, held.id, now, { early: true });
    expect(await undoHeldSend(db, shop.id, held.id, now)).toBe(false);
    if (claim.status === "claimed") await executeHeldSend(db, claim.row);
    expect(sendDepartureNote).toHaveBeenCalledTimes(1);
    expect((await queueRow(held.id))?.status).toBe("sent");
  });

  it("Undo before the claim means nothing leaves, on any later pass", async () => {
    const { db, shop, held } = await hold();
    expect(await undoHeldSend(db, shop.id, held.id, now)).toBe(true);
    await drainNotificationRetries(db, { now: afterHold });
    expect(sendDepartureNote).not.toHaveBeenCalled();
    expect(await queueRow(held.id)).toBeUndefined();
  });

  it("another shop cannot undo, release or read it", async () => {
    const { db, held } = await hold();
    const stranger = "00000000-0000-4000-8000-000000000000";
    expect(await undoHeldSend(db, stranger, held.id, now)).toBe(false);
    expect(await claimHeldSend(db, stranger, held.id, now, { early: true })).toEqual({
      status: "gone",
    });
    expect(await heldRows(db, { id: held.id })).toHaveLength(1);
  });
});

describe("a held send is never dropped", () => {
  it("leaves on a pass with no sealing key: it stores ids, nothing sealed", async () => {
    const { db, held } = await hold();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    const pass = await drainNotificationRetries(db, { now: afterHold });
    expect(pass.held).toEqual({ sent: 1, failed: 0 });
    expect(sendDepartureNote).toHaveBeenCalledTimes(1);
    expect((await queueRow(held.id))?.status).toBe("sent");
  });

  it("is not mistaken for a sealed retry with a missing payload", async () => {
    const { db, held } = await hold();
    await drainNotificationRetries(db, { now: afterHold });
    expect((await queueRow(held.id))?.errorCode).toBeNull();
  });

  it("a failing send settles failed with no ids left, and is not retried", async () => {
    const { db, held } = await hold();
    sendDepartureNote.mockRejectedValue(new Error("provider down"));
    const pass = await drainNotificationRetries(db, { now: afterHold, scope: "held" });
    expect(pass.held).toEqual({ sent: 0, failed: 1 });
    expect(await queueRow(held.id)).toMatchObject({
      status: "failed",
      errorCode: "held_send_failed",
      intent: null,
      actorPersonId: null,
    });
    await drainNotificationRetries(db, { now: new Date(afterHold.getTime() + 86_400_000) });
    expect(sendDepartureNote).toHaveBeenCalledTimes(1);
  });

  it("a sent row keeps no ids for the prune to wait on", async () => {
    const { db, held } = await hold();
    await drainNotificationRetries(db, { now: afterHold, scope: "held" });
    expect(await queueRow(held.id)).toMatchObject({
      status: "sent",
      intent: null,
      actorPersonId: null,
      payloadSealed: null,
    });
  });
});

describe("the queue row", () => {
  it("refuses a row that is both held and sealed", async () => {
    const { db, held } = await hold();
    await expect(
      db
        .update(notificationSendQueue)
        .set({ payloadSealed: "sealed" })
        .where(eq(notificationSendQueue.id, held.id)),
    ).rejects.toThrow();
  });
});

function nowPlus(ms: number): number {
  return afterHold.getTime() + ms;
}
