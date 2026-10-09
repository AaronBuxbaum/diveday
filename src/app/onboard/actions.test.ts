import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextHeadersStub } from "@/test/next-headers";

/**
 * **The reserved demo namespace is an invariant of the write path**
 * (security review finding; ADR 20260803-demo-bypass-containment, amended).
 *
 * `onboardAction` and `inviteStaffMember` are the only two non-test writers of
 * `user_accounts.email` for a *real* shop. The demo sign-in bypass's third
 * condition — "the account's email sits in `*.demo.invalid`" — held because
 * both of them mail the address and `.invalid` never resolves, so nobody
 * *would* use one. That is an emergent property, and it left one combination
 * open: a tenant that already holds an account in the namespace and then has
 * `is_demo` flipped, at which point `DEMO_BYPASS_PASSWORD` opens a real shop.
 *
 * This file pins the onboarding half. The refusal lands before any database
 * handle is taken at all, which is what `getDb` never being called asserts.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Neither the sign-in call nor its result matters to this file — the refusal
// lands long before either, and stubbing avoids standing up the real
// better-auth instance (which wants a resolved database handle).
const hoisted = vi.hoisted(() => ({ signInDiveDayCredentials: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({
    api: { signInDiveDayCredentials: hoisted.signInDiveDayCredentials },
  })),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
// Everything the action defers — the funnel event, the founder alert, the
// welcome and verification mail — rides `after()`. Dropped on the floor here:
// none of it is what either suite is about, and the real one wants a request
// context this test has no reason to stand up.
vi.mock("next/server", () => ({ after: vi.fn() }));
// The first day the form's two optional fields describe. Stubbed so the suite
// below can make it fail on demand.
vi.mock("@/db/first-day", () => ({ createFirstDay: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true })) };
});

const { getDb } = await import("@/db/client");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { recordSetupRequest } = await import("@/db/funnel");
const { issueSetupLink } = await import("@/db/setup-links");
const { createFirstDay } = await import("@/db/first-day");
const { onboardAction } = await import("./actions");
const { unseededTestDb } = await import("@/test/db");
const { cookies } = await import("next/headers");
const { SETUP_LINK_COOKIE } = await import("@/lib/setup-links");
type cookieJar = typeof import("@/test/next-headers").cookieJar;
const { people, shops, userAccounts } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

/**
 * Shaped like a minted token (43 base64url characters), so the action judges
 * it as a link and gets as far as the refusal each case is about. Minted in no
 * database: a case that reaches one is refused there.
 */
const SHAPED_TOKEN = "A".repeat(43);

function onboardForm(ownerEmail: string, setupToken = SHAPED_TOKEN): FormData {
  const form = new FormData();
  form.set("setup", setupToken);
  form.set("shopName", "Reef Runners");
  form.set("shopSlug", "reef-runners");
  form.set("timezone", "America/New_York");
  form.set("ownerName", "Marisol Vega");
  form.set("ownerEmail", ownerEmail);
  form.set("ownerPassword", "a-long-enough-password");
  return form;
}

/** The `?error=` code the action bounced back to the form with. */
async function submittedError(ownerEmail: string): Promise<string> {
  try {
    await onboardAction(onboardForm(ownerEmail));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/^REDIRECT:\/onboard\?(.*)$/);
    if (!match) throw error;
    return new URLSearchParams(match[1]).get("error") ?? "";
  }
  throw new Error("expected onboardAction to redirect");
}

beforeEach(() => {
  vi.mocked(getDb).mockReset();
  // The pass-through cases below deliberately reach a db handle that isn't
  // there and bounce with `create_failed`; that is the assertion, and its
  // logged stack is noise.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * **No link, no shop** (ADR 20261009-single-use-setup-links). The page hides
 * the form without an open link, but the action is callable on its own, so it
 * is the action that has to refuse. A value that is not shaped like a token is
 * refused before a database handle is taken, and nothing the caller sent that
 * is not a token's 43 base64url characters is echoed into a `Location:` header.
 */
describe("onboardAction without a setup link", () => {
  async function redirectTarget(form: FormData): Promise<string> {
    try {
      await onboardAction(form);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
      throw error;
    }
    throw new Error("expected onboardAction to redirect");
  }

  it.each([
    ["no link at all", null],
    ["an empty value", ""],
    ["the retired standing key", "diveday-dev-setup-key-not-for-production"],
    ["a token one character short", SHAPED_TOKEN.slice(0, -1)],
    ["a token with a header break in it", `${SHAPED_TOKEN.slice(0, -2)}\r\n`],
  ])("sends %s back to the closed door without touching the database", async (_, key) => {
    const form = onboardForm("owner@no-key.example");
    if (key === null) form.delete("setup");
    else form.set("setup", key);
    expect(await redirectTarget(form)).toBe("/onboard");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("does not echo a value that is not a token when the rate limit bounces the request", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as never);
    const form = onboardForm("owner@no-key.example");
    form.set("setup", "attacker-chosen-value");
    expect(await redirectTarget(form)).toBe("/onboard");
  });

  /**
   * A token in a `Location:` header is a token in every request log, proxy
   * log and history entry the bounce passes through, and an address is
   * personal data in the same places. So the bounce carries neither: the
   * token rides an HttpOnly cookie scoped to `/onboard`, and the page reads it
   * from there (security review of ADR 20261009-single-use-setup-links).
   */
  it("carries a token back on a bounce in a cookie, never in the URL", async () => {
    const target = await redirectTarget(onboardForm("owner@demo.invalid"));
    const params = new URLSearchParams(target.split("?")[1]);
    expect(params.get("error")).toBe("email_reserved");
    expect(target).not.toContain(SHAPED_TOKEN);
    expect(params.has("setup")).toBe(false);
    expect(params.has("ownerEmail")).toBe(false);
    expect(params.get("ownerName")).toBe("Marisol Vega");

    const jar = (await cookies()) as unknown as ReturnType<cookieJar>;
    expect(jar.get(SETUP_LINK_COOKIE)?.value).toBe(SHAPED_TOKEN);
    expect(jar.options[SETUP_LINK_COOKIE]).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: "/onboard",
    });
  });

  it("creates nothing for a well-shaped token that was never minted", async () => {
    const db = await unseededTestDb();
    vi.mocked(getDb).mockResolvedValue(db);
    const target = await redirectTarget(onboardForm("owner@unminted.example"));
    expect(new URLSearchParams(target.split("?")[1]).get("error")).toBe("setup_link_closed");
    expect(await db.select().from(shops)).toEqual([]);
    expect(await db.select().from(userAccounts)).toEqual([]);
  });
});

describe("onboardAction and the reserved demo namespace", () => {
  it.each([
    "owner@demo.invalid",
    "owner@coral-cove-divers-a1b2c3.demo.invalid",
    "Owner@Demo.Invalid",
  ])("refuses %s without touching the database", async (email) => {
    expect(await submittedError(email)).toBe("email_reserved");
    expect(getDb).not.toHaveBeenCalled();
  });

  /**
   * Anchored, so a lookalike registrable domain is an ordinary sign-up. It gets
   * as far as the database — which is the point: this guard must not be a
   * blanket refusal of anything with "demo" in it.
   */
  it.each(["owner@notdemo.invalid", "owner@demo.invalid.example.com"])(
    "lets %s through to the real onboarding path",
    async (email) => {
      // `create_failed` is what reaching the (unstubbed) transaction looks
      // like — proof the guard let this address past, without standing a whole
      // database up for a namespace test.
      expect(await submittedError(email)).toBe("create_failed");
      expect(getDb).toHaveBeenCalled();
    },
  );
});

/**
 * **The first day is never load-bearing.**
 *
 * `createFirstDay` runs after the shop, the owner and the account are already
 * committed, and it writes two rows a shop could add by hand in half a minute:
 * a hull and a departure. So its failure has exactly one sanctioned outcome —
 * the sign-up stands and the owner lands in their shop — and the shape that
 * would break that is easy to write by accident (an unhandled throw between
 * the transaction and the redirect takes the whole action down, and the owner
 * sees a generic refusal for an account that in fact exists).
 *
 * The `try`/`catch` in the action is the mechanism; this is the assertion.
 */
describe("onboardAction when the first departure cannot be written", () => {
  it("keeps the shop, the owner and the account, and still lands them in it", async () => {
    const db = await unseededTestDb();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(createFirstDay).mockRejectedValue(new Error("the boat register said no"));
    hoisted.signInDiveDayCredentials.mockResolvedValue({});
    const request = await recordSetupRequest(db, {
      shopName: "Reef Runners",
      region: "Key Largo",
      runsBoat: true,
      currentSystem: "paper",
      contactName: "Marisol Vega",
      email: "owner@first-day-fails.example",
      phone: null,
      source: "pricing",
      locale: "en-US",
    });
    const { token } = await issueSetupLink(db, { setupRequestId: request.id });

    const form = onboardForm("owner@first-day-fails.example", token);
    form.set("shopSlug", "first-day-fails");
    form.set("boat", "Reef Runner");
    form.set("departure", "07:30");

    // The action's happy path ends in a redirect, which the mock throws.
    await expect(onboardAction(form)).rejects.toThrow("REDIRECT:/shop/first-day-fails");

    // It was reached, and it did fail — otherwise this asserts nothing.
    expect(createFirstDay).toHaveBeenCalled();

    const [shop] = await db.select().from(shops).where(eq(shops.slug, "first-day-fails"));
    expect(shop?.name).toBe("Reef Runners");
    const [owner] = await db
      .select()
      .from(people)
      .where(eq(people.email, "owner@first-day-fails.example"));
    expect(owner?.fullName).toBe("Marisol Vega");
    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, "owner@first-day-fails.example"));
    expect(account?.personId).toBe(owner?.id);
    // And they are signed in, which is the last thing the action does.
    expect(hoisted.signInDiveDayCredentials).toHaveBeenCalled();
  });
});
