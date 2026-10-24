import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { demoteOwnerToManager } from "@/test/staff-session";
import type { AppDb } from "./client";
import { markMissingDiverFound, raiseMissingDiverAlert } from "./incident-reports";
import { sendMissingDiverAlerts, sendMissingDiverAllClear } from "./missing-diver-alerts";
import { MARKED_AT, mark, missingSeat, recorder, stateOf } from "./missing-diver-test-fixtures";
import { incidentReports, personRoles, userAccounts } from "./schema";

// The boat's followers are pushed by the alarm; never sent here.
const push = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./push-subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./push-subscriptions")>();
  return {
    ...actual,
    pushTripAlert: async () => {
      push.calls += 1;
      return 0;
    },
  };
});
afterEach(() => {
  push.calls = 0;
});

/**
 * **The all-clear goes to exactly the owners the alarm reached** (issue
 * #2828). An owner who never saw the alarm is not cleared of it, and one who
 * did is never left believing a diver is still missing: not after a partial
 * send, not after the owner list changed, and not when the alarm's last send
 * crosses the all-clear. At most one all-clear per owner, whatever retries.
 */
const ctx = fileScopedShopContext();
const backAt = new Date(MARKED_AT.getTime() + 60_000);

async function emailOf(db: AppDb, personId: string): Promise<string> {
  const [account] = await db
    .select({ email: userAccounts.email })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId));
  if (!account) throw new Error("expected a login");
  return account.email;
}

/** A provider that fails the named addresses, recording what it did send. */
function failingFor(addresses: readonly string[]) {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      if ("to" in notification && addresses.includes(notification.to)) {
        return { status: "failed", retryable: false, errorCode: "test" };
      }
      sent.push(notification);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  return { sent, provider };
}

const to = (sent: readonly Notification[], kind: string) =>
  sent.filter((n) => n.kind === kind).map((n) => ("to" in n ? n.to : ""));

/** The fixture's seat missing, with the divemaster made a second owner. */
async function twoOwners() {
  const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
  await db.insert(personRoles).values({ personId: f.crew.id, role: "owner" });
  return {
    db,
    f,
    input,
    ownerEmail: await emailOf(db, f.owner.id),
    secondEmail: await emailOf(db, f.crew.id),
  };
}

async function raise(
  db: AppDb,
  input: Awaited<ReturnType<typeof missingSeat>>["input"],
  actor: string,
  provider: NotificationProvider,
): Promise<string> {
  const result = await raiseMissingDiverAlert(db, { ...input, actorPersonId: actor, provider });
  if (!result.ok || !result.reportId) throw new Error("raise refused");
  return result.reportId;
}

async function reachedOf(db: AppDb, reportId: string): Promise<string[]> {
  const [row] = await db
    .select({ reached: incidentReports.missingAlertReachedPersonIds })
    .from(incidentReports)
    .where(eq(incidentReports.id, reportId));
  return [...(row?.reached ?? [])].sort();
}

describe("who the alarm reached (#2828)", () => {
  it("records the owners a partial alarm reached, and only them", async () => {
    const { db, f, input, secondEmail } = await twoOwners();
    const reportId = await raise(db, input, f.crew.id, failingFor([secondEmail]).provider);
    expect(await reachedOf(db, reportId)).toEqual([f.owner.id]);
    expect((await stateOf(db, reportId)).sentAt).toBeNull();
  });

  it("adds the owner a retry reached, without paging the first one twice", async () => {
    const { db, f, input, ownerEmail, secondEmail } = await twoOwners();
    const reportId = await raise(db, input, f.crew.id, failingFor([secondEmail]).provider);
    const retry = recorder();
    expect(await sendMissingDiverAlerts(db, { provider: retry.provider })).toMatchObject({
      alerted: 1,
    });
    expect(to(retry.sent, "incident_missing_diver")).toEqual([secondEmail]);
    expect(to(retry.sent, "incident_missing_diver")).not.toContain(ownerEmail);
    expect(await reachedOf(db, reportId)).toEqual([f.owner.id, f.crew.id].sort());
    expect((await stateOf(db, reportId)).sentAt).toBeInstanceOf(Date);
  });

  it("records nobody when every send failed", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
    const reportId = await raise(db, input, f.crew.id, recorder("failed").provider);
    expect(await reachedOf(db, reportId)).toEqual([]);
  });
});

describe("Found sends the all-clear to exactly the reached set (#2828)", () => {
  it("clears the owner a partial alarm reached, and nobody it did not", async () => {
    const { db, f, input, ownerEmail, secondEmail } = await twoOwners();
    const reportId = await raise(db, input, f.crew.id, failingFor([secondEmail]).provider);
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
    const clear = recorder();
    const found = await markMissingDiverFound(db, {
      ...input,
      reportId,
      actorPersonId: f.crew.id,
      provider: clear.provider,
    });
    expect(found).toEqual({ ok: true, changed: true, allClear: "sent" });
    expect(to(clear.sent, "incident_missing_diver_found")).toEqual([ownerEmail]);
    expect((await stateOf(db, reportId)).allClearAt).toBeInstanceOf(Date);
  });

  it("never clears an owner promoted after the alarm, who never saw it", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
    const ownerEmail = await emailOf(db, f.owner.id);
    const reportId = await raise(db, input, f.crew.id, recorder().provider);
    await db.insert(personRoles).values({ personId: f.crew.id, role: "owner" });
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
    const clear = recorder();
    await markMissingDiverFound(db, {
      ...input,
      reportId,
      actorPersonId: f.crew.id,
      provider: clear.provider,
    });
    expect(to(clear.sent, "incident_missing_diver_found")).toEqual([ownerEmail]);
  });

  it("still clears an owner demoted after the alarm reached them", async () => {
    const { db, f, input, ownerEmail, secondEmail } = await twoOwners();
    const reportId = await raise(db, input, f.crew.id, recorder().provider);
    await demoteOwnerToManager(db, f.owner.id);
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
    const clear = recorder();
    const found = await markMissingDiverFound(db, {
      ...input,
      reportId,
      actorPersonId: f.crew.id,
      provider: clear.provider,
    });
    expect(found).toMatchObject({ allClear: "sent" });
    expect(to(clear.sent, "incident_missing_diver_found").sort()).toEqual(
      [ownerEmail, secondEmail].sort(),
    );
  });

  it("sends at most one all-clear per owner: a second tap and a retry send nothing", async () => {
    const { db, f, input, secondEmail } = await twoOwners();
    const reportId = await raise(db, input, f.crew.id, failingFor([secondEmail]).provider);
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
    const clear = recorder();
    const target = { ...input, reportId, provider: clear.provider };
    await markMissingDiverFound(db, { ...target, actorPersonId: f.crew.id });
    await markMissingDiverFound(db, { ...target, actorPersonId: f.owner.id });
    expect(
      await sendMissingDiverAllClear(db, {
        shopId: input.shopId,
        reportId,
        provider: clear.provider,
      }),
    ).toBe("skipped");
    expect(clear.kinds("incident_missing_diver_found")).toBe(1);
  });

  it("says partial, never sent, when a reached owner's all-clear fails", async () => {
    const { db, f, input, ownerEmail } = await twoOwners();
    const reportId = await raise(db, input, f.crew.id, recorder().provider);
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
    const half = failingFor([ownerEmail]);
    const found = await markMissingDiverFound(db, {
      ...input,
      reportId,
      actorPersonId: f.crew.id,
      provider: half.provider,
    });
    expect(found).toMatchObject({ allClear: "partial" });
    expect((await stateOf(db, reportId)).allClearAt).toBeNull();
  });

  it("skips the all-clear when the alarm reached nobody: there is nothing to clear", async () => {
    const { db, f, input } = await missingSeat(ctx.db, ctx.shop.id);
    const reportId = await raise(db, input, f.crew.id, recorder("failed").provider);
    await mark(db, ctx.shop.id, f, f.seat.booking.id, "boarded", backAt);
    const clear = recorder();
    const found = await markMissingDiverFound(db, {
      ...input,
      reportId,
      actorPersonId: f.crew.id,
      provider: clear.provider,
    });
    expect(found).toMatchObject({ changed: true, allClear: "skipped" });
    expect(clear.sent).toEqual([]);
  });

  it("clears an owner whose alarm went out as the all-clear was claimed", async () => {
    const { db, f, input, ownerEmail, secondEmail } = await twoOwners();
    // The first send reached only the owner; the retry pass reaches the
    // second owner just as the boat taps Found and the all-clear is claimed.
    const reportId = await raise(db, input, f.crew.id, failingFor([secondEmail]).provider);
    const clears: Notification[] = [];
    const provider: NotificationProvider = {
      async send(notification) {
        if (notification.kind === "incident_missing_diver_found") {
          clears.push(notification);
        } else if (notification.kind === "incident_missing_diver") {
          // Found, and its all-clear claimed, while this alarm is in flight.
          await db
            .update(incidentReports)
            .set({ missingFoundAt: backAt, missingFoundByPersonId: f.crew.id })
            .where(eq(incidentReports.id, reportId));
          await sendMissingDiverAllClear(db, { shopId: input.shopId, reportId, provider });
        }
        return { status: "sent", providerMessageId: `msg-${clears.length}` };
      },
    };
    await sendMissingDiverAlerts(db, { provider });
    expect(to(clears, "incident_missing_diver_found").sort()).toEqual(
      [ownerEmail, secondEmail].sort(),
    );
  });
});
