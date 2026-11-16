// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.8") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { askAnytimeAction } = await import("./actions");
const { getDb } = await import("@/db/client");

beforeEach(() => {
  vi.mocked(getDb).mockResolvedValue(ctx.db);
});

function joinForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("fullName", "Nora Quinn");
  form.set("email", "nora@example.com");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("askAnytimeAction dates", () => {
  it("joins with a real window", async () => {
    const state = await askAnytimeAction(
      ctx.shop.slug,
      {},
      joinForm({ availableFrom: "2026-12-01", availableUntil: "2026-12-20" }),
    );
    expect(state.error).toBeUndefined();
    expect(state.success).toBe(true);
  });

  it("asks again, rather than failing, when a date is not a date", async () => {
    // A browser without a date picker hands back whatever was typed.
    const state = await askAnytimeAction(
      ctx.shop.slug,
      {},
      joinForm({ availableFrom: "2026-12-01", availableUntil: "soon" }),
    );
    expect(state.success).toBeUndefined();
    expect(state.error).toBeTruthy();
  });
});
