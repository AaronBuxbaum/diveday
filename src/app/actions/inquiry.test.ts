import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import type { InquiryFormState } from "@/lib/course-inquiry";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

/**
 * **The acknowledgment a diver gets for a date request** (third UX review,
 * item 13) goes to whatever address was typed into a public form. The IP
 * bucket bounds how often one sender can submit; it does not bound how often
 * one inbox is written to in the shop's name. A second bucket, per address,
 * drops the acknowledgment past two a day and never the request itself.
 */

const hoisted = vi.hoisted(() => ({ afterTasks: [] as Promise<unknown>[] }));

vi.mock("next/server", () => ({
  after: vi.fn((task: () => unknown) => {
    hoisted.afterTasks.push(Promise.resolve().then(task));
  }),
}));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});
vi.mock("@/db/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/notifications")>();
  return { ...actual, sendNotification: vi.fn(async () => ({ status: "sent" as const })) };
});

const { getDb } = await import("@/db/client");
const { checkRateLimit, RATE_LIMITS, rateLimitKey } = await import("@/lib/rate-limit");
const { sendNotification } = await import("@/db/notifications");
const { submitInquiryAction } = await import("./inquiry");

let db: AppDb;

function requestForm(email: string): FormData {
  const form = new FormData();
  form.set("interest", "A night dive");
  form.set("name", "Ana Ruiz");
  form.set("email", email);
  form.set("preferredDate", "2030-09-07");
  return form;
}

async function submit(form: FormData): Promise<InquiryFormState> {
  const state = await submitInquiryAction("blue-mantis", null, {}, form);
  await Promise.all(hoisted.afterTasks);
  return state;
}

const sentKinds = () =>
  vi.mocked(sendNotification).mock.calls.map(([, message]) => (message as { kind: string }).kind);

beforeEach(async () => {
  hoisted.afterTasks.length = 0;
  db = await seededTestDb();
  vi.mocked(getDb).mockReset().mockResolvedValue(db);
  vi.mocked(sendNotification).mockClear();
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("submitInquiryAction, the diver's acknowledgment", () => {
  it("spends the per-address bucket on the address as typed, whatever its case", async () => {
    expect(await submit(requestForm("Ana@Example.com"))).toEqual({ success: true });
    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("course-inquiry-ack", "ana@example.com"),
      RATE_LIMITS.courseInquiryAck,
    );
    expect(sentKinds()).toContain("course_inquiry_received");
  });

  it("drops the acknowledgment once that address has had its share, and keeps the request", async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (_key, config) =>
      config === RATE_LIMITS.courseInquiryAck
        ? { allowed: false, retryAfterMs: 60_000 }
        : { allowed: true, retryAfterMs: 0 },
    );
    expect(await submit(requestForm("ana@example.com"))).toEqual({ success: true });
    expect(sentKinds()).not.toContain("course_inquiry_received");
  });
});
