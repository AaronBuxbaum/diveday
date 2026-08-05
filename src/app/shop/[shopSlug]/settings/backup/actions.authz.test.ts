import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getShopBackupDestination } from "@/features/backup-export";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The backup destination receives the whole shop every week — waiver evidence
 * and medical answers included — so all three actions hold the export
 * download's owner/manager bar, re-checked against the live database rather
 * than the JWT. The page hides the surface from a captain, but hiding is not
 * a gate: these run the real actions against a real seeded database with only
 * the session and Next's navigation primitives faked, and check the stored
 * row after the refusal rather than the notice alone.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { saveBackupDestinationAction, testBackupAction, disconnectBackupAction } = await import(
  "./actions"
);

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

const SECRET = "captain-smuggled-secret";

function destinationForm() {
  const form = new FormData();
  form.set("endpoint", "https://exfil.example.com");
  form.set("region", "auto");
  form.set("bucket", "captains-own-bucket");
  form.set("prefix", "");
  form.set("accessKeyId", "AKIA-CAPTAIN");
  form.set("secretAccessKey", SECRET);
  return form;
}

describe("backup settings authorization", () => {
  beforeEach(() => {
    // The save path seals the secret before storing it, which needs a key in
    // the environment exactly as production would have one.
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  it("a captain cannot repoint the destination — the seeded row survives untouched", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => saveBackupDestinationAction(destinationForm()));
    expect(to).toBe(`/shop/${shop.slug}?notice=backup_not_authorized`);

    const row = await getShopBackupDestination(db, shop.id);
    expect(row?.bucket).not.toBe("captains-own-bucket");
    expect(row?.endpoint).not.toBe("https://exfil.example.com");
  });

  it("a captain cannot trigger a delivery or disconnect", async () => {
    const { shop, captain } = await context();
    signIn(shop, captain);

    await expect(redirectedTo(() => testBackupAction())).resolves.toBe(
      `/shop/${shop.slug}?notice=backup_not_authorized`,
    );
    await expect(redirectedTo(() => disconnectBackupAction())).resolves.toBe(
      `/shop/${shop.slug}?notice=backup_not_authorized`,
    );
  });

  it("an owner saves, and the redirect carries a code — never the secret", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => saveBackupDestinationAction(destinationForm()));
    expect(to).toBe(`/shop/${shop.slug}/settings/backup?notice=saved`);
    expect(to).not.toContain(SECRET);

    const row = await getShopBackupDestination(db, shop.id);
    expect(row?.bucket).toBe("captains-own-bucket");
    // Sealed on the way in — the plaintext never reaches the column either.
    expect(row?.secretAccessKeySealed).not.toContain(SECRET);
  });

  it("refuses a private-host destination with a code, even from an owner", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = (await getShopBackupDestination(db, shop.id))?.endpoint;

    const form = destinationForm();
    form.set("endpoint", "https://169.254.169.254");
    const to = await redirectedTo(() => saveBackupDestinationAction(form));
    expect(to).toBe(`/shop/${shop.slug}/settings/backup?notice=endpoint_private_host`);
    expect((await getShopBackupDestination(db, shop.id))?.endpoint).toBe(before);
  });
});
