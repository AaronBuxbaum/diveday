import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { people, personRoles } from "./schema";
import {
  createStaffCredential,
  deleteStaffCredential,
  listStaffCredentials,
  reviewStaffCredential,
} from "./staff-credentials";

const OTHER_SHOP = "00000000-0000-0000-0000-000000000000";

let seq = 0;

async function makePerson(
  db: AppDb,
  shopId: string,
  roles: Role[],
  opts: { name?: string; deleted?: boolean } = {},
): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({
      shopId,
      fullName: opts.name ?? `Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert person");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  return person.id;
}

async function context() {
  const { db, shop } = await seededShopContext();
  const staff = await makePerson(db, shop.id, ["instructor"], { name: "Marisol Vega" });
  return { db, shop, staff };
}

const card = (personId: string, shopId: string, identifier = "PADI-123456") => ({
  shopId,
  personId,
  kind: "instructor_rating" as const,
  name: "Open Water Scuba Instructor",
  identifier,
});

describe("createStaffCredential", () => {
  it("files a pending credential for a live staff member of this shop", async () => {
    const { db, shop, staff } = await context();
    const row = await createStaffCredential(db, {
      ...card(staff, shop.id),
      issuingBody: "PADI",
      issuedAt: "2024-03-01",
      renewsAt: "2027-03-01",
    });
    expect(row).toMatchObject({
      shopId: shop.id,
      personId: staff,
      kind: "instructor_rating",
      status: "pending",
      issuingBody: "PADI",
      issuedAt: "2024-03-01",
      renewsAt: "2027-03-01",
    });
  });

  it("refuses a person with no staff role — a diver cannot hold a staff credential", async () => {
    const { db, shop } = await context();
    const diver = await makePerson(db, shop.id, []);
    expect(await createStaffCredential(db, card(diver, shop.id))).toBeNull();
  });

  it("refuses a deleted staff member", async () => {
    const { db, shop } = await context();
    const gone = await makePerson(db, shop.id, ["divemaster"], { deleted: true });
    expect(await createStaffCredential(db, card(gone, shop.id))).toBeNull();
  });

  it("refuses a person that belongs to another shop, whatever id the caller names", async () => {
    const { db, staff } = await context();
    expect(await createStaffCredential(db, card(staff, OTHER_SHOP))).toBeNull();
  });

  it("refuses a renewal date earlier than the issue date", async () => {
    const { db, shop, staff } = await context();
    expect(
      await createStaffCredential(db, {
        ...card(staff, shop.id),
        issuedAt: "2026-03-01",
        renewsAt: "2025-03-01",
      }),
    ).toBeNull();
    // Either date alone is fine — the check only compares a pair.
    expect(
      await createStaffCredential(db, { ...card(staff, shop.id), issuedAt: "2026-03-01" }),
    ).not.toBeNull();
  });

  it("refuses the same card number twice for one person and kind, case-insensitively", async () => {
    const { db, shop, staff } = await context();
    expect(await createStaffCredential(db, card(staff, shop.id, "padi-123456"))).not.toBeNull();
    expect(await createStaffCredential(db, card(staff, shop.id, "PADI-123456"))).toBeNull();
    // The refusal is a null, never a thrown 500 — and the list is unchanged.
    expect(await listStaffCredentials(db, shop.id)).toHaveLength(1);
  });

  it("lets the same identifier stand under a different kind, and again once the first is deleted", async () => {
    const { db, shop, staff } = await context();
    const first = await createStaffCredential(db, card(staff, shop.id));
    if (!first) throw new Error("expected the first credential");
    expect(
      await createStaffCredential(db, { ...card(staff, shop.id), kind: "other" }),
    ).not.toBeNull();
    expect(await deleteStaffCredential(db, shop.id, first.id, staff)).toBe(true);
    expect(await createStaffCredential(db, card(staff, shop.id))).not.toBeNull();
  });
});

describe("listStaffCredentials", () => {
  it("lists live credentials of live staff only, by person name then renewal", async () => {
    const { db, shop, staff } = await context();
    const earlier = await makePerson(db, shop.id, ["owner"], { name: "Ana Ruiz" });
    const departed = await makePerson(db, shop.id, ["instructor"], { name: "Zed Okafor" });
    await createStaffCredential(db, {
      ...card(staff, shop.id, "B"),
      name: "Later",
      renewsAt: "2028-01-01",
    });
    await createStaffCredential(db, {
      ...card(staff, shop.id, "A"),
      name: "Sooner",
      renewsAt: "2027-01-01",
    });
    await createStaffCredential(db, { ...card(earlier, shop.id, "C"), kind: "first_aid_cpr" });
    const filed = await createStaffCredential(db, card(departed, shop.id, "D"));
    if (!filed) throw new Error("expected the departed staffer's credential to file");
    const removed = await createStaffCredential(db, card(staff, shop.id, "E"));
    if (!removed) throw new Error("expected the credential to file");

    // A staffer who leaves is deleted, not scrubbed: their card must not go on
    // being listed. A credential deleted by hand must not either.
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-06-01T00:00:00Z") })
      .where(eq(people.id, departed));
    expect(await deleteStaffCredential(db, shop.id, removed.id, staff)).toBe(true);

    const listed = (await listStaffCredentials(db, shop.id)).filter((row) =>
      ["A", "B", "C", "D", "E"].includes(row.credential.identifier ?? ""),
    );
    expect(listed.map((row) => [row.person.fullName, row.credential.name])).toEqual([
      ["Ana Ruiz", "Open Water Scuba Instructor"],
      ["Marisol Vega", "Sooner"],
      ["Marisol Vega", "Later"],
    ]);
  });

  it("answers nothing for another shop's id", async () => {
    const { db, shop, staff } = await context();
    await createStaffCredential(db, card(staff, shop.id));
    expect(await listStaffCredentials(db, OTHER_SHOP)).toEqual([]);
  });
});

describe("reviewStaffCredential", () => {
  it("marks a credential verified with who looked and what they said", async () => {
    const { db, shop, staff } = await context();
    const reviewer = await makePerson(db, shop.id, ["owner"]);
    const row = await createStaffCredential(db, card(staff, shop.id));
    if (!row) throw new Error("expected the credential to file");

    const reviewed = await reviewStaffCredential(db, {
      shopId: shop.id,
      credentialId: row.id,
      status: "verified",
      reviewNote: "Checked on the PADI Pro Chek site.",
      reviewedByPersonId: reviewer,
    });
    expect(reviewed).toMatchObject({
      id: row.id,
      status: "verified",
      reviewNote: "Checked on the PADI Pro Chek site.",
      reviewedByPersonId: reviewer,
    });
    expect(reviewed?.reviewedAt).toBeInstanceOf(Date);

    // Back to pending clears the note rather than keeping a stale one.
    const reopened = await reviewStaffCredential(db, {
      shopId: shop.id,
      credentialId: row.id,
      status: "pending",
      reviewedByPersonId: reviewer,
    });
    expect(reopened).toMatchObject({ status: "pending", reviewNote: null });
  });

  it("touches nothing for another shop's id or a deleted credential", async () => {
    const { db, shop, staff } = await context();
    const row = await createStaffCredential(db, card(staff, shop.id));
    if (!row) throw new Error("expected the credential to file");
    const review = { credentialId: row.id, status: "verified" as const, reviewedByPersonId: staff };

    expect(await reviewStaffCredential(db, { ...review, shopId: OTHER_SHOP })).toBeNull();
    expect(await deleteStaffCredential(db, shop.id, row.id, staff)).toBe(true);
    expect(await reviewStaffCredential(db, { ...review, shopId: shop.id })).toBeNull();
  });
});

describe("deleteStaffCredential", () => {
  it("is a soft delete that answers once, and never across a shop boundary", async () => {
    const { db, shop, staff } = await context();
    const row = await createStaffCredential(db, card(staff, shop.id));
    if (!row) throw new Error("expected the credential to file");

    expect(await deleteStaffCredential(db, OTHER_SHOP, row.id, staff)).toBe(false);
    expect(await deleteStaffCredential(db, shop.id, row.id, staff)).toBe(true);
    expect(await deleteStaffCredential(db, shop.id, row.id, staff)).toBe(false);

    const ids = (await listStaffCredentials(db, shop.id)).map((r) => r.credential.id);
    expect(ids).not.toContain(row.id);
  });
});
