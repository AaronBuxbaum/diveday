import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/features/messages/unsubscribe", () => ({ unsubscribeByToken: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const { checkRateLimit } = await import("@/lib/rate-limit");
const { unsubscribeByToken } = await import("@/features/messages/unsubscribe");
const { confirmUnsubscribe } = await import("./actions");

async function landing(): Promise<string> {
  try {
    await confirmUnsubscribe("tok");
  } catch (error) {
    return (error as Error).message.replace("REDIRECT:", "");
  }
  throw new Error("returned without redirecting");
}

describe("confirmUnsubscribe", () => {
  it("says why when the tap is rate limited, and stops nothing", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    expect(await landing()).toBe("/unsubscribe/tok?error=rate");
    expect(unsubscribeByToken).not.toHaveBeenCalled();
  });

  it("returns to the bare page after a real unsubscribe", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
    expect(await landing()).toBe("/unsubscribe/tok");
    expect(unsubscribeByToken).toHaveBeenCalledOnce();
  });
});
