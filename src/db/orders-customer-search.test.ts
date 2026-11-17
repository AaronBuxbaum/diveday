import { and, eq, isNull } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getOrderableCustomer, searchOrderableCustomers } from "./orders";
import { people } from "./schema";

// Issue #4601: the order forms' customer picker searches; it never lists the
// whole shop, and it never truncates without saying so.
const ctx = fileScopedShopContext();

async function someone() {
  const { db, shop } = ctx;
  const [row] = await db
    .select({ id: people.id, fullName: people.fullName, email: people.email })
    .from(people)
    .where(and(eq(people.shopId, shop.id), isNull(people.deletedAt)))
    .limit(1);
  if (!row) throw new Error("seed has no people");
  return row;
}

it("lists nobody until something is typed", async () => {
  const { db, shop } = ctx;
  expect(await searchOrderableCustomers(db, shop.id, "  ")).toEqual({
    customers: [],
    more: false,
  });
});

it("finds a person by part of their name, case aside", async () => {
  const { db, shop } = ctx;
  const person = await someone();
  const part = person.fullName.split(" ")[0]?.toLowerCase() ?? person.fullName;
  const { customers } = await searchOrderableCustomers(db, shop.id, part, 50);
  expect(customers.map((customer) => customer.id)).toContain(person.id);
});

it("caps the matches and says there are more rather than hiding them", async () => {
  const { db, shop } = ctx;
  const all = await searchOrderableCustomers(db, shop.id, "a", 500);
  expect(all.customers.length).toBeGreaterThan(2);
  const capped = await searchOrderableCustomers(db, shop.id, "a", 2);
  expect(capped.customers).toHaveLength(2);
  expect(capped.more).toBe(true);
  const exact = await searchOrderableCustomers(db, shop.id, "a", all.customers.length);
  expect(exact.more).toBe(false);
});

it("reads a typed % as a character, not a wildcard", async () => {
  const { db, shop } = ctx;
  expect((await searchOrderableCustomers(db, shop.id, "%")).customers).toEqual([]);
});

it("finds the one customer a link names, in this shop only", async () => {
  const { db, shop } = ctx;
  const person = await someone();
  expect(await getOrderableCustomer(db, shop.id, person.id)).toEqual(person);
  expect(
    await getOrderableCustomer(db, "00000000-0000-4000-8000-000000000000", person.id),
  ).toBeNull();
});
