import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, people, shopBackupDeliveries, waiverRecords } from "@/db/schema";
import { getCurrentWaiverTemplate } from "@/db/waivers";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { saveShopBackupDestination } from "./destination-store";
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
    tokenHash: `backup-${email}`,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    signedName: diver.fullName,
    signatureMethod: "typed",
    consentedAt: new Date("2026-05-01T16:00:00Z"),
    signedAt: new Date("2026-05-01T16:00:00Z"),
    completedAt: new Date("2026-05-01T16:00:00Z"),
    medicalReviewRequired: false,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  const saved = await saveShopBackupDestination(
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
