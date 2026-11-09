import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextHeadersStub } from "@/test/next-headers";

const edge = vi.hoisted(() => ({
  after: vi.fn(),
  limit: vi.fn(async () => ({ allowed: true })),
  signInDiveDayMagicLink: vi.fn(async (_input: unknown) => ({
    pending: false,
    shopSlug: "blue-mantis",
  })),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("next/server", () => ({ after: edge.after }));
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ api: edge }) }));
vi.mock("@/lib/request-ip", () => ({ clientIp: async () => "127.0.0.1" }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<object>()),
  checkRateLimit: edge.limit,
}));
const { requestMagicSignIn, redeemMagicSignIn } = await import("./actions");
function form(fields: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields)) result.set(key, value);
  return result;
}
beforeEach(() => {
  edge.after.mockReset();
  edge.limit.mockReset().mockResolvedValue({ allowed: true });
  edge.signInDiveDayMagicLink
    .mockReset()
    .mockResolvedValue({ pending: false, shopSlug: "blue-mantis" });
});
describe("email sign-in actions", () => {
  it.each(["known@example.com", "unknown@example.com", "not-an-email"])(
    "gives %s the same generic response without synchronous delivery",
    async (email) => {
      await expect(requestMagicSignIn(form({ email }))).rejects.toThrow(
        "REDIRECT:/email-sign-in?sent=1",
      );
      // No callback is executed: account lookup, mint and delivery are strictly deferred.
      expect(edge.after).toHaveBeenCalledTimes(email.includes("@") ? 1 : 0);
    },
  );
  it("rate limits both dimensions and schedules no delivery when refused", async () => {
    edge.limit.mockResolvedValue({ allowed: false });
    await expect(requestMagicSignIn(form({ email: "owner@example.com" }))).rejects.toThrow(
      "REDIRECT:/email-sign-in?sent=1",
    );
    expect(edge.limit).toHaveBeenCalledTimes(2);
    expect(edge.after).not.toHaveBeenCalled();
  });
  it("uses only the server-derived shop destination", async () => {
    await expect(
      redeemMagicSignIn(form({ token: "token", callbackUrl: "https://attacker.example" })),
    ).rejects.toThrow("REDIRECT:/shop/blue-mantis");
    expect(edge.signInDiveDayMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: "token" } }),
    );
  });
  it("continues into the existing second-factor screen", async () => {
    edge.signInDiveDayMagicLink.mockResolvedValue({ pending: true, shopSlug: "blue-mantis" });
    await expect(redeemMagicSignIn(form({ token: "token" }))).rejects.toThrow(
      "REDIRECT:/sign-in?error=two-factor",
    );
  });
  it("gives every refused token the same error", async () => {
    edge.signInDiveDayMagicLink.mockRejectedValue(new APIError("UNAUTHORIZED"));
    await expect(redeemMagicSignIn(form({ token: "token" }))).rejects.toThrow(
      "REDIRECT:/email-sign-in?error=1",
    );
  });
});
