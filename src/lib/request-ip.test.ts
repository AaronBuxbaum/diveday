import { describe, expect, it } from "vitest";
import { clientIp, type HeaderGetter } from "./request-ip";

function headersOf(values: Record<string, string>): HeaderGetter {
  return { get: (name) => values[name] ?? null };
}

describe("clientIp (CR-013)", () => {
  it("uses the first x-forwarded-for entry, trusting Vercel's edge as the sole proxy hop", async () => {
    const ip = await clientIp(headersOf({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }));
    expect(ip).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const ip = await clientIp(headersOf({ "x-real-ip": "203.0.113.9" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("returns null when neither header is present, rather than throwing", async () => {
    const ip = await clientIp(headersOf({}));
    expect(ip).toBeNull();
  });
});
