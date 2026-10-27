import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { anonymizeDiver } from "./anonymize";
import { loadShopExportBundleInput } from "./export";
import { people, personRoles, shops, staffCredentialHistory, staffCredentials } from "./schema";
import {
  changeStaffCredential,
  createStaffCredential,
  deleteStaffCredential,
  listStaffCredentials,
} from "./staff-credentials";

const ctx = fileScopedShopContext();
const OTHER_SHOP = "00000000-0000-0000-0000-000000000000";

async function fixture() {
  const { db, shop } = ctx;
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Credential holder" })
    .returning();
  if (!person) throw new Error("person missing");
  await db.insert(personRoles).values({ personId: person.id, role: "captain" });
  const card = await createStaffCredential(db, {
    shopId: shop.id,
    personId: person.id,
    kind: "captains_licence",
    name: "Licence",
    identifier: "HISTORY-TEST",
    issuedAt: "2024-01-01",
    renewsAt: "2026-01-01",
  });
  if (!card) throw new Error("card missing");
  return { db, shop, person, card };
}

describe("staff credential versions", () => {
  it("retains evidence through renewal, correction and deletion while listing only the current card", async () => {
    const { db, shop, person, card } = await fixture();
    const input = {
      shopId: shop.id,
      personId: person.id,
      credentialId: card.id,
      expectedRevision: card.revision,
      kind: card.kind,
      name: card.name,
      issuingBody: card.issuingBody,
      identifier: card.identifier,
      issuedAt: "2026-01-02",
      renewsAt: "2028-01-02",
      change: "renewed" as const,
    };
    expect(await changeStaffCredential(db, { ...input, shopId: OTHER_SHOP })).toBeNull();
    const renewed = await changeStaffCredential(db, input);
    expect(renewed?.renewsAt).toBe("2028-01-02");
    if (!renewed) throw new Error("renewal missing");
    expect(await changeStaffCredential(db, input)).toBeNull();
    const listed = (await listStaffCredentials(db, shop.id)).filter(
      (row) => row.person.id === person.id,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.credential.renewsAt).toBe("2028-01-02");
    const corrected = await changeStaffCredential(db, {
      ...input,
      expectedRevision: renewed.revision,
      issuedAt: "2020-01-01",
      change: "corrected",
    });
    expect(corrected?.issuedAt).toBe("2020-01-01");
    if (!corrected) throw new Error("correction missing");
    expect(await deleteStaffCredential(db, shop.id, card.id, person.id, corrected.revision)).toBe(
      true,
    );
    const events = await db
      .select()
      .from(staffCredentialHistory)
      .where(eq(staffCredentialHistory.credentialId, card.id));
    expect(events.map((event) => event.event)).toEqual([
      "created",
      "renewed",
      "corrected",
      "deleted",
    ]);
    expect(events[0]?.renewsAt).toBe("2026-01-01");
  });
  it("erases the history even if the credential was deleted before staff offboarding", async () => {
    const { db, shop, person, card } = await fixture();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    expect(await deleteStaffCredential(db, shop.id, card.id, owner)).toBe(true);
    await db.delete(personRoles).where(eq(personRoles.personId, person.id));
    await db.insert(personRoles).values({ personId: person.id, role: "diver" });
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: person.id, actorPersonId: owner }),
    ).toMatchObject({ ok: true });
    expect(
      await db
        .select()
        .from(staffCredentialHistory)
        .where(eq(staffCredentialHistory.credentialId, card.id)),
    ).toHaveLength(0);
    const [retired] = await db
      .select()
      .from(staffCredentials)
      .where(and(eq(staffCredentials.shopId, shop.id), eq(staffCredentials.id, card.id)));
    expect(retired?.identifier).toBeNull();
    expect(retired?.issuedAt).toBeNull();
    expect(retired?.renewsAt).toBeNull();
  });
  it("exports this shop's versions without another shop's credential history", async () => {
    const { db, shop, card } = await fixture();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival", slug: "rival-history", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival missing");
    const [other] = await db
      .insert(people)
      .values({ shopId: rival.id, fullName: "Other crew" })
      .returning();
    if (!other) throw new Error("rival staff missing");
    await db.insert(personRoles).values({ personId: other.id, role: "captain" });
    const otherCard = await createStaffCredential(db, {
      shopId: rival.id,
      personId: other.id,
      kind: "captains_licence",
      name: "Other card",
      identifier: "OTHER-CARD",
    });
    if (!otherCard) throw new Error("rival card missing");
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const history = bundle?.tables.find((table) => table.file === "staff_credential_history.csv");
    if (!history) throw new Error("history file missing");
    const column = history.header.indexOf("credential_id");
    expect(history.rows.some((row) => row[column] === card.id)).toBe(true);
    expect(history.rows.some((row) => row[column] === otherCard.id)).toBe(false);
  });
});
