import { describe, expect, it } from "vitest";

describe("next.config redirects", () => {
  it("sends the retired walk-in page to the departure door in walk-in mode", async () => {
    const mod = await import("../next.config");
    const config = mod.default("phase-production-build") as {
      redirects?: () => Promise<unknown[]>;
    };
    const rules = (await config.redirects?.()) as {
      source: string;
      destination: string;
      permanent: boolean;
    }[];
    const rule = rules.find((r) => r.source === "/shop/:shopSlug/trips/:id/walk-in");
    expect(rule).toEqual({
      source: "/shop/:shopSlug/trips/:id/walk-in",
      destination: "/shop/:shopSlug/divers/new?surface=departure&tripId=:id&walkIn=true",
      permanent: true,
    });
  });
});
