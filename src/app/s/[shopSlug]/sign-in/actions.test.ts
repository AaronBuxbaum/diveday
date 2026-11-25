import { beforeEach, describe, expect, it, vi } from "vitest";

const edge = vi.hoisted(() => ({
  after: vi.fn(),
  limit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/server", () => ({ after: edge.after }));
vi.mock("@/lib/request-ip", () => ({ clientIp: async () => "127.0.0.1" }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<object>()),
  checkRateLimit: edge.limit,
}));
const { requestDiverSignIn } = await import("./actions");

function form(email: string) {
  const data = new FormData();
  data.set("email", email);
  return data;
}

beforeEach(() => {
  edge.after.mockReset();
  edge.limit.mockReset().mockResolvedValue({ allowed: true });
});

/** ADR 20261125-diver-sign-in: one answer, whoever asks; the lookup and the send are deferred. */
describe("asking for a diver sign-in link", () => {
  it.each(["known@example.com", "unknown@example.com", "not-an-email"])(
    "answers %s with the same page",
    async (email) => {
      await expect(requestDiverSignIn("blue-mantis", form(email))).rejects.toThrow(
        "REDIRECT:/s/blue-mantis/sign-in?sent=1",
      );
      expect(edge.after).toHaveBeenCalledTimes(email.includes("@") ? 1 : 0);
    },
  );

  it("answers a rate-limited ask the same way and sends nothing", async () => {
    edge.limit.mockResolvedValue({ allowed: false });
    await expect(requestDiverSignIn("blue-mantis", form("ana@example.com"))).rejects.toThrow(
      "REDIRECT:/s/blue-mantis/sign-in?sent=1",
    );
    expect(edge.limit).toHaveBeenCalledTimes(2);
    expect(edge.after).not.toHaveBeenCalled();
  });
});
