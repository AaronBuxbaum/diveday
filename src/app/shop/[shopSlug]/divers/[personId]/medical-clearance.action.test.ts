import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { waiverRecords } from "@/db/schema";
import { completeWaiver } from "@/db/waivers-completion";
import { attachDiverMedicalForm } from "@/db/waivers-medical";
import { issueWaiverRequest } from "@/db/waivers-requests";
import { clearAnswers, waiverContextFor } from "@/db/waivers-test-fixtures";
import { DAY_MS, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();
const waiverContext = waiverContextFor(ctx);

/**
 * **A physician's letter from before the latest referral, from the diver's own
 * record** (issue #2616). The form's tick is the staff confirmation that the
 * physician evaluated the diver's current condition; the action passes it
 * through as typed and the domain refuses the earlier letter without it.
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
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { recordMedicalClearanceAction } = await import("./waiver-actions");

const referral = { ...clearAnswers, responses: { ...clearAnswers.responses, q3: true } };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Two referrals with the same "yes", 30 and 10 days ago; a letter dated 20 days ago sits between. */
async function reSignedDiver() {
  const context = await waiverContext();
  const { db, shop, booking, person } = context;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  const first = new Date(nowMs() - 30 * DAY_MS);
  const second = new Date(nowMs() - 10 * DAY_MS);
  const issued = await issueWaiverRequest(db, {
    shopId: shop.id,
    bookingId: booking.id,
    now: first,
  });
  if (!issued.ok) throw new Error("expected a waiver link");
  await completeWaiver(db, issued.token, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: referral,
    now: first,
  });
  const again = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id, now: second });
  if (!again.ok) throw new Error("expected a fresh link");
  await completeWaiver(db, again.token, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: referral,
    now: second,
  });
  return { ...context, letterOn: day(nowMs() - 20 * DAY_MS) };
}

function form(letterOn: string, confirmed: boolean) {
  const formData = new FormData();
  formData.set("outcome", "cleared");
  formData.set("evaluatedOn", letterOn);
  formData.set("physicianName", "Dr. Imani Reyes");
  if (confirmed) formData.set("earlierLetterConfirmed", "on");
  return formData;
}

describe("recording an earlier physician letter", () => {
  it("refuses it when the confirmation is not ticked", async () => {
    const { db, shop, person, letterOn } = await reSignedDiver();
    const to = await redirectedTo(() =>
      recordMedicalClearanceAction(shop.slug, person.id, form(letterOn, false)),
    );
    expect(to).toContain("notice=medical-clearance-date-too-early");
    const cleared = await db
      .select({ at: waiverRecords.medicalClearedAt })
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(cleared.every((row) => row.at === null)).toBe(true);
  });

  it("records it when the confirmation is ticked, and says another seat is still held", async () => {
    const { shop, person, letterOn } = await reSignedDiver();
    const to = await redirectedTo(() =>
      recordMedicalClearanceAction(shop.slug, person.id, form(letterOn, true)),
    );
    // The earlier referral still holds the seat it was signed on.
    expect(to).toContain("notice=medical-clearance-recorded-earlier-held");
  });
});

/**
 * **The signed form the diver sent, used as the evaluation** (issue #2797).
 * The checkbox carries the release that holds it; the action narrows it to an
 * id and the domain decides whether it is still this diver's to use.
 */
describe("recording with the form the diver sent", () => {
  async function diverSentForm() {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    );
    const signedAt = new Date(nowMs() - 2 * DAY_MS);
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: signedAt,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: referral,
      now: signedAt,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    if (!record) throw new Error("expected the held release");
    const url = "https://media.example.com/medical-clearances/sent.jpg";
    expect(await attachDiverMedicalForm(db, record, url, new Date(nowMs() - DAY_MS))).toBe("sent");
    return { ...context, record, url };
  }

  function usingForm(recordId: string) {
    const formData = new FormData();
    formData.set("outcome", "cleared");
    formData.set("evaluatedOn", day(nowMs() - DAY_MS));
    formData.set("diverFormRecordId", recordId);
    return formData;
  }

  it("records the answer on it, with no physician's name typed", async () => {
    const { db, shop, person, record, url } = await diverSentForm();
    const to = await redirectedTo(() =>
      recordMedicalClearanceAction(shop.slug, person.id, usingForm(record.id)),
    );
    expect(to).toContain("notice=medical-clearance-recorded");
    const [after] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
    expect(after?.medicalClearanceDocumentUrl).toBe(url);
    expect(after?.diverMedicalFormUrl).toBeNull();
  });

  it("asks for evidence when the posted release is not an id", async () => {
    const { db, shop, person, record } = await diverSentForm();
    const to = await redirectedTo(() =>
      recordMedicalClearanceAction(shop.slug, person.id, usingForm("' or 1=1 --")),
    );
    expect(to).toContain("notice=medical-clearance-evidence-required");
    const [after] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
    expect(after?.medicalClearedAt).toBeNull();
  });
});
