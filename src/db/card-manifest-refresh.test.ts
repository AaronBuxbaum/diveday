import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { restoreCard } from "./card-restore";
import { cards, people } from "./schema";

const ctx = fileScopedShopContext();

/**
 * **A card's Delete and its Undo tell the open manifests** (issue #3839). Either
 * changes readiness on every departure the diver is on, and a roll call cached
 * on a crew device must not keep showing a deleted card as a cleared diver, or
 * keep blocking one that is back. Mocked at the seam, as the other writers'
 * announcements are (`manifest-publishers.test.ts`).
 */
vi.mock("./manifest-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manifest-events")>();
  return { ...actual, publishManifestEventsForPerson: vi.fn(async () => {}) };
});

const { publishManifestEventsForPerson } = await import("./manifest-events");
const { deleteCertification, deleteSpecialtyCertification } = await import("./readiness");
const { deleteNitroxCertification } = await import("./nitrox");

beforeEach(() => {
  vi.mocked(publishManifestEventsForPerson).mockClear();
});

async function diverWithCard(kind: "level" | "specialty" | "nitrox") {
  const { db, shop } = ctx;
  const [diver] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: `Refresh ${kind}`, email: `refresh-${kind}@example.com` })
    .returning();
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!diver || !staff) throw new Error("fixture failed");
  const [card] = await db
    .insert(cards)
    .values({
      kind,
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      ...(kind === "level" ? { level: "open_water" as const } : {}),
      ...(kind === "specialty" ? { specialty: "deep" as const } : {}),
      identifier: `REFRESH-${kind}`,
      status: "verified",
    })
    .returning({ id: cards.id });
  if (!card) throw new Error("card failed");
  return { db, shop, diver, staffId: staff.id, cardId: card.id };
}

describe("card writes announce a manifest change", () => {
  it.each([
    ["level", deleteCertification],
    ["specialty", deleteSpecialtyCertification],
    ["nitrox", deleteNitroxCertification],
  ] as const)(
    "announces a deleted %s card, and again when it is restored",
    async (kind, remove) => {
      const { db, shop, diver, staffId, cardId } = await diverWithCard(kind);

      expect(
        await remove(db, { shopId: shop.id, certificationId: cardId, deletedByPersonId: staffId }),
      ).toBe(true);
      expect(publishManifestEventsForPerson).toHaveBeenCalledWith(db, shop.id, diver.id);

      vi.mocked(publishManifestEventsForPerson).mockClear();
      expect(
        await restoreCard(db, {
          shopId: shop.id,
          kind,
          certificationId: cardId,
          restoredByPersonId: staffId,
        }),
      ).toBe("restored");
      expect(publishManifestEventsForPerson).toHaveBeenCalledWith(db, shop.id, diver.id);
      const [back] = await db
        .select({ deletedAt: cards.deletedAt })
        .from(cards)
        .where(and(eq(cards.id, cardId), eq(cards.shopId, shop.id)));
      expect(back?.deletedAt).toBeNull();
    },
  );

  it("announces nothing for a delete that matched no card", async () => {
    const { db, shop, staffId } = await diverWithCard("level");
    expect(
      await deleteCertification(db, {
        shopId: shop.id,
        certificationId: "11111111-1111-4111-8111-111111111111",
        deletedByPersonId: staffId,
      }),
    ).toBe(false);
    expect(publishManifestEventsForPerson).not.toHaveBeenCalled();
  });
});
