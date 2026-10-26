import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { recordSetupRequest } from "@/db/funnel";
import { setupRequests } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { ONBOARDING_EMAIL } from "@/lib/platform-mail";
import { SETUP_REQUESTS_PER_HOUR } from "@/lib/setup-requests";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

const ctx = fileScopedShopContext();

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
vi.mock("@/lib/pricing-arm-request", () => ({
  requestVisitorArm: vi.fn(async (): Promise<string | null> => null),
}));
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
  db = ctx.db;
  vi.mocked(getDb).mockReset().mockResolvedValue(db);
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(trackEvent).mockClear();
  vi.mocked(notify).mockReset().mockResolvedValue({ status: "sent", providerMessageId: "m1" });
});

describe("submitSetupRequestAction", () => {
  it("accepts a missing current tool and names the absence in the internal alert", async () => {
    const form = setUpForm();
    form.delete("currentSystem");
    form.set("currentSystemGuide", "eve");
    expect(await submit(form)).toEqual({ redirect: "/get-set-up/sent" });
    const [saved] = await db.select().from(setupRequests);
    expect(saved?.currentSystem).toBe("");
    expect(saved?.currentSystemGuide).toBeNull();
    expect(vi.mocked(notify).mock.calls[0]?.[0]).toMatchObject({ currentSystem: undefined });
  });

  it("stores the request, mails onboarding, counts it, and lands on the thank-you page", async () => {
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent?uses=booking_system" });

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
    expect(
      vi.mocked(notify).mock.calls.find(([message]) => message.kind === "operator_alert")?.[0],
    ).toMatchObject({
      kind: "operator_alert",
      event: "setup_request",
      setupRequestId: row?.id,
      to: ONBOARDING_EMAIL,
      contactEmail: "ana@reefline.example",
      source: "pricing-close",
    });
  });

  // Issue 2834: the address is typed into a public form and nothing has proved
  // who owns it, so the mail carrying the setup link never sets it as
  // Reply-To. The founder writes to it from the body, on purpose.
  it("sets no Reply-To from the unverified requester address", async () => {
    await submit(setUpForm());
    const alert = vi
      .mocked(notify)
      .mock.calls.find(([message]) => message.kind === "operator_alert")?.[0];
    expect(alert).toMatchObject({ contactEmail: "ana@reefline.example" });
    expect(alert).not.toHaveProperty("sender.replyTo");
  });

  it("records no pricing arm while the test is off", async () => {
    await submit(setUpForm());
    const [row] = await db.select().from(setupRequests);
    expect(row?.pricingPlan).toBeNull();
  });

  it("records the pricing arm the reader was shown (ADR 20261022-pricing-ab-test)", async () => {
    const { requestVisitorArm } = await import("@/lib/pricing-arm-request");
    vi.mocked(requestVisitorArm).mockResolvedValueOnce("percent_of_volume");
    await submit(setUpForm());
    const [row] = await db.select().from(setupRequests);
    expect(row?.pricingPlan).toBe("percent_of_volume");
  });

  /**
   * "Which one?" (2026-10-22): the system a reader names is stored, named in
   * the onboarding mail, and carried to the thank-you page, which links its
   * guide. After any other answer a value in the field is dropped everywhere.
   */
  it("stores, mails and carries the system a reader named", async () => {
    expect(await submit(setUpForm({ currentSystemGuide: "fareharbor" }))).toEqual({
      redirect: "/get-set-up/sent?uses=booking_system&guide=fareharbor",
    });
    const [row] = await db.select().from(setupRequests);
    expect(row?.currentSystemGuide).toBe("fareharbor");
    expect(vi.mocked(notify).mock.calls[0]?.[0]).toMatchObject({
      currentSystem: "booking_system",
      currentSystemGuide: "fareharbor",
    });
  });

  it("drops a named system after an answer that does not ask for one", async () => {
    expect(
      await submit(setUpForm({ currentSystem: "spreadsheet", currentSystemGuide: "fareharbor" })),
    ).toEqual({ redirect: "/get-set-up/sent?uses=spreadsheet" });
    const [row] = await db.select().from(setupRequests);
    expect(row?.currentSystemGuide).toBeNull();
    expect(vi.mocked(notify).mock.calls[0]?.[0]).not.toHaveProperty("currentSystemGuide");
  });

  /**
   * The mail carries the request's own single-use setup link (ADR
   * 20261009-single-use-setup-links), and that link opens the form with the
   * request's answers. The reader of the thank-you page is never handed it.
   */
  it("mails onboarding a setup link that opens the form for this request, once", async () => {
    const { openSetupLink, spendSetupLink } = await import("@/db/setup-links");
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent?uses=booking_system" });
    const sent = vi
      .mocked(notify)
      .mock.calls.find(([message]) => message.kind === "operator_alert")?.[0];
    if (sent?.kind !== "operator_alert" || sent.event !== "setup_request")
      throw new Error("expected the onboarding mail");
    const url = new URL(sent.setupUrl ?? "");
    expect(url.pathname).toBe("/onboard");
    expect(sent.setupUrlExpiresAt).toBeInstanceOf(Date);
    const token = url.searchParams.get("setup");
    expect(await openSetupLink(db, token)).toEqual({
      shopName: "Reef Line Divers",
      contactName: "Ana Ruiz",
      email: "ana@reefline.example",
    });
    expect(await spendSetupLink(db, token)).toBe(true);
    expect(await openSetupLink(db, token)).toBeNull();
  });

  it("sends a separate fixed requester receipt after saving the request", async () => {
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent?uses=booking_system" });
    const [row] = await db.select().from(setupRequests);
    const receipt = vi
      .mocked(notify)
      .mock.calls.find(([message]) => message.kind === "setup_request_receipt")?.[0];
    expect(receipt).toEqual({
      kind: "setup_request_receipt",
      setupRequestId: row?.id,
      to: "ana@reefline.example",
      locale: "en-US",
    });
    expect(row).toMatchObject({ receiptStatus: "accepted", receiptProviderMessageId: "m1" });
  });

  it("keeps separate duplicate submissions and the operator announcements but sends one requester receipt", async () => {
    await submit(setUpForm());
    await submit(
      setUpForm({
        shopName: "Changed shop",
        contactName: "Changed name",
        email: "ANA@REEFLINE.EXAMPLE",
      }),
    );
    expect(await db.select().from(setupRequests)).toHaveLength(2);
    const kinds = vi.mocked(notify).mock.calls.map(([message]) => message.kind);
    expect(kinds.filter((kind) => kind === "operator_alert")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "setup_request_receipt")).toHaveLength(1);
  });

  it("preserves operator notification and the saved row when the requester provider fails", async () => {
    vi.mocked(notify).mockImplementation(async (message) =>
      message.kind === "setup_request_receipt"
        ? { status: "failed", retryable: true, errorCode: "network_error" }
        : { status: "sent", providerMessageId: "operator-message" },
    );
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent?uses=booking_system" });
    expect(await db.select().from(setupRequests)).toMatchObject([
      { notifiedAt: expect.any(Date), receiptStatus: "unknown", receiptErrorCode: "network_error" },
    ]);
  });

  it("preserves the requester receipt when operator notification throws", async () => {
    vi.mocked(notify).mockImplementation(async (message) => {
      if (message.kind === "operator_alert") throw new Error("operator failed");
      return { status: "sent", providerMessageId: "requester-message" };
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await submit(setUpForm())).toEqual({
        redirect: "/get-set-up/sent?uses=booking_system",
      });
      expect(await db.select().from(setupRequests)).toMatchObject([
        {
          notifiedAt: null,
          receiptStatus: "accepted",
          receiptProviderMessageId: "requester-message",
        },
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  it("captures the final requester SES command without submitted text or the founder capability", async () => {
    const actual =
      await vi.importActual<typeof import("@/lib/notifications")>("@/lib/notifications");
    const send = vi.fn().mockResolvedValue({ MessageId: "receipt-safe" });
    const provider = actual.sesNotificationProvider(
      {
        region: "us-east-1",
        from: "DiveDay <notifications@ses.dive.day>",
        accessKeyId: "TEST",
        secretAccessKey: "TEST",
      },
      { client: { send }, maxAttempts: 1 },
    );
    vi.mocked(notify).mockImplementation(async (message) =>
      message.kind === "setup_request_receipt"
        ? actual.notify(message, provider)
        : { status: "sent", providerMessageId: "operator-message" },
    );
    expect(
      await submit(
        setUpForm({
          shopName: "Urgent: pay https://attacker.tld <img src=x>",
          contactName: "PRIVATE_PERSON",
          region: "PRIVATE_REGION",
          email: "Victim@Reef.mail",
        }),
      ),
    ).toHaveProperty("redirect");
    const operator = vi
      .mocked(notify)
      .mock.calls.find(([message]) => message.kind === "operator_alert")?.[0];
    expect(operator).toMatchObject({
      kind: "operator_alert",
      setupUrl: expect.stringContaining("/onboard?setup="),
    });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command.input).toMatchObject({
      Destination: { ToAddresses: ["victim@reef.mail"] },
      ReplyToAddresses: ["support@dive.day"],
    });
    expect(JSON.stringify(command.input)).not.toMatch(
      /attacker|PRIVATE_|onboarding@|\/onboard|setup=|CcAddresses|BccAddresses/,
    );
  });

  it.each(["Bad\r\nName", "Bad\u202eName"])(
    "rejects unsafe submitted text without sending a receipt: %s",
    async (shopName) => {
      expect(await submit(setUpForm({ shopName }))).toMatchObject({
        state: { fieldErrors: { shopName: "invalid" } },
      });
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it("clamps a tag nobody registered rather than storing it", async () => {
    await submit(setUpForm({ source: "made-up-page" }));
    const [row] = await db.select().from(setupRequests);
    expect(row?.source).toBe("unknown");
    expect(trackEvent).toHaveBeenCalledWith({ name: "setup_requested", source: "unknown" });
  });

  it("keeps the request and leaves it unnotified when the mail does not leave", async () => {
    vi.mocked(notify).mockResolvedValue({ status: "not_configured" });
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent?uses=booking_system" });
    const [row] = await db.select().from(setupRequests);
    expect(row?.notifiedAt).toBeNull();
  });

  it("still lands on the thank-you page when the mail throws", async () => {
    vi.mocked(notify).mockRejectedValue(new Error("SES exploded"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent?uses=booking_system" });
    expect(await db.select().from(setupRequests)).toHaveLength(1);
    logged.mockRestore();
  });

  it("answers a bot exactly like a person and stores, sends and counts nothing", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await submit(setUpForm({ website: "https://cheap-pills.example" }))).toEqual({
      redirect: "/get-set-up/sent?uses=booking_system",
    });
    expect(await db.select().from(setupRequests)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
    // Counted in the drain, and nothing the bot typed rides along.
    const logged = lines.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes("setup_request.honeypot_tripped"))).toBe(true);
    expect(logged.join("\n")).not.toMatch(/cheap-pills|Reef Line|reefline/i);
    lines.mockRestore();
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

  it("holds the hourly cap from the table itself, whatever the in-memory bucket says", async () => {
    const stored = {
      shopName: "Earlier Shop",
      region: "Somewhere",
      runsBoat: false,
      currentSystem: "paper" as const,
      currentSystemGuide: null,
      contactName: "Someone",
      email: "someone@example.com",
      phone: null,
      source: "pricing" as const,
      locale: "en-US",
    };
    const tenMinutesAgo = new Date(nowDate().getTime() - 10 * 60 * 1000);
    for (let i = 0; i < SETUP_REQUESTS_PER_HOUR; i += 1) {
      await recordSetupRequest(db, { ...stored, at: tenMinutesAgo });
    }
    const { state } = await submit(setUpForm());
    expect(state?.formError).toBe("rate_limited");
    expect(await db.select().from(setupRequests)).toHaveLength(SETUP_REQUESTS_PER_HOUR);
    expect(notify).not.toHaveBeenCalled();
  });

  it("lets a request through once the last hour's requests have aged out", async () => {
    const twoHoursAgo = new Date(nowDate().getTime() - 2 * 60 * 60 * 1000);
    for (let i = 0; i < SETUP_REQUESTS_PER_HOUR; i += 1) {
      await recordSetupRequest(db, {
        shopName: "Earlier Shop",
        region: "Somewhere",
        runsBoat: false,
        currentSystem: "paper",
        currentSystemGuide: null,
        contactName: "Someone",
        email: "someone@example.com",
        phone: null,
        source: "pricing",
        locale: "en-US",
        at: twoHoursAgo,
      });
    }
    expect(await submit(setUpForm())).toEqual({ redirect: "/get-set-up/sent?uses=booking_system" });
  });

  it("does not spend the global bucket on an invalid request", async () => {
    await submit(setUpForm({ shopName: "" }));
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });
});
