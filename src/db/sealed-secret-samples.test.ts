import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { keyringOpensSamples, sealSecret } from "@/lib/secret-box";
import { fileScopedShopContext } from "@/test/db";
import { sealedSecretSamples } from "./sealed-secret-samples";
import {
  shopBackupDestinations,
  shopIntegrations,
  shops,
  shopWhatsappAccounts,
} from "./schema";

const ctx = fileScopedShopContext();

/** A shop with one value of each kind, the seed's own rows cleared first. */
async function oneOfEach(key: Buffer) {
  const { db, shop } = ctx;
  await db.delete(shopIntegrations);
  await db.delete(shopBackupDestinations);
  await db.delete(shopWhatsappAccounts);
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  await db.insert(shopWhatsappAccounts).values({
    shopId: shop.id,
    phoneNumberId: "pn-sealing-check",
    accessTokenSealed: sealSecret("meta-token", key),
    templateName: "courtesy",
    templateLanguage: "en",
  });
  await db.insert(shopIntegrations).values({
    shopId: shop.id,
    provider: "zapier",
    credentialsSealed: sealSecret("{}", key),
  });
  await db.insert(shopBackupDestinations).values({
    shopId: shop.id,
    endpoint: "https://s3.example.com",
    region: "auto",
    bucket: "b",
    accessKeyId: "AKIA",
    secretAccessKeySealed: sealSecret("secret", key),
  });
  return { db, shop };
}

describe("sealedSecretSamples", () => {
  it("returns one value of each kind, and the keyring that sealed them opens all three", async () => {
    const key = randomBytes(32);
    const { db } = await oneOfEach(key);
    const samples = await sealedSecretSamples(db);
    expect(samples.map((sample) => sample.kind)).toEqual([
      "whatsapp",
      "connector",
      "backup",
    ]);
    expect(
      keyringOpensSamples({ current: key, previous: null }, samples),
    ).toEqual({
      status: "ok",
      checked: 3,
    });
  });

  it("lets the deploy stop on a wrong key, naming the kinds and nothing else", async () => {
    const { db } = await oneOfEach(randomBytes(32));
    const result = keyringOpensSamples(
      { current: randomBytes(32), previous: null },
      await sealedSecretSamples(db),
    );
    expect(result).toEqual({
      status: "cannot_open",
      reason: "previous_missing",
      checked: 3,
      unopened: ["whatsapp", "connector", "backup"],
    });
  });

  it("leaves a disconnected connector and an absent kind out", async () => {
    const key = randomBytes(32);
    const { db, shop } = await oneOfEach(key);
    await db
      .update(shopIntegrations)
      .set({ deletedAt: new Date() })
      .where(eq(shopIntegrations.shopId, shop.id));
    await db.delete(shopBackupDestinations);
    expect(
      (await sealedSecretSamples(db)).map((sample) => sample.kind),
    ).toEqual(["whatsapp"]);
  });

  it("leaves a demo shop's seeded placeholder out, so the demo cannot fail a deploy", async () => {
    const { db, shop } = await oneOfEach(randomBytes(32));
    await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
    await db
      .update(shopBackupDestinations)
      .set({ secretAccessKeySealed: "v1.demo.demo.demo" });
    expect(await sealedSecretSamples(db)).toEqual([]);
  });
});
