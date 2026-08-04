import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// next-auth's own module graph reaches for `next/server` in a way that does
// not resolve under Vitest's node environment (see src/proxy.test.ts, which
// stubs it the same way). Neither the sign-in nor the error class matters to
// this file — the refusal lands long before either.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/auth", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true })) };
});

const { getDb } = await import("@/db/client");
const { onboardAction } = await import("./actions");

function onboardForm(ownerEmail: string): FormData {
  const form = new FormData();
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
