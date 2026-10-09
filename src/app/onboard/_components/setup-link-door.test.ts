import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { recordSetupRequest } = await import("@/db/funnel");
const { issueSetupLink, spendSetupLink } = await import("@/db/setup-links");
const { unseededTestDb } = await import("@/test/db");
const { setupLinkDoor } = await import("./setup-link-door");

afterEach(() => vi.mocked(getDb).mockReset());

async function mintedLink() {
  const db = await unseededTestDb();
  vi.mocked(getDb).mockResolvedValue(db);
  const request = await recordSetupRequest(db, {
    shopName: "Reef Line Divers",
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "paper",
    contactName: "Ana Ruiz",
    email: "ana@reefline.example",
    phone: null,
    source: "pricing",
    locale: "en-US",
  });
  const { token } = await issueSetupLink(db, { setupRequestId: request.id });
  return { db, token };
}

/** The three doors of `/onboard` (ADR 20261009-single-use-setup-links). */
describe("setupLinkDoor", () => {
  it("is the plain closed door with no link, without touching the database", async () => {
    expect(await setupLinkDoor(undefined)).toEqual({ door: "none" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("opens the form with the request's answers for a live link", async () => {
    const { token } = await mintedLink();
    expect(await setupLinkDoor(token)).toEqual({
      door: "open",
      token,
      link: {
        shopName: "Reef Line Divers",
        contactName: "Ana Ruiz",
        email: "ana@reefline.example",
      },
    });
  });

  it("gives one answer for a spent, unknown, mistyped or repeated link", async () => {
    const { db, token } = await mintedLink();
    for (const candidate of ["A".repeat(43), "not-a-token", "", [token, token]]) {
      expect(await setupLinkDoor(candidate)).toEqual({ door: "spent" });
    }
    await spendSetupLink(db, token);
    expect(await setupLinkDoor(token)).toEqual({ door: "spent" });
  });
});
