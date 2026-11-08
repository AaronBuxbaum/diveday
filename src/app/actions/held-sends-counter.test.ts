import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { people, personRoles } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { SEND_HOLD_MS } from "@/lib/held-sends";
import { fileScopedShopContext } from "@/test/db";
import { heldRows, insertHeldRow } from "@/test/held-sends";

const fileCtx = fileScopedShopContext();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("../../features/session/rules", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../features/step-up/store", () => ({ hasRequiredStepUp: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../features/session/rules");
const { hasRequiredStepUp } = await import("../../features/step-up/store");
const { releaseHeldSendAction, undoHeldSendAction } = await import("./held-sends");

/**
 * **Undo and early release of a counter payment ask no step-up** (#4063).
 * Money coming in is not money going out: the tap asks none, so neither does
 * taking it back inside the hold or recording it sooner.
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
  const row = await insertHeldRow(db, {
    shopId: shop.id,
    payload: {
      kind: "counter_payment",
      orderId: crypto.randomUUID(),
      collection: "cash",
      heldAt: new Date(nowMs()).toISOString(),
    },
    actorPersonId: owner.personId,
    runAt: new Date(nowMs() + SEND_HOLD_MS),
  });
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: shop.id, personId: owner.personId, roles: ["owner"] },
  } as never);
  return { db, row };
}

async function stillHeld(id: string) {
  return heldRows(fileCtx.db, { id: id });
}

describe("a counter payment's Undo and early release", () => {
  it("takes the payment back without a step-up", async () => {
    const { row } = await heldPayment();
    vi.mocked(hasRequiredStepUp).mockResolvedValue(false);
    expect(await undoHeldSendAction(row.id)).toBe(true);
    expect(await stillHeld(row.id)).toHaveLength(0);
    expect(hasRequiredStepUp).not.toHaveBeenCalled();
  });

  it("releases early without one", async () => {
    const { row } = await heldPayment();
    vi.mocked(hasRequiredStepUp).mockResolvedValue(false);
    await releaseHeldSendAction(row.id);
    expect(await stillHeld(row.id)).toHaveLength(0);
  });
});
