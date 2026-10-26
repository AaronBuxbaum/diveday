import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { heldSends, people, personRoles } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { SEND_HOLD_MS } from "@/lib/held-sends";
import { fileScopedShopContext } from "@/test/db";

const fileCtx = fileScopedShopContext();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/security-step-up", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security-step-up")>();
  return { ...actual, hasRequiredStepUp: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { hasRequiredStepUp } = await import("@/lib/security-step-up");
const { releaseHeldSendAction, undoHeldSendAction } = await import("./held-sends");

/**
 * **Undo and early release of a counter payment ask the money step-up**
 * (review of #3061, security note 1). The tap asked it; a second staffer who
 * opens the order inside the hold must not take the payment back, or record
 * it sooner, without it.
 */
async function heldPayment() {
  const { db, shop } = fileCtx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [owner] = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!owner) throw new Error("fixture needs staff");
  const [row] = await db
    .insert(heldSends)
    .values({
      shopId: shop.id,
      kind: "counter_payment",
      payload: {
        kind: "counter_payment",
        orderId: crypto.randomUUID(),
        collection: "cash",
        heldAt: new Date(nowMs()).toISOString(),
      },
      actorPersonId: owner.personId,
      runAt: new Date(nowMs() + SEND_HOLD_MS),
    })
    .returning();
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: shop.id, personId: owner.personId, roles: ["owner"] },
  } as never);
  return { db, row };
}

async function stillHeld(id: string) {
  return fileCtx.db.select().from(heldSends).where(eq(heldSends.id, id));
}

describe("a counter payment's Undo and early release", () => {
  it("refuses Undo without the money step-up, and leaves the hold", async () => {
    const { row } = await heldPayment();
    vi.mocked(hasRequiredStepUp).mockResolvedValue(false);
    await expect(undoHeldSendAction(row.id)).rejects.toThrow("not_authorized");
    expect(await stillHeld(row.id)).toHaveLength(1);
    expect(hasRequiredStepUp).toHaveBeenCalledWith(expect.anything(), expect.anything(), "money");
  });

  it("refuses an early release without it", async () => {
    const { row } = await heldPayment();
    vi.mocked(hasRequiredStepUp).mockResolvedValue(false);
    await expect(releaseHeldSendAction(row.id)).rejects.toThrow("not_authorized");
    expect(await stillHeld(row.id)).toHaveLength(1);
  });

  it("takes the payment back with it", async () => {
    const { row } = await heldPayment();
    vi.mocked(hasRequiredStepUp).mockResolvedValue(true);
    expect(await undoHeldSendAction(row.id)).toBe(true);
    expect(await stillHeld(row.id)).toHaveLength(0);
  });
});
