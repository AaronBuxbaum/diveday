import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { setupRequests } from "@/db/schema";
import { ONBOARDING_EMAIL } from "@/lib/platform-mail";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

/**
 * The public set-up form's action (ADR 20261007-setup-request-form): what it
 * stores, what it refuses, and what it tells a bot. `after()` runs its task
 * where the test can wait on it, so the mail and the event are observable.
 */

const hoisted = vi.hoisted(() => ({ afterTasks: [] as Promise<unknown>[] }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
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
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, notify: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { trackEvent } = await import("@/lib/analytics");
const { notify } = await import("@/lib/notifications");
const { submitSetupRequestAction } = await import("./actions");

let db: AppDb;

function setUpForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields = {
    source: "pricing-close",
    shopName: "Reef Line Divers",
    region: "Key Largo, FL",
    runsBoat: "yes",
    currentSystem: "booking_system",
    contactName: "Ana Ruiz",
    email: "Ana@ReefLine.example",
    phone: "",
    website: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

/** Submit, returning either the redirect target or the state the form re-renders with. */
async function submit(form: FormData) {
  try {
    const state = await submitSetupRequestAction({}, form);
    await Promise.all(hoisted.afterTasks);
    return { state };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("REDIRECT:")) throw error;
    await Promise.all(hoisted.afterTasks);
    return { redirect: message.slice("REDIRECT:".length) };
  }
}

beforeEach(async () => {
  hoisted.afterTasks.length = 0;
  db = await seededTestDb();
  vi.mocked(getDb).mockReset().mockResolvedValue(db);
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(trackEvent).mockClear();
  vi.mocked(notify).mockReset().mockResolvedValue({ status: "sent", providerMessageId: "m1" });
});

describe("submitSetupRequestAction", () => {
  it("stores the request, mails onboarding, counts it, and lands on the thank-you page", async () => {
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent" });

    const [row] = await db.select().from(setupRequests);
    expect(row).toMatchObject({
      shopName: "Reef Line Divers",
      region: "Key Largo, FL",
      runsBoat: true,
      currentSystem: "booking_system",
      contactName: "Ana Ruiz",
      email: "ana@reefline.example",
      phone: null,
      source: "pricing-close",
      locale: "en-US",
    });
    expect(row?.notifiedAt).toBeInstanceOf(Date);

    expect(trackEvent).toHaveBeenCalledWith({ name: "setup_requested", source: "pricing-close" });
    expect(vi.mocked(notify).mock.calls[0]?.[0]).toMatchObject({
      kind: "setup_request_alert",
      setupRequestId: row?.id,
      to: ONBOARDING_EMAIL,
      contactEmail: "ana@reefline.example",
      source: "pricing-close",
      sender: { replyTo: "ana@reefline.example" },
    });
  });

  it("clamps a tag nobody registered rather than storing it", async () => {
    await submit(setUpForm({ source: "made-up-page" }));
    const [row] = await db.select().from(setupRequests);
    expect(row?.source).toBe("unknown");
    expect(trackEvent).toHaveBeenCalledWith({ name: "setup_requested", source: "unknown" });
  });

  it("keeps the request and leaves it unnotified when the mail does not leave", async () => {
    vi.mocked(notify).mockResolvedValue({ status: "not_configured" });
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent" });
    const [row] = await db.select().from(setupRequests);
    expect(row?.notifiedAt).toBeNull();
  });

  it("still lands on the thank-you page when the mail throws", async () => {
    vi.mocked(notify).mockRejectedValue(new Error("SES exploded"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent" });
    expect(await db.select().from(setupRequests)).toHaveLength(1);
    logged.mockRestore();
  });

  it("answers a bot exactly like a person and stores, sends and counts nothing", async () => {
    expect(await submit(setUpForm({ website: "https://cheap-pills.example" }))).toEqual({
      redirect: "/get-set-up/sent",
    });
    expect(await db.select().from(setupRequests)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("names each refused field and hands back what was typed", async () => {
    const { state } = await submit(setUpForm({ email: "not-an-address", region: "" }));
    expect(state).toEqual({
      fieldErrors: { region: "required", email: "invalid" },
      values: expect.objectContaining({ shopName: "Reef Line Divers", email: "not-an-address" }),
    });
    expect(await db.select().from(setupRequests)).toEqual([]);
  });

  it("refuses past the per-IP limit before reading anything else", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    const { state } = await submit(setUpForm({ website: "bot" }));
    expect(state?.formError).toBe("rate_limited");
    expect(await db.select().from(setupRequests)).toEqual([]);
  });

  it("refuses past the global limit only after the request was otherwise good", async () => {
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 });
    const { state } = await submit(setUpForm());
    expect(state?.formError).toBe("rate_limited");
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(await db.select().from(setupRequests)).toEqual([]);
  });

  it("does not spend the global bucket on an invalid request", async () => {
    await submit(setUpForm({ shopName: "" }));
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });
});
