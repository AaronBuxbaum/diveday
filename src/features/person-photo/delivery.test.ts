import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPerson } from "@/db/people";
import { people } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { currentPrivatePersonPhoto } from "./delivery";

const ctx = fileScopedShopContext();
const id = "abcdefghijklmnopqrstuv.jpg";
const other = "zyxwvutsrqponmlkjihgfe.jpg";
const url = `https://media.example/private-person-photos/${id}`;

it("only returns a live person's current asset in the given shop", async () => {
  const { db, shop } = ctx;
  const person = await createPerson(db, {
    shopId: shop.id,
    fullName: "Test Diver",
    email: null,
    phone: null,
    origin: "counter",
  });
  await db.update(people).set({ diverPhotoPath: url }).where(eq(people.id, person.id));
  const read = (shopId = shop.id, asset = id) =>
    currentPrivatePersonPhoto(db, shopId, person.id, asset);
  expect(await read()).toBe(url);
  expect(await read("00000000-0000-4000-8000-000000000000")).toBeNull();
  expect(await read(shop.id, other)).toBeNull();
  await db.update(people).set({ diverPhotoSuppressed: true }).where(eq(people.id, person.id));
  expect(await read()).toBeNull();
  await db.update(people).set({ diverPhotoSuppressed: false }).where(eq(people.id, person.id));
  await db.update(people).set({ diverPhotoPath: null }).where(eq(people.id, person.id));
  expect(await read()).toBeNull();
  await db
    .update(people)
    .set({ diverPhotoPath: url, anonymizedAt: nowDate(), deletedAt: nowDate() })
    .where(eq(people.id, person.id));
  expect(await read()).toBeNull();
  await db
    .update(people)
    .set({ anonymizedAt: null, deletedAt: nowDate() })
    .where(eq(people.id, person.id));
  expect(await read()).toBeNull();
});
