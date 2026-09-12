import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one part of this fixture's body that carries a reason rather than a
 * default: `createdAtOffsetSeconds`.
 *
 * The settings panel lists display links newest first and breaks a tie on `id`,
 * which is a fresh uuid on every run. Under `TEST_FROZEN_CLOCK` two links
 * minted in the same test share `created_at` to the millisecond, so the tie is
 * the only thing deciding the order — and the lobby-display capture flipped its
 * two rows at random, reporting itself changed on pull requests that touched
 * nothing near it (first caught on #1744, whose whole diff was `scripts/`).
 *
 * The offset settles that order. Its ceiling is the load-bearing half: every
 * stamp rendered on that page is minute-resolution, so a shift kept under a
 * minute moves the rows without moving a single pixel of text. An offset that
 * could reach a minute would start rewriting the times in the picture, which is
 * why sixty is refused rather than clamped.
 *
 * The auth gate in front of all of this is covered once for every seed route in
 * `../seed-routes.test.ts`; these cases all arrive past it.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/shops", () => ({ getShopBySlug: vi.fn() }));

const { getDb } = await import("@/db/client");
const { getShopBySlug } = await import("@/db/shops");
const { POST } = await import("./route");

const secret = "e2e-test-secret";

function seedRequest(body: unknown) {
  return new Request("http://localhost/api/test/seed-display-token", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockReset();
  vi.mocked(getShopBySlug)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/test/seed-display-token — createdAtOffsetSeconds", () => {
  async function expectInvalidBody(body: unknown) {
    const response = await POST(seedRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    // Refused while reading the body, before the route opens a database.
    expect(getDb).not.toHaveBeenCalled();
  }

  it("accepts an offset inside the frozen minute", async () => {
    await POST(seedRequest({ label: "Counter tablet", createdAtOffsetSeconds: 30 }));
    expect(getDb).toHaveBeenCalled();
  });

  it("accepts a body with no offset at all, which is the common fixture", async () => {
    await POST(seedRequest({ label: "Lobby TV" }));
    expect(getDb).toHaveBeenCalled();
  });

  it("refuses a full minute, which would start moving the rendered times", async () => {
    await expectInvalidBody({ createdAtOffsetSeconds: 60 });
  });

  it("refuses a fractional offset", async () => {
    await expectInvalidBody({ createdAtOffsetSeconds: 1.5 });
  });

  it("refuses a negative offset, which would age a row out of the frozen minute", async () => {
    await expectInvalidBody({ createdAtOffsetSeconds: -1 });
  });
});
