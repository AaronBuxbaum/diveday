import { describe, expect, it, vi } from "vitest";
import { passwordConfirmErrorText } from "@/components/account/passwordConfirmError";
import { diverTranslator } from "@/i18n/messages";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/user-accounts", () => ({ claimStaffInvite: vi.fn(), getAccountContact: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuth: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: false, retryAfterMs: 1000 })) };
});

const { claimStaffInvite } = await import("@/db/user-accounts");
const { acceptStaffInvite } = await import("./actions");

describe("acceptStaffInvite when rate limited", () => {
  it("redirects with ?error=rate, claims nothing, and the page words it", async () => {
    const form = new FormData();
    form.set("password", "correct horse battery");
    form.set("confirmPassword", "correct horse battery");
    const landed = await acceptStaffInvite("tok", form).catch((error: Error) => error.message);
    expect(landed).toBe("REDIRECT:/invite/tok?error=rate");
    expect(claimStaffInvite).not.toHaveBeenCalled();
    for (const locale of ["en-US", "es-ES"]) {
      const t = diverTranslator(locale);
      expect(passwordConfirmErrorText(t, "rate")).toBe(t("common.rateLimited"));
    }
  });
});
