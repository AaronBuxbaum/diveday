import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextHeadersStub } from "@/test/next-headers";

/**
 * The sign-in form's one action. The credentials check, the rate limit and the
 * second factor all live behind `signInDiveDayCredentials` (src/lib/auth.ts);
 * what this file owns is the answer: every refusal is the same `?error=1`
 * except the two second-factor ones, and success lands on the staffer's own shop.
 */

const hoisted = vi.hoisted(() => ({
  completeDiveDaySignIn: vi.fn(async (_input: unknown) => ({
    status: "signed_in",
    shopSlug: "blue-mantis",
  })),
  cancelDiveDaySignIn: vi.fn(async (_input: unknown) => ({ cancelled: true })),
  signInDiveDayCredentials: vi.fn(async (_input: unknown) => ({
    pending: false,
    shopSlug: "blue-mantis" as string | null,
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({
    api: hoisted,
  })),
}));

const { authenticate, confirmSignIn, cancelSignIn } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function landing(data: FormData): Promise<string> {
  try {
    await authenticate(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("expected authenticate to redirect");
}

beforeEach(() => {
  hoisted.completeDiveDaySignIn
    .mockReset()
    .mockResolvedValue({ status: "signed_in", shopSlug: "blue-mantis" });
  hoisted.cancelDiveDaySignIn.mockClear();
  hoisted.signInDiveDayCredentials
    .mockReset()
    .mockResolvedValue({ pending: false, shopSlug: "blue-mantis" });
});

describe("authenticate", () => {
  it("signs in with the typed credentials and lands on the staffer's own shop", async () => {
    expect(
      await landing(form({ email: "owner@example.com", password: "pw", totpCode: " 123456 " })),
    ).toBe("/shop/blue-mantis");
    expect(hoisted.signInDiveDayCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: "owner@example.com", password: "pw" },
      }),
    );
  });

  it("falls back to /shop when the session names no shop", async () => {
    hoisted.signInDiveDayCredentials.mockResolvedValueOnce({ pending: false, shopSlug: null });
    expect(await landing(form({ email: "owner@example.com", password: "pw" }))).toBe("/shop");
  });

  it("returns the staffer to the page the edge bounced them from, inside their shop", async () => {
    expect(
      await landing(
        form({
          email: "owner@example.com",
          password: "pw",
          callbackUrl: "/shop/blue-mantis/trips/abc",
        }),
      ),
    ).toBe("/shop/blue-mantis/trips/abc");
  });

  it("keeps the target through the code step", async () => {
    hoisted.signInDiveDayCredentials.mockResolvedValueOnce({ pending: true, shopSlug: null });
    expect(
      await landing(
        form({ email: "o@example.com", password: "pw", callbackUrl: "/shop/blue-mantis/trips" }),
      ),
    ).toBe("/sign-in?error=two-factor&callbackUrl=%2Fshop%2Fblue-mantis%2Ftrips");
    await expect(
      confirmSignIn(form({ totpCode: "123456", callbackUrl: "/shop/blue-mantis/trips" })),
    ).rejects.toThrow("REDIRECT:/shop/blue-mantis/trips");
  });

  it("honors no foreign target: another origin, another shop or traversal land on the shop home", async () => {
    for (const callbackUrl of [
      "https://evil.example/phish",
      "/shop/other-shop/trips",
      "/shop/blue-mantis/../../evil",
    ])
      expect(await landing(form({ email: "o@example.com", password: "pw", callbackUrl }))).toBe(
        "/shop/blue-mantis",
      );
  });

  it("honors no request-supplied target: a callbackUrl field changes nothing", async () => {
    expect(
      await landing(
        form({
          email: "owner@example.com",
          password: "pw",
          callbackUrl: "https://evil.example/phish",
          redirect: "/shop/other-shop",
        }),
      ),
    ).toBe("/shop/blue-mantis");
  });

  it("never sends a second factor with a password", async () => {
    await landing(form({ email: "owner@example.com", password: "pw", totpCode: "  " }));
    expect(hoisted.signInDiveDayCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: "owner@example.com", password: "pw" },
      }),
    );
  });

  it("answers a wrong password with the one generic error", async () => {
    hoisted.signInDiveDayCredentials.mockRejectedValueOnce(new APIError("UNAUTHORIZED"));
    expect(await landing(form({ email: "owner@example.com", password: "nope" }))).toBe(
      "/sign-in?error=1",
    );
  });

  it("keeps the page a staffer was bounced from through a mistyped password", async () => {
    hoisted.signInDiveDayCredentials.mockRejectedValueOnce(new APIError("UNAUTHORIZED"));
    expect(
      await landing(
        form({
          email: "owner@example.com",
          password: "nope",
          callbackUrl: "/shop/blue-mantis/trips/abc",
        }),
      ),
    ).toBe("/sign-in?error=1&callbackUrl=%2Fshop%2Fblue-mantis%2Ftrips%2Fabc");
  });

  it("sends pending credentials to the code step without a dashboard redirect", async () => {
    hoisted.signInDiveDayCredentials.mockResolvedValueOnce({ pending: true, shopSlug: null });
    expect(await landing(form({ email: "owner@example.com", password: "pw" }))).toBe(
      "/sign-in?error=two-factor",
    );
  });

  it.each([
    ["invalid_code", "invalid-code"],
    ["restart", "restart"],
    ["rate_limited", "rate-limit"],
  ])("routes the code result %s beside the correct form", async (status, error) => {
    hoisted.completeDiveDaySignIn.mockResolvedValueOnce({ status, shopSlug: "" });
    await expect(
      confirmSignIn(
        form({ totpCode: "123456", email: "forged@example.com", password: "never-forward" }),
      ),
    ).rejects.toThrow(`REDIRECT:/sign-in?error=${error}`);
    expect(hoisted.completeDiveDaySignIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: { totpCode: "123456" } }),
    );
  });

  it("Back cancels the pending sign-in before redirecting", async () => {
    await expect(cancelSignIn()).rejects.toThrow("REDIRECT:/sign-in");
    expect(hoisted.cancelDiveDaySignIn).toHaveBeenCalled();
  });

  it("refuses a form that is not three strings the same way, without trying", async () => {
    const data = new FormData();
    data.set("email", new File(["x"], "x.txt"));
    expect(await landing(data)).toBe("/sign-in?error=1");
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("lets an error that is not a refusal through", async () => {
    hoisted.signInDiveDayCredentials.mockRejectedValueOnce(new Error("database down"));
    await expect(authenticate(form({ email: "a@b.c", password: "pw" }))).rejects.toThrow(
      "database down",
    );
  });
});
