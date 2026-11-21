import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, people, shopBackupDeliveries, waiverRecords } from "@/db/schema";
import { getCurrentWaiverTemplate } from "@/db/waivers";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { recordShopBackupDestination } from "./destination-store";
import { runShopBackup } from "./run-backup";

/**
 * "Test backup" ships the same waiver_records.csv, medical answers included, as
 * the download, so it leaves the same per-diver `medical_answers_read` line and
 * ships nothing if the line cannot be written (issue #2618).
 */
const ctx = fileScopedShopContext();
const KEY = randomBytes(32);
const LABELS = { calendarName: "c", crew: "crew", course: "course", day: (n: number) => `d${n}` };

async function answeredDiver(email: string) {
  const { db, shop } = ctx;
  const [diver] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: `Backup ${email}`, email })
    .returning();
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!diver || !template) throw new Error("fixture failed");
  await db.insert(waiverRecords).values({
    shopId: shop.id,
    bookingId: null,
    personId: diver.id,
    templateId: template.id,
    templateTitle: template.title,
    templateVersion: template.version,
    templateBody: template.body,
    status: "completed",
    signedName: diver.fullName,
    signatureMethod: "typed",
    consentedAt: new Date("2026-05-01T16:00:00Z"),
    signedAt: new Date("2026-05-01T16:00:00Z"),
    completedAt: new Date("2026-05-01T16:00:00Z"),
    medicalReviewRequired: false,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  const saved = await recordShopBackupDestination(
    db,
    {
      shopId: shop.id,
      endpoint: "https://backups.example.com",
      region: "auto",
      bucket: "b",
      prefix: "p",
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secret-access-key",
    },
    { key: KEY },
  );
  if (saved.status !== "saved") throw new Error("destination save failed");
  return diver.id;
}

const reads = (personId: string) =>
  ctx.db
    .select({ actor: activityEvents.actorPersonId })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.subjectPersonId, personId),
        eq(activityEvents.code, "medical_answers_read"),
      ),
    );

const base = () => ({
  trigger: "manual" as const,
  icsLabels: LABELS,
  origin: "https://app.example.com",
  now: new Date("2026-08-04T06:00:00Z"),
  key: KEY,
});

describe("runShopBackup medical-answers audit", () => {
  it("writes a read line per answered diver, naming the staffer who pressed the button", async () => {
    const { db, shop } = ctx;
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const diverId = await answeredDiver("audit.backup@example.com");
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await runShopBackup(db, {
      ...base(),
      shopId: shop.id,
      readerPersonId: owner,
      fetchImpl,
    });

    expect(result.status).toBe("delivered");
    expect(await reads(diverId)).toEqual([{ actor: owner }]);
  });

  it("uploads nothing and records a failed delivery when the line cannot be written", async () => {
    const { db, shop } = ctx;
    const diverId = await answeredDiver("audit.fail.backup@example.com");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    // A reader who is no person of this shop makes the audit write throw.
    const result = await runShopBackup(db, {
      ...base(),
      shopId: shop.id,
      readerPersonId: randomUUID(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ status: "failed", errorCode: "bundle_failed" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await reads(diverId)).toEqual([]);
    const rows = await db
      .select({ status: shopBackupDeliveries.status })
      .from(shopBackupDeliveries)
      .where(eq(shopBackupDeliveries.shopId, shop.id));
    expect(rows.some((r) => r.status === "failed")).toBe(true);
  });
});

/**
 * Issue 3871, Aaron's call (b) and (c): a scheduled run that carried medical
 * answers writes one shop-level line per run, and one line on a diver's trail
 * the first time a scheduled backup holds their answers; never a weekly line
 * per diver, and nothing for the platform backup (`platform-backup.ts` builds
 * the same bundle and asks for no audit).
 */
describe("runShopBackup scheduled medical-answers audit (issue 3871)", () => {
  const scheduledLines = (shopId: string) =>
    ctx.db
      .select({
        code: activityEvents.code,
        subject: activityEvents.subjectPersonId,
        actor: activityEvents.actorPersonId,
        reason: activityEvents.systemReason,
        params: activityEvents.params,
      })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.shopId, shopId),
          inArray(activityEvents.code, [
            "scheduled_backup_medical_answers",
            "scheduled_backup_holds_medical_answers",
          ]),
        ),
      );

  it("writes one shop line per run and one diver line the first time only", async () => {
    const { db, shop } = ctx;
    const diverId = await answeredDiver("audit.scheduled@example.com");
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;

    const first = await runShopBackup(db, {
      ...base(),
      trigger: "scheduled",
      shopId: shop.id,
      fetchImpl,
    });
    expect(first.status).toBe("delivered");
    const afterFirst = await scheduledLines(shop.id);
    const shopLines = afterFirst.filter((l) => l.code === "scheduled_backup_medical_answers");
    expect(shopLines).toHaveLength(1);
    expect(shopLines[0]).toMatchObject({ subject: null, actor: null, reason: "scheduled_backup" });
    expect(Number((shopLines[0]?.params as { count?: string } | undefined)?.count)).toBeGreaterThan(
      0,
    );
    expect(
      afterFirst.filter(
        (l) => l.code === "scheduled_backup_holds_medical_answers" && l.subject === diverId,
      ),
    ).toEqual([
      expect.objectContaining({ actor: null, reason: "scheduled_backup", subject: diverId }),
    ]);
    // A scheduled run names no staffer as a reader.
    expect(await reads(diverId)).toEqual([]);

    const nextWeek = await runShopBackup(db, {
      ...base(),
      trigger: "scheduled",
      now: new Date("2026-08-11T06:00:00Z"),
      shopId: shop.id,
      fetchImpl,
    });
    expect(nextWeek.status).toBe("delivered");
    const afterSecond = await scheduledLines(shop.id);
    expect(afterSecond.filter((l) => l.code === "scheduled_backup_medical_answers")).toHaveLength(
      2,
    );
    expect(
      afterSecond.filter(
        (l) => l.code === "scheduled_backup_holds_medical_answers" && l.subject === diverId,
      ),
    ).toHaveLength(1);
  });

  it("writes nothing when the upload fails, and the line names the delivery that landed", async () => {
    const { db, shop } = ctx;
    await answeredDiver("audit.refused@example.com");
    const refused = vi.fn(
      async () => new Response(null, { status: 403 }),
    ) as unknown as typeof fetch;
    const failed = await runShopBackup(db, {
      ...base(),
      trigger: "scheduled",
      now: new Date("2026-09-01T06:00:00Z"),
      shopId: shop.id,
      fetchImpl: refused,
    });
    expect(failed.status).not.toBe("delivered");
    expect(await scheduledLines(shop.id)).toEqual([]);

    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    const landed = await runShopBackup(db, {
      ...base(),
      trigger: "scheduled",
      now: new Date("2026-09-01T07:00:00Z"),
      shopId: shop.id,
      fetchImpl,
    });
    if (landed.status !== "delivered") throw new Error(`retry did not deliver: ${landed.status}`);
    const lines = (await scheduledLines(shop.id)).filter(
      (l) => l.code === "scheduled_backup_medical_answers",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.params).toMatchObject({ delivery: landed.deliveryId });
  });

  it("writes no scheduled line on a manual run", async () => {
    const { db, shop } = ctx;
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await answeredDiver("audit.manual.only@example.com");
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    await runShopBackup(db, { ...base(), shopId: shop.id, readerPersonId: owner, fetchImpl });
    expect(await scheduledLines(shop.id)).toEqual([]);
  });
});
