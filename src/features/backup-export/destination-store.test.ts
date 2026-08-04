import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { shopBackupDestinations, shops } from "@/db/schema";
import { openSecret } from "@/lib/secret-box";
import { seededShopContext } from "@/test/db";
import {
  backupEndpointRefusal,
  disconnectShopBackupDestination,
  getShopBackupDestination,
  markShopBackupVerified,
  openBackupCredentials,
  saveShopBackupDestination,
} from "./destination-store";

const KEY = randomBytes(32);

const DESTINATION = {
  endpoint: "https://backups.example.com",
  region: "auto",
  bucket: "shop-backups",
  prefix: "diveday",
  accessKeyId: "AKIA-TEST-KEY-ID",
  secretAccessKey: "very-secret-access-key",
};

/** A shop with no seeded backup rows, so first-save semantics are testable. */
async function bareShopContext() {
  const { db } = await seededShopContext();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Bare Shop", slug: "bare-shop-backup-test", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("bare shop insert failed");
  return { db, shop };
}

describe("backupEndpointRefusal", () => {
  it("accepts a real HTTPS S3-compatible origin", () => {
    expect(backupEndpointRefusal("https://abc123.r2.cloudflarestorage.com")).toBeNull();
    expect(backupEndpointRefusal("https://s3.us-east-1.amazonaws.com")).toBeNull();
  });

  it.each([
    ["not a url", "endpoint_invalid"],
    ["ftp://backups.example.com", "endpoint_not_https"],
    ["http://backups.example.com", "endpoint_not_https"],
    ["https://user:pass@backups.example.com", "endpoint_invalid"],
    ["https://backups.example.com/?x=1", "endpoint_invalid"],
    ["https://localhost", "endpoint_private_host"],
    ["https://127.0.0.1:9000", "endpoint_private_host"],
    ["https://10.0.0.5", "endpoint_private_host"],
    ["https://192.168.1.10", "endpoint_private_host"],
    ["https://172.16.0.1", "endpoint_private_host"],
    ["https://172.31.255.255", "endpoint_private_host"],
    ["https://169.254.169.254", "endpoint_private_host"],
    ["https://[::1]", "endpoint_private_host"],
    ["https://[fe80::1]", "endpoint_private_host"],
    ["https://[fd00::1]", "endpoint_private_host"],
    ["https://[::ffff:127.0.0.1]", "endpoint_private_host"],
    // Integer/hex/octal IPv4 spellings normalize to dotted form in the URL
    // parser before the pattern check ever sees them.
    ["https://2130706433", "endpoint_private_host"],
    ["https://0x7f.0.0.1", "endpoint_private_host"],
    ["https://minio.internal", "endpoint_private_host"],
    ["https://nas.local", "endpoint_private_host"],
  ] as const)("refuses %s with %s", (endpoint, reason) => {
    expect(backupEndpointRefusal(endpoint)).toBe(reason);
  });

  it("does not refuse a public host that merely contains a private-looking prefix", () => {
    expect(backupEndpointRefusal("https://10percent-backups.example.com")).toBeNull();
    expect(backupEndpointRefusal("https://localhost-tools.example.com")).toBeNull();
  });
});

describe("saveShopBackupDestination", () => {
  it("seals the secret before it reaches the column, and it opens back with the key", async () => {
    const { db, shop } = await bareShopContext();
    const result = await saveShopBackupDestination(
      db,
      { shopId: shop.id, ...DESTINATION },
      { key: KEY },
    );
    expect(result.status).toBe("saved");

    const [row] = await db
      .select()
      .from(shopBackupDestinations)
      .where(eq(shopBackupDestinations.shopId, shop.id));
    expect(row.secretAccessKeySealed).not.toContain(DESTINATION.secretAccessKey);
    expect(row.secretAccessKeySealed.startsWith("v1.")).toBe(true);
    expect(openSecret(row.secretAccessKeySealed, KEY)).toBe(DESTINATION.secretAccessKey);
  });

  it("refuses the first save without a secret", async () => {
    const { db, shop } = await bareShopContext();
    const result = await saveShopBackupDestination(
      db,
      { shopId: shop.id, ...DESTINATION, secretAccessKey: "  " },
      { key: KEY },
    );
    expect(result).toEqual({ status: "refused", reason: "secret_required" });
    expect(await getShopBackupDestination(db, shop.id)).toBeNull();
  });

  it("keeps the stored secret when an update leaves the field blank", async () => {
    const { db, shop } = await bareShopContext();
    await saveShopBackupDestination(db, { shopId: shop.id, ...DESTINATION }, { key: KEY });
    const result = await saveShopBackupDestination(
      db,
      { shopId: shop.id, ...DESTINATION, bucket: "renamed-bucket", secretAccessKey: null },
      { key: KEY },
    );
    expect(result.status).toBe("saved");

    const row = await getShopBackupDestination(db, shop.id);
    expect(row?.bucket).toBe("renamed-bucket");
    expect(openSecret(row?.secretAccessKeySealed ?? "", KEY)).toBe(DESTINATION.secretAccessKey);
  });

  it("re-seals when an update supplies a new secret, and drops verifiedAt until re-proven", async () => {
    const { db, shop } = await bareShopContext();
    await saveShopBackupDestination(db, { shopId: shop.id, ...DESTINATION }, { key: KEY });
    await markShopBackupVerified(db, shop.id);
    expect((await getShopBackupDestination(db, shop.id))?.verifiedAt).not.toBeNull();

    const result = await saveShopBackupDestination(
      db,
      { shopId: shop.id, ...DESTINATION, secretAccessKey: "rotated-secret" },
      { key: KEY },
    );
    expect(result.status).toBe("saved");
    const row = await getShopBackupDestination(db, shop.id);
    expect(row?.verifiedAt).toBeNull();
    expect(openSecret(row?.secretAccessKeySealed ?? "", KEY)).toBe("rotated-secret");
  });

  it("refuses when no sealing key is configured, before anything is written", async () => {
    const { db, shop } = await bareShopContext();
    const result = await saveShopBackupDestination(
      db,
      { shopId: shop.id, ...DESTINATION },
      { key: null },
    );
    expect(result).toEqual({ status: "refused", reason: "encryption_key_unset" });
    expect(await getShopBackupDestination(db, shop.id)).toBeNull();
  });

  it("refuses a private-host endpoint before touching the key or the row", async () => {
    const { db, shop } = await bareShopContext();
    const result = await saveShopBackupDestination(
      db,
      { shopId: shop.id, ...DESTINATION, endpoint: "https://169.254.169.254" },
      { key: null },
    );
    expect(result).toEqual({ status: "refused", reason: "endpoint_private_host" });
  });

  it("normalizes the endpoint's trailing slash and the prefix's surrounding slashes", async () => {
    const { db, shop } = await bareShopContext();
    await saveShopBackupDestination(
      db,
      {
        shopId: shop.id,
        ...DESTINATION,
        endpoint: "https://backups.example.com/",
        prefix: "/diveday/",
      },
      { key: KEY },
    );
    const row = await getShopBackupDestination(db, shop.id);
    expect(row?.endpoint).toBe("https://backups.example.com");
    expect(row?.prefix).toBe("diveday");
  });
});

describe("openBackupCredentials", () => {
  it("returns the credentials only to a caller holding the right key", async () => {
    const { db, shop } = await bareShopContext();
    await saveShopBackupDestination(db, { shopId: shop.id, ...DESTINATION }, { key: KEY });
    const row = await getShopBackupDestination(db, shop.id);
    if (!row) throw new Error("destination missing");

    expect(openBackupCredentials(row, { key: KEY })).toEqual({
      accessKeyId: DESTINATION.accessKeyId,
      secretAccessKey: DESTINATION.secretAccessKey,
    });
    expect(openBackupCredentials(row, { key: randomBytes(32) })).toBeNull();
    expect(openBackupCredentials(row, { key: null })).toBeNull();
  });
});

describe("disconnectShopBackupDestination", () => {
  it("deletes the row so no revoked credential is retained", async () => {
    const { db, shop } = await bareShopContext();
    await saveShopBackupDestination(db, { shopId: shop.id, ...DESTINATION }, { key: KEY });
    expect(await disconnectShopBackupDestination(db, shop.id)).toBe(true);
    expect(await getShopBackupDestination(db, shop.id)).toBeNull();
    expect(await disconnectShopBackupDestination(db, shop.id)).toBe(false);
  });

  it("touches only the named shop's destination", async () => {
    const { db, shop } = await bareShopContext();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other", slug: "other-shop-backup-test", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    await saveShopBackupDestination(db, { shopId: shop.id, ...DESTINATION }, { key: KEY });
    await saveShopBackupDestination(db, { shopId: other.id, ...DESTINATION }, { key: KEY });

    await disconnectShopBackupDestination(db, shop.id);
    expect(await getShopBackupDestination(db, shop.id)).toBeNull();
    expect(await getShopBackupDestination(db, other.id)).not.toBeNull();
  });
});
