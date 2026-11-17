import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createPerson, setPersonPhoto } from "./people";
import { people } from "./schema";

const ctx = fileScopedShopContext();

describe("setPersonPhoto", () => {
  it("sets, replaces and clears a picture, handing back what it replaced", async () => {
    const { db, shop } = ctx;
    const person = await createPerson(db, {
      shopId: shop.id,
      fullName: "Ines Duarte",
      email: null,
      phone: null,
      origin: "counter",
    });
    const set = (photoPath: string | null) =>
      setPersonPhoto(db, { shopId: shop.id, personId: person.id, photoPath });
    expect(await set("https://media.invalid/person-photos/a.jpg")).toEqual({ previous: null });
    expect(await set("https://media.invalid/person-photos/b.jpg")).toEqual({
      previous: "https://media.invalid/person-photos/a.jpg",
    });
    expect(await set(null)).toEqual({ previous: "https://media.invalid/person-photos/b.jpg" });
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.staffPhotoPath).toBeNull();
  });

  it("changes nobody in another shop", async () => {
    const { db, shop } = ctx;
    expect(
      await setPersonPhoto(db, {
        shopId: shop.id,
        personId: "00000000-0000-4000-8000-000000000000",
        photoPath: "x",
      }),
    ).toBeUndefined();
  });
});
