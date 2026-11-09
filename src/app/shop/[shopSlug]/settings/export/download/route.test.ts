import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, people, waiverRecords } from "@/db/schema";
import { getCurrentWaiverTemplate } from "@/db/waivers";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

/**
 * The bulk export hands out every release's medical answers at once
 * (`waiver_records.csv`), so it leaves what "Show answers" leaves: one
 * `medical_answers_read` line on the trail of each diver whose answers are in
 * the file, written before the ZIP is served. If the trail cannot be written,
 * the ZIP is not served (issue #2618).
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("../../../../../../features/session/rules", () => ({ requireStaffSession: vi.fn() }));
vi.mock("../../../../../../features/step-up/store", () => ({
  hasRequiredStepUp: vi.fn(async () => true),
}));
vi.mock("@/db/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/operations")>();
  return { ...actual, recordMedicalAnswersExported: vi.fn(actual.recordMedicalAnswersExported) };
});
vi.mock("@/lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export")>();
  return {
    ...actual,
    fetchExportPhotos: vi.fn(async () => ({
      photos: [],
      manifest: { version: 1, expected: 0, included: 0, complete: true, files: [] },
    })),
  };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../../../features/session/rules");
const { recordMedicalAnswersExported } = await import("@/db/operations");
const { GET } = await import("./route");

const ctx = fileScopedShopContext();

async function signInOwner() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["owner"] }),
  );
  return personId;
}

async function signedRelease(email: string, withAnswers: boolean) {
  const { db, shop } = ctx;
  const [diver] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: `Export ${email}`, email })
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
    medicalAnswers: withAnswers ? emptyMedicalAnswers(RSTC_QUESTIONNAIRE) : null,
  });
  return diver.id;
}

async function readLines(personId: string) {
  return ctx.db
    .select({ actor: activityEvents.actorPersonId })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.subjectPersonId, personId),
        eq(activityEvents.code, "medical_answers_read"),
      ),
    );
}

describe("GET the bulk export", () => {
  it("writes a medical_answers_read line for each diver whose answers are in the file, and none for one without", async () => {
    const owner = await signInOwner();
    const answered = await signedRelease("answered.export@example.com", true);
    const paper = await signedRelease("paper.export@example.com", false);

    const response = await GET(new Request("https://diveday.test/export/download"));

    expect(response.status).toBe(200);
    expect(await readLines(answered)).toEqual([{ actor: owner }]);
    expect(await readLines(paper)).toEqual([]);
  });

  it("serves no ZIP when the trail cannot be written", async () => {
    await signInOwner();
    const answered = await signedRelease("failing.export@example.com", true);
    vi.mocked(recordMedicalAnswersExported).mockRejectedValueOnce(new Error("trail down"));

    await expect(GET(new Request("https://diveday.test/export/download"))).rejects.toThrow();
    expect(await readLines(answered)).toEqual([]);
  });
});
