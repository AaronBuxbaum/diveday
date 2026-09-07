// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { setShopSearchListing } from "@/db/shops";
import { seededShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { GET } = await import("./route");

function request(slug: string) {
  return new Request(`http://localhost:3000/s/${slug}/availability.json`);
}

async function call(slug: string) {
  // The route reads `params` the way Next hands them over: as a promise.
  return GET(request(slug) as never, { params: Promise.resolve({ shopSlug: slug }) });
}

describe("GET /s/[shopSlug]/availability.json", () => {
  let db: AppDb;
  let shopId: string;

  beforeEach(async () => {
    const ctx = await seededShopContext();
    db = ctx.db;
    shopId = ctx.shop.id;
    vi.mocked(getDb).mockResolvedValue(db);
  });

  it("answers a listed shop with its open seats, cacheable and unindexed", async () => {
    const response = await call("blue-mantis");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const body = await response.json();
    expect(body.schema).toBe("diveday/availability/v1");
    expect(body.shop.slug).toBe("blue-mantis");
    expect(body.departures.length).toBeGreaterThan(0);
    for (const departure of body.departures) {
      expect(departure.seats_open).toBeGreaterThan(0);
      // Absolute, on the configured public origin (`publicAppUrl()`, which is
      // DiveDay's own compiled-in origin here) — never the request's host.
      expect(departure.booking_url).toMatch(
        new RegExp(`^https://[^/]+/s/blue-mantis/trips/${departure.id}$`),
      );
      expect(departure.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
    }
  });

  it("is 404 for a shop that took itself out of search, and back once it relents", async () => {
    await setShopSearchListing(db, shopId, false);
    const hidden = await call("blue-mantis");
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("cache-control")).toBe("no-store");

    await setShopSearchListing(db, shopId, true);
    expect((await call("blue-mantis")).status).toBe(200);
  });

  it("is 404 for a shop that does not exist", async () => {
    expect((await call("no-such-shop")).status).toBe(404);
  });

  it("names no person anywhere in the document", async () => {
    const text = await (await call("blue-mantis")).text();
    // The seeded cast (src/db/seed-cast.ts) is what the fixture's bookings are
    // made of; none of them may reach a document the whole internet can read.
    for (const name of ["Adaeze", "Nwosu", "Marcus", "Keiko", "@"]) {
      expect(text, `document carries "${name}"`).not.toContain(name);
    }
  });
});
