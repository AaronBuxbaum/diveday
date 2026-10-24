import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityEvents, shops, waiverRecords } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { completeWaiver } from "@/db/waivers-completion";
import { attachDiverMedicalForm, recordMedicalEvaluation } from "@/db/waivers-medical";
import { issueWaiverRequest } from "@/db/waivers-requests";
import { medicalReferralAnswers, now, waiverContextFor } from "@/db/waivers-test-fixtures";
import { fileScopedShopContext } from "@/test/db";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, readS3Object: vi.fn() };
});

vi.mock("@/db/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/operations")>();
  return { ...actual, recordDiverActivity: vi.fn(actual.recordDiverActivity) };
});

const { auth } = await import("@/lib/auth");
const { recordDiverActivity } = await import("@/db/operations");
const { getDb } = await import("@/db/client");
const { readS3Object } = await import("@/lib/storage");
const { GET: getDiverForm } = await import("./route");
const { GET: getEvaluation } = await import("../route");

const MEDIA = "https://media.example.com";
const FORM_URL = `${MEDIA}/medical-clearances/diver-form.jpg`;
const later = new Date(now.getTime() + 60_000);

beforeEach(() => {
  vi.stubEnv("MEDIA_BUCKET_NAME", "diveday-media");
  vi.stubEnv("MEDIA_AWS_REGION", "us-east-1");
  vi.stubEnv("MEDIA_AWS_ACCESS_KEY_ID", "AKIA-test");
  vi.stubEnv("MEDIA_AWS_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("MEDIA_PUBLIC_URL_BASE", MEDIA);
  vi.mocked(readS3Object).mockResolvedValue({
    ok: true,
    bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    contentType: "image/jpeg",
  } as never);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

/**
 * **Who may open the doctor's form a diver sent** (issue #2797, ADR
 * 20261024-diver-sent-doctors-form), against a real database: every live
 * staff role, because every live staff role may record the answer; never
 * another shop, a diver, an erased record or a stale token's roles; and every
 * open on the diver's trail.
 */
describe("GET /api/medical-clearances/[recordId]/diver-form", () => {
  async function sentForm() {
    const { db, shop, booking, person } = await waiverContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    if (!record) throw new Error("expected the held release");
    expect(await attachDiverMedicalForm(db, record, FORM_URL, later)).toBe("sent");
    const staff = await listStaff(db, shop.id);
    // A crew member who is neither owner nor manager: the widening this route exists for.
    const crew = staff.find(
      (entry) => !entry.roles.includes("owner") && !entry.roles.includes("manager"),
    );
    if (!crew) throw new Error("expected a crew member at the demo shop");
    return { db, shop, person, record, crew };
  }

  function signIn(personId: string, shopId: string, roles: string[]) {
    vi.mocked(auth).mockResolvedValue({ user: { personId, shopId, roles } } as never);
  }

  const open = (recordId: string) =>
    getDiverForm(new Request(`http://localhost/api/medical-clearances/${recordId}/diver-form`), {
      params: Promise.resolve({ recordId }),
    });

  async function expectRefused(response: Response) {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(readS3Object).not.toHaveBeenCalled();
  }

  async function opensOnTrail(db: Awaited<ReturnType<typeof waiverContext>>["db"]) {
    return db
      .select({ actor: activityEvents.actorPersonId, subject: activityEvents.subjectPersonId })
      .from(activityEvents)
      .where(eq(activityEvents.code, "diver_medical_form_opened"));
  }

  it("hands the form to a crew member who may record the answer, and writes it on the trail", async () => {
    const { db, shop, person, record, crew } = await sentForm();
    signIn(crew.person.id, shop.id, crew.roles);
    const response = await open(record.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Disposition")).toBe("attachment");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(readS3Object).toHaveBeenCalledWith(FORM_URL, expect.anything(), {
      prefix: "medical-clearances",
    });
    expect(await opensOnTrail(db)).toEqual([{ actor: crew.person.id, subject: person.id }]);
    const [line] = await db
      .select({ params: activityEvents.params })
      .from(activityEvents)
      .where(eq(activityEvents.code, "diver_medical_form_opened"));
    expect(line?.params.record).toBe(record.id);
  });

  it("is a wider door than the evaluation's, on purpose: the same crew member cannot open that", async () => {
    const { shop, record, crew } = await sentForm();
    signIn(crew.person.id, shop.id, crew.roles);
    const response = await getEvaluation(new Request("http://localhost/"), {
      params: Promise.resolve({ recordId: record.id }),
    });
    expect(response.status).toBe(404);
  });

  it("401s no session and a diver, before any database work", async () => {
    const { person, shop, record } = await sentForm();
    vi.mocked(getDb).mockClear();
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await open(record.id)).status).toBe(401);
    signIn(person.id, shop.id, ["diver"]);
    expect((await open(record.id)).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("404s a token that claims a staff role the shop no longer gives", async () => {
    // The diver, holding a session stamped "divemaster": live roles say no.
    const { person, shop, record } = await sentForm();
    signIn(person.id, shop.id, ["divemaster"]);
    await expectRefused(await open(record.id));
  });

  it("404s staff of another shop, and an id that is not a record", async () => {
    const { db, record, crew } = await sentForm();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-2797-route", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("expected a second shop");
    // The crew member's id with the other shop in the session: they are not
    // staff there, and the record is not that shop's either.
    signIn(crew.person.id, other.id, crew.roles);
    await expectRefused(await open(record.id));
    const { shop } = await waiverContext();
    signIn(crew.person.id, shop.id, crew.roles);
    await expectRefused(await open("not-a-uuid"));
  });

  it("404s an erased record, and one whose answer is recorded", async () => {
    const { db, shop, person, record, crew } = await sentForm();
    signIn(crew.person.id, shop.id, crew.roles);
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: person.id,
      recordedByPersonId: crew.person.id,
      evaluatedOn: "2026-07-18",
      physicianName: "Dr. Imani Reyes",
      now: later,
    });
    // Recorded with the staffer's own evidence: the diver's copy is gone.
    await expectRefused(await open(record.id));

    const again = await sentFormAfter(db, shop.id, record.id);
    await db.update(waiverRecords).set({ anonymizedAt: later }).where(eq(waiverRecords.id, again));
    await expectRefused(await open(again));
    expect(await opensOnTrail(db)).toEqual([]);
  });

  it("does not hand the file over when the read cannot be recorded", async () => {
    const { db, shop, record, crew } = await sentForm();
    signIn(crew.person.id, shop.id, crew.roles);
    // An audit trail that can be skipped by breaking it is not one.
    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("trail is down");
    });
    await expect(open(record.id)).rejects.toThrow("trail is down");
  });

  it("does not hand the file over when the trail cannot name the reader", async () => {
    // A staffer removed after their roles were read: the trail line needs a
    // live actor, writes nothing, and the file stays put.
    const { db, shop, record, crew } = await sentForm();
    signIn(crew.person.id, shop.id, crew.roles);
    vi.mocked(recordDiverActivity).mockResolvedValueOnce(false);
    await expect(open(record.id)).resolves.toMatchObject({ status: 404 });
    expect(await opensOnTrail(db)).toEqual([]);
  });

  /** A second held release with a form, on the same seat, for the erased case. */
  async function sentFormAfter(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    shopId: string,
    previousId: string,
  ) {
    await db
      .update(waiverRecords)
      .set({ supersededAt: later })
      .where(eq(waiverRecords.id, previousId));
    const { booking, person } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a fresh waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    const latest = await latestHeld(db, booking.id);
    if (!latest) throw new Error("expected the new held release");
    expect(await attachDiverMedicalForm(db, latest, FORM_URL, later)).toBe("sent");
    return latest.id;
  }

  async function latestHeld(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    bookingId: string,
  ) {
    const rows = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, bookingId), eq(waiverRecords.status, "medical_review")),
      );
    return rows.find((row) => row.supersededAt === null && row.medicalClearedAt === null);
  }
});
