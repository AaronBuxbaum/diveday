import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The gate on the most sensitive file the product holds** (issue #1283).
 *
 * #1252 shipped the write before the read on purpose: a read path needs a
 * permission gate and an IAM grant that did not exist. This is that gate, so
 * what these cases are about is *refusals* — every one of which must look
 * identical from outside, and none of which may reach the storage layer.
 *
 * The positive case is deliberately thin: that a signed GET is issued and its
 * bytes are handed back is `readS3Object`'s contract, tested where it lives.
 * What cannot be tested anywhere else is who gets that far.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/db/shops", () => ({ getShopById: vi.fn() }));
vi.mock("@/db/authz", () => ({ canPersonReadMedicalClearanceDocument: vi.fn() }));
vi.mock("@/db/waivers", () => ({ getMedicalClearanceDocument: vi.fn() }));
vi.mock("@/db/operations", () => ({ recordDiverActivity: vi.fn(async () => true) }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, readS3Object: vi.fn() };
});

const { auth } = await import("@/lib/auth");
const { getDb } = await import("@/db/client");
const { getShopById } = await import("@/db/shops");
const { canPersonReadMedicalClearanceDocument } = await import("@/db/authz");
const { getMedicalClearanceDocument } = await import("@/db/waivers");
const { recordDiverActivity } = await import("@/db/operations");
const { readS3Object } = await import("@/lib/storage");
const { GET } = await import("./route");

const SHOP = { id: "shop-1", slug: "blue-mantis" };

function request() {
  return new Request("http://localhost/api/medical-clearances/record-1");
}

function params() {
  return { params: Promise.resolve({ recordId: "record-1" }) };
}

/** A signed-in manager of shop-1, with a document on file and storage configured. */
function everythingInPlace() {
  vi.mocked(auth).mockResolvedValue({
    user: { personId: "person-1", shopId: SHOP.id, roles: ["manager"] },
  } as never);
  vi.mocked(getDb).mockResolvedValue({} as never);
  vi.mocked(getShopById).mockResolvedValue(SHOP as never);
  vi.mocked(canPersonReadMedicalClearanceDocument).mockResolvedValue(true);
  vi.mocked(getMedicalClearanceDocument).mockResolvedValue({
    url: "https://media.example.com/medical-clearances/abc.pdf",
    personId: "diver-1",
  });
  vi.mocked(readS3Object).mockResolvedValue({
    ok: true,
    bytes: new TextEncoder().encode("%PDF-1.4").buffer,
    contentType: "application/pdf",
  } as never);
  // `clearAllMocks` clears calls, not implementations, so a rejection set by
  // one case would otherwise be the standing behaviour for every case after it.
  vi.mocked(recordDiverActivity).mockResolvedValue(true);
}

beforeEach(() => {
  vi.stubEnv("MEDIA_S3_BUCKET", "diveday-media");
  vi.stubEnv("MEDIA_S3_REGION", "us-east-1");
  vi.stubEnv("MEDIA_S3_ACCESS_KEY_ID", "AKIA-test");
  vi.stubEnv("MEDIA_S3_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("MEDIA_PUBLIC_URL_BASE", "https://media.example.com");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Every refusal is the same 404, so the route can never be used as an oracle. */
async function expectRefused(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(readS3Object).not.toHaveBeenCalled();
}

describe("GET /api/medical-clearances/[recordId]", () => {
  it("hands the evaluation back to a manager of the shop that stored it", async () => {
    everythingInPlace();
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    // Never inline: an evaluation framed in a page would land in the browser's
    // own history and preview cache.
    expect(response.headers.get("Content-Disposition")).toBe("attachment");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    // The one header on this list whose removal would actually matter: the
    // type is echoed from storage, so `nosniff` beside `attachment` is what
    // stops a body the browser might otherwise decide to render.
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // The prefix is named by the caller rather than trusted from the column.
    expect(readS3Object).toHaveBeenCalledWith(
      "https://media.example.com/medical-clearances/abc.pdf",
      expect.objectContaining({ bucket: "diveday-media" }),
      { prefix: "medical-clearances" },
    );
  });

  it("401s a caller with no session, before it costs a database connection", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await GET(request(), params());
    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("401s a signed-in diver, on the roles their token claims", async () => {
    // The pre-filter, which is deliberately not the gate: it refuses somebody
    // who never claimed a staff role at all without touching the database.
    vi.mocked(auth).mockResolvedValue({
      user: { personId: "person-9", shopId: SHOP.id, roles: ["diver"] },
    } as never);
    const response = await GET(request(), params());
    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  /**
   * **The case the pre-filter cannot answer.** A divemaster is staff, so the
   * token check lets them through; the live capability is what refuses them.
   * This is also the demotion case — the roles in a session stamped this
   * morning are not the roles the shop holds now.
   */
  it("404s a staff member the live capability refuses", async () => {
    everythingInPlace();
    vi.mocked(auth).mockResolvedValue({
      user: { personId: "person-2", shopId: SHOP.id, roles: ["divemaster"] },
    } as never);
    vi.mocked(canPersonReadMedicalClearanceDocument).mockResolvedValue(false);

    await expectRefused(await GET(request(), params()));
    // And the record was never even looked up: the gate runs first, so a
    // refused caller learns nothing about whether the id exists.
    expect(getMedicalClearanceDocument).not.toHaveBeenCalled();
  });

  it("404s a record that is not this shop's, without saying which it is", async () => {
    everythingInPlace();
    // The reader is shop-scoped in its own query; a foreign id simply misses.
    vi.mocked(getMedicalClearanceDocument).mockResolvedValue(null);
    await expectRefused(await GET(request(), params()));
    expect(getMedicalClearanceDocument).toHaveBeenCalledWith({}, SHOP.id, "record-1");
  });

  it("404s when the session's shop no longer exists", async () => {
    everythingInPlace();
    vi.mocked(getShopById).mockResolvedValue(undefined as never);
    await expectRefused(await GET(request(), params()));
    expect(canPersonReadMedicalClearanceDocument).not.toHaveBeenCalled();
  });

  it("404s rather than 500s when storage is not configured", async () => {
    // The same absence that makes the upload a no-op. There is genuinely no
    // document to hand back and the shop has no action to take, so an error
    // page would be furniture over a fact.
    everythingInPlace();
    vi.stubEnv("MEDIA_S3_BUCKET", "");
    await expectRefused(await GET(request(), params()));
  });

  it("404s when the object cannot be read, and keeps the key out of the log", async () => {
    everythingInPlace();
    vi.mocked(readS3Object).mockResolvedValue({ ok: false, error: "provider responded 403" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await GET(request(), params());
    expect(response.status).toBe(404);
    const line = warn.mock.calls.at(-1)?.[0] as string;
    expect(line).toContain("medical_clearance_read_failed");
    expect(line).toContain("record-1");
    // The key names the shop's own storage layout and this goes to CloudWatch.
    expect(line).not.toContain("medical-clearances/abc.pdf");
    warn.mockRestore();
  });

  /**
   * **The read is attributed** (issue #1283). Every other act of comparable
   * weight in this app leaves a row — the incident export stamps its generator
   * into the document, seating a diver appends to this same trail. Without one
   * here, an owner or manager could read any cleared diver's physician letter,
   * repeatedly, and the shop would have no way to know; that trail, more than
   * the role list, is what makes owner-or-manager defensible.
   */
  it("writes who opened it onto the diver's own record", async () => {
    everythingInPlace();
    await GET(request(), params());
    expect(recordDiverActivity).toHaveBeenCalledWith(
      {},
      {
        shopId: SHOP.id,
        personId: "diver-1",
        actorPersonId: "person-1",
        action: "opened the physician's evaluation for",
      },
    );
  });

  it("does not hand the file over when the read cannot be recorded", async () => {
    // An audit trail that can be skipped by breaking it is not one. The same
    // call the diver-export route makes one door over.
    everythingInPlace();
    vi.mocked(recordDiverActivity).mockRejectedValue(new Error("trail is down"));
    await expect(GET(request(), params())).rejects.toThrow();
  });

  /**
   * The type comes back from an external service now, so it is allow-listed
   * rather than echoed. `attachment` + `nosniff` already make an unexpected
   * type harmless; this removes the assumption as well.
   */
  it("serves an unexpected content type as bytes", async () => {
    everythingInPlace();
    vi.mocked(readS3Object).mockResolvedValue({
      ok: true,
      bytes: new TextEncoder().encode("<script>alert(1)</script>").buffer,
      contentType: "text/html",
    } as never);
    const response = await GET(request(), params());
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});
