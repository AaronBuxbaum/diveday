import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { recordProcessorErasureObligations } from "@/db/processor-erasure";
import { people, processorErasureObligations, userAccounts } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import {
  demoteOwnerToManager,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The two processor-erasure actions are owner-only (`canPersonErasePersonalData`),
 * stricter than the owner-or-manager settings gate the panel is read behind. A
 * refusal is silent by design (data-actions.ts), so each case asserts the row,
 * not a notice: an owed obligation that is still owed, with no attempt made.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
// Never reach Stripe: a refused retry must not call it, and an allowed one is
// not what this file proves.
vi.mock("@/db/processor-erasure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/processor-erasure")>();
  return { ...actual, retryProcessorErasure: vi.fn(actual.retryProcessorErasure) };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { retryProcessorErasure } = await import("@/db/processor-erasure");
const { dischargeProcessorErasureAction, retryProcessorErasureAction } = await import(
  "./data-actions"
);

const ctx = fileScopedShopContext();

/** The erased person the obligation names; only the foreign key matters here. */
async function anyPersonId(db: AppDb, shopId: string): Promise<string> {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), isNull(people.deletedAt)))
    .limit(1);
  if (!person) throw new Error("seeded shop has no people");
  return person.id;
}

async function owedObligation(db: AppDb, shopId: string): Promise<string> {
  const [row] = await recordProcessorErasureObligations(db, {
    shopId,
    personId: await anyPersonId(db, shopId),
    targets: [
      { target: "stripe_invoice_snapshot", externalId: "in_test_1", stripeAccountId: "acct_1" },
    ],
  });
  if (!row) throw new Error("obligation not raised");
  return row.id;
}

async function obligation(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(processorErasureObligations)
    .where(eq(processorErasureObligations.id, id));
  if (!row) throw new Error("obligation vanished");
  return row;
}

function signIn(personId: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(requireStaffSession).mockResolvedValue(
    // An inflated role list: the gate must re-read the database, not the JWT.
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["owner"] }),
  );
}

function form(obligationId: string): FormData {
  const data = new FormData();
  data.set("obligationId", obligationId);
  return data;
}

describe("discharging a processor-erasure obligation", () => {
  it("refuses a manager who is not the owner, and the obligation stays owed", async () => {
    const { db, shop } = ctx;
    const id = await owedObligation(db, shop.id);
    const dana = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await demoteOwnerToManager(db, dana);
    signIn(dana);

    await dischargeProcessorErasureAction(form(id));

    expect(await obligation(db, id)).toMatchObject({
      status: "owed",
      dischargedAt: null,
      dischargedByPersonId: null,
    });
  });

  it("refuses a captain", async () => {
    const { db, shop } = ctx;
    const id = await owedObligation(db, shop.id);
    signIn(await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL));

    await dischargeProcessorErasureAction(form(id));

    expect((await obligation(db, id)).status).toBe("owed");
  });

  it("refuses an owner whose account is disabled", async () => {
    const { db, shop } = ctx;
    const id = await owedObligation(db, shop.id);
    const dana = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, dana));
    signIn(dana);

    await dischargeProcessorErasureAction(form(id));

    expect((await obligation(db, id)).status).toBe("owed");
  });

  it("lets a live owner attest it, under their own name", async () => {
    const { db, shop } = ctx;
    const id = await owedObligation(db, shop.id);
    const dana = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    signIn(dana);

    await dischargeProcessorErasureAction(form(id));

    const after = await obligation(db, id);
    expect(after.status).toBe("discharged");
    expect(after.dischargedByPersonId).toBe(dana);
  });
});

describe("retrying a processor-erasure obligation", () => {
  it("refuses a manager before any call to the processor", async () => {
    const { db, shop } = ctx;
    const id = await owedObligation(db, shop.id);
    const dana = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await demoteOwnerToManager(db, dana);
    signIn(dana);
    vi.mocked(retryProcessorErasure).mockClear();

    await retryProcessorErasureAction(form(id));

    expect(retryProcessorErasure).not.toHaveBeenCalled();
    expect(await obligation(db, id)).toMatchObject({ status: "owed", attempts: 0 });
  });

  it("refuses a disabled owner before any call to the processor", async () => {
    const { db, shop } = ctx;
    const id = await owedObligation(db, shop.id);
    const dana = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, dana));
    signIn(dana);
    vi.mocked(retryProcessorErasure).mockClear();

    await retryProcessorErasureAction(form(id));

    expect(retryProcessorErasure).not.toHaveBeenCalled();
  });
});

describe("an obligation id that is not one", () => {
  // Security review F4: a hand-made post with a non-UUID reached Postgres as a
  // uuid comparison and came back a 500. It is refused before any query now.
  it("is refused quietly by both actions, before the database sees it", async () => {
    const { db, shop } = ctx;
    const id = await owedObligation(db, shop.id);
    signIn(await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL));

    await expect(dischargeProcessorErasureAction(form("not-a-uuid"))).resolves.toBeUndefined();
    await expect(retryProcessorErasureAction(form("'; select 1 --"))).resolves.toBeUndefined();

    expect((await obligation(db, id)).status).toBe("owed");
    expect(retryProcessorErasure).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "'; select 1 --",
    );
  });
});
