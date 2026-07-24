import { describe, expect, it } from "vitest";
import { clientIp, type HeaderGetter } from "./request-ip";

function headersOf(values: Record<string, string>): HeaderGetter {
  return { get: (name) => values[name] ?? null };
}

describe("clientIp (CR-013)", () => {
  it("prefers x-vercel-forwarded-for, which stays trustworthy even under a future proxy in front of Vercel", async () => {
    const ip = await clientIp(
      headersOf({
        "x-vercel-forwarded-for": "203.0.113.1",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1",
      }),
    );
    expect(ip).toBe("203.0.113.1");
  });

  it("uses the first x-forwarded-for entry when x-vercel-forwarded-for is absent — Vercel overwrites this header rather than appending to a client-supplied value", async () => {
    const ip = await clientIp(headersOf({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }));
    expect(ip).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when the other two are absent", async () => {
    const ip = await clientIp(headersOf({ "x-real-ip": "203.0.113.9" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("returns null when none of the headers are present, rather than throwing", async () => {
    const ip = await clientIp(headersOf({}));
    expect(ip).toBeNull();
  });
});
