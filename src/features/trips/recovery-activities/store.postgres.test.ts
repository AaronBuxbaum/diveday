import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPerson } from "../../../db/people";
import {
  recoveryActivities,
  recoveryActivityParticipants,
  shops,
  userAccounts,
} from "../../../db/schema";
import {
  describePostgres,
  holdRowLock,
  postgresTestDb,
  waitForLockWaiters,
} from "../../../test/postgres";
import { classroomFixture } from "./fixture.test-support";
import { transitionRecoveryActivity } from "./store";

async function fixture() {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Classroom Reef", slug: `classroom-${randomUUID()}`, timezone: "UTC" })
    .returning();
  const actor = await createPerson(pg.db, {
    shopId: shop.id,
    fullName: "Classroom Owner",
    email: null,
    phone: null,
    origin: "counter",
    roles: ["owner"],
  });
  await pg.db
    .insert(userAccounts)
    .values({ personId: actor.id, email: `${randomUUID()}@example.com`, status: "active" });
  return { pg, ...(await classroomFixture(pg.db, shop, actor.id)) };
}
describePostgres("classroom capacity and durable attempts", () => {
  it("allocates one final place when two known source divers confirm together", async () => {
    const { pg, confirm, blowout } = await fixture();
    const results = await Promise.all([
      transitionRecoveryActivity(pg.db, confirm),
      transitionRecoveryActivity(pg.connect(), {
        ...confirm,
        attemptId: randomUUID(),
        blowoutDiverId: blowout.divers[1].id,
      }),
    ]);
    expect(results.filter((row) => row.ok)).toHaveLength(1);
    expect(await pg.db.select().from(recoveryActivityParticipants)).toHaveLength(1);
  });
  it("converges concurrent identical attempts and refuses conflicting reuse", async () => {
    const { pg, confirm } = await fixture();
    expect(
      await Promise.all([
        transitionRecoveryActivity(pg.db, confirm),
        transitionRecoveryActivity(pg.connect(), confirm),
      ]),
    ).toEqual([
      { ok: true, revision: 1 },
      { ok: true, revision: 1 },
    ]);
    expect(
      await transitionRecoveryActivity(pg.db, {
        ...confirm,
        kind: "cancel_place",
        expectedRevision: 1,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await pg.db.select().from(recoveryActivityParticipants)).toHaveLength(1);
  });
  it("serializes cancellation against confirmation without reviving an inactive activity", async () => {
    const { pg, confirm } = await fixture();
    const results = await Promise.all([
      transitionRecoveryActivity(pg.db, { ...confirm, kind: "cancel_activity" }),
      transitionRecoveryActivity(pg.connect(), { ...confirm, attemptId: randomUUID() }),
    ]);
    const [activity] = await pg.db.select().from(recoveryActivities);
    if (results[0].ok) {
      expect(activity.status).toBe("cancelled");
      expect(results[1].ok).toBe(false);
    } else {
      expect(activity.status).toBe("scheduled");
      expect(results[1].ok).toBe(true);
    }
  });
  it("serializes a capacity decrease against the second confirmation", async () => {
    const { pg, confirm, blowout } = await fixture();
    await transitionRecoveryActivity(pg.db, { ...confirm, kind: "capacity", capacity: 2 });
    await transitionRecoveryActivity(pg.db, {
      ...confirm,
      attemptId: randomUUID(),
      expectedRevision: 1,
    });
    const results = await Promise.all([
      transitionRecoveryActivity(pg.db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 2,
        kind: "capacity",
        capacity: 1,
      }),
      transitionRecoveryActivity(pg.connect(), {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 2,
        blowoutDiverId: blowout.divers[1].id,
      }),
    ]);
    expect(results.filter((row) => row.ok)).toHaveLength(1);
    const [activity] = await pg.db.select().from(recoveryActivities);
    const participants = await pg.db
      .select()
      .from(recoveryActivityParticipants)
      .where(eq(recoveryActivityParticipants.status, "confirmed"));
    expect(participants.length).toBeLessThanOrEqual(activity.capacity);
  });
  it("refuses promptly when a person is locked for identity rewrite", async () => {
    const { pg, confirm, blowout } = await fixture();
    const personId = blowout.divers[0].personId;
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${personId} for update`,
    );
    try {
      expect(await transitionRecoveryActivity(pg.connect(), confirm)).toEqual({
        ok: false,
        reason: "busy",
      });
    } finally {
      await gate.release();
    }
  });
  it("holds the activity lock before counting any place", async () => {
    const { pg, confirm } = await fixture();
    const gate = await holdRowLock(
      pg,
      sql`select id from recovery_activities where id = ${confirm.activityId} for update`,
    );
    const pending = transitionRecoveryActivity(pg.connect(), confirm);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      await gate.release();
    }
    expect(await pending).toEqual({ ok: true, revision: 1 });
  });
  it("rechecks a live role after waiting for another activity change", async () => {
    const { pg, confirm } = await fixture();
    const gate = await holdRowLock(
      pg,
      sql`select id from recovery_activities where id = ${confirm.activityId} for update`,
    );
    const pending = transitionRecoveryActivity(pg.connect(), confirm);
    try {
      await waitForLockWaiters(pg.db, 1);
      await pg.db
        .update(userAccounts)
        .set({ status: "disabled" })
        .where(eq(userAccounts.personId, confirm.actorPersonId));
    } finally {
      await gate.release();
    }
    expect(await pending).toEqual({ ok: false, reason: "not_authorized" });
    expect(await pg.db.select().from(recoveryActivityParticipants)).toHaveLength(0);
  });
});
