import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { people, waiverRecords } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { completeWaiver } from "@/db/waivers-completion";
import { recordMedicalEvaluation } from "@/db/waivers-medical";
import { issueWaiverRequest } from "@/db/waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "@/db/waivers-test-fixtures";
import { MAX_IMAGE_BYTES } from "@/lib/storage/limits";
import { fileScopedShopContext } from "@/test/db";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
    checkRateLimitFailClosed: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
  };
});
// The storage seam, not the database: the bytes' own checks are
// `storeMedicalClearanceDocument`'s contract, tested where it lives.
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, storeMedicalClearanceDocument: vi.fn() };
});
vi.mock("@/db/media-deletions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/media-deletions")>();
  return { ...actual, queueAndAttemptMediaDeletion: vi.fn(async () => undefined) };
});

const { getDb } = await import("@/db/client");
const { checkRateLimit, checkRateLimitFailClosed, RATE_LIMITS, rateLimitKey } = await import(
  "@/lib/rate-limit"
);
const { storeMedicalClearanceDocument } = await import("@/lib/storage");
const { queueAndAttemptMediaDeletion } = await import("@/db/media-deletions");
const { sendDoctorFormAction } = await import("./actions");

const STORED = "https://media.example.com/medical-clearances/abc.jpg";

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(checkRateLimitFailClosed).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

/**
 * **Sending the signed doctor's form from the doctor's page** (issue #2797,
 * ADR 20261024-diver-sent-doctors-form), against a real database. The waiver
 * link is the whole authority; every refusal happens before a byte is stored,
 * and a file the write refuses anyway is queued for deletion.
 */
describe("sendDoctorFormAction", () => {
  async function signedLink(medicalAnswers: typeof clearAnswers = medicalReferralAnswers) {
    const { db, shop, booking, person } = await waiverContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(storeMedicalClearanceDocument).mockResolvedValue({ status: "stored", url: STORED });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers,
      now,
    });
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    return { db, token: issued.token, person, shop, staff: staff.person };
  }

  const photo = (bytes = 64, type = "image/jpeg") =>
    new File([new Uint8Array(bytes)], "IMG_0042.jpg", { type });

  const send = (token: string, file: File | string | null = photo()) => {
    const form = new FormData();
    if (file !== null) form.set("doctorForm", file);
    return sendDoctorFormAction(token, { status: "idle" }, form);
  };

  async function formOn(db: Awaited<ReturnType<typeof waiverContext>>["db"], personId: string) {
    const [row] = await db
      .select({ url: waiverRecords.diverMedicalFormUrl, at: waiverRecords.diverMedicalFormSentAt })
      .from(waiverRecords)
      .where(and(eq(waiverRecords.personId, personId), eq(waiverRecords.status, "medical_review")));
    return row;
  }

  it("stores the form privately on the held release and answers with no address", async () => {
    const { db, token, person } = await signedLink();
    const state = await send(token);
    expect(state).toEqual({ status: "sent" });
    expect(JSON.stringify(state)).not.toContain("media.example.com");
    // The private medical prefix, by the one function that writes there, and
    // never the diver's own file name.
    expect(storeMedicalClearanceDocument).toHaveBeenCalledWith({
      filename: "doctors-form",
      contentType: "image/jpeg",
      bytes: expect.any(ArrayBuffer),
    });
    expect((await formOn(db, person.id))?.url).toBe(STORED);
  });

  it("rate-limits per IP, and per diver failing closed, before it reads the file", async () => {
    const { token, person } = await signedLink();
    await send(token);
    expect(vi.mocked(checkRateLimit).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [rateLimitKey("waiver-token", "203.0.113.7"), RATE_LIMITS.capabilityAction],
    ]);
    expect(vi.mocked(checkRateLimitFailClosed).mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [rateLimitKey("doctor-form", person.id), RATE_LIMITS.doctorFormByPerson],
    ]);
    vi.mocked(storeMedicalClearanceDocument).mockClear();
    vi.mocked(checkRateLimitFailClosed).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1 });
    expect(await send(token)).toEqual({ status: "rate" });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1 });
    expect(await send(token)).toEqual({ status: "rate" });
    expect(storeMedicalClearanceDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty file", () => photo(0)],
    ["a file over the cap", () => photo(MAX_IMAGE_BYTES + 1)],
    ["a page", () => photo(64, "text/html")],
    ["a script", () => photo(64, "application/javascript")],
    ["a vector image", () => photo(64, "image/svg+xml")],
    ["no file at all", () => null],
    ["a string where the file goes", () => "https://example.com/form.jpg"],
  ])("refuses %s before storing anything", async (_label, file) => {
    const { db, token, person } = await signedLink();
    expect(await send(token, file())).toEqual({ status: "invalid" });
    expect(storeMedicalClearanceDocument).not.toHaveBeenCalled();
    expect((await formOn(db, person.id))?.url).toBeNull();
  });

  it("refuses bytes the store will not take, whatever type they claimed", async () => {
    const { db, token, person } = await signedLink();
    vi.mocked(storeMedicalClearanceDocument).mockResolvedValueOnce({ status: "failed" });
    expect(await send(token, photo(64, "application/pdf"))).toEqual({ status: "invalid" });
    expect((await formOn(db, person.id))?.url).toBeNull();
  });

  it("says sending is unavailable where storage is not configured", async () => {
    const { token } = await signedLink();
    vi.mocked(storeMedicalClearanceDocument).mockResolvedValueOnce({ status: "not_configured" });
    expect(await send(token)).toEqual({ status: "unavailable" });
  });

  it("takes one form per release: the same link again stores nothing", async () => {
    const { db, token, person } = await signedLink();
    expect(await send(token)).toEqual({ status: "sent" });
    vi.mocked(storeMedicalClearanceDocument).mockClear();
    expect(await send(token)).toEqual({ status: "sent" });
    expect(storeMedicalClearanceDocument).not.toHaveBeenCalled();
    expect((await formOn(db, person.id))?.url).toBe(STORED);
  });

  it("closes for a link it cannot read, a clean release, an answered hold or an erased diver", async () => {
    const { db, token, person, shop, staff } = await signedLink();
    expect(await send("not-a-real-token")).toEqual({ status: "closed" });
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: person.id,
      recordedByPersonId: staff.id,
      evaluatedOn: "2026-07-18",
      physicianName: "Dr. Imani Reyes",
      now: new Date(now.getTime() + 60_000),
    });
    expect(await send(token)).toEqual({ status: "closed" });
    await db
      .update(waiverRecords)
      .set({ anonymizedAt: new Date(now.getTime() + 120_000) })
      .where(eq(waiverRecords.personId, person.id));
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, person.id));
    expect(await send(token)).toEqual({ status: "closed" });
    expect(storeMedicalClearanceDocument).not.toHaveBeenCalled();
  });

  it("closes for a clean release", async () => {
    const { token } = await signedLink(clearAnswers);
    expect(await send(token)).toEqual({ status: "closed" });
    expect(storeMedicalClearanceDocument).not.toHaveBeenCalled();
  });

  it("queues the stored file for deletion when the answer lands while it uploads", async () => {
    const { db, token, person, shop, staff } = await signedLink();
    vi.mocked(storeMedicalClearanceDocument).mockImplementationOnce(async () => {
      // A staffer records the physician's answer between the check and the write.
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: "2026-07-18",
        physicianName: "Dr. Imani Reyes",
        now: new Date(now.getTime() + 60_000),
      });
      return { status: "stored", url: STORED };
    });
    expect(await send(token)).toEqual({ status: "closed" });
    expect(queueAndAttemptMediaDeletion).toHaveBeenCalledWith(db, {
      shopId: shop.id,
      kind: "waiver_document",
      url: STORED,
    });
    expect((await formOn(db, person.id))?.url).toBeNull();
  });
});
