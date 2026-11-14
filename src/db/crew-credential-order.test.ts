import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { crewCredentialSnapshot } from "./crew-credential-snapshot";
import { people, staffCredentials } from "./schema";
import { listStaff } from "./trips";

const ctx = fileScopedShopContext();

it("captures every credential in fact order even when random IDs are reversed", async () => {
  const { db, shop } = ctx;
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("fixture staff missing");
  await db.insert(staffCredentials).values([
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      shopId: shop.id,
      personId: staff.person.id,
      kind: "other",
      name: "Earlier",
      issuedAt: "2001-01-01",
      renewsAt: "2002-01-01",
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      shopId: shop.id,
      personId: staff.person.id,
      kind: "other",
      name: "Later",
      issuedAt: "2003-01-01",
      renewsAt: "2004-01-01",
    },
  ]);
  const [row] = await db
    .select({ snapshot: crewCredentialSnapshot(shop.id, staff.person.id) })
    .from(people)
    .where(eq(people.id, staff.person.id));
  const facts = row.snapshot as { kind: string; issuedAt: string | null }[];
  expect(
    facts
      .filter(
        (fact) =>
          fact.kind === "other" && ["2001-01-01", "2003-01-01"].includes(fact.issuedAt ?? ""),
      )
      .map((fact) => fact.issuedAt),
  ).toEqual(["2001-01-01", "2003-01-01"]);
});
