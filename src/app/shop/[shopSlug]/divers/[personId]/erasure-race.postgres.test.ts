import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { anonymizeDiver } from "@/db/anonymize";
import type { AppDb } from "@/db/client";
import { mergeDiverRecords } from "@/db/diver-merge";
import { certifications, people, personRoles, shops, userAccounts } from "@/db/schema";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { redirectedTo, staffSession } from "@/test/staff-session";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { erasePersonAction, restorePersonAction, mergeDiverAction, deletePersonAction } =
  await import("@/app/shop/[shopSlug]/divers/[personId]/record-actions");
const { savePersonAction } = await import(
  "@/app/shop/[shopSlug]/divers/[personId]/details-actions"
);

/** Pause just before the transaction acquires the shop lock, after action prechecks. */
function pauseBeforeLock(db: AppDb) {
  const waiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const wrapped = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return (callback: (tx: AppDb) => unknown) =>
          target.transaction(async (tx) => {
            let first = true;
            const paused = new Proxy(tx, {
              get(inner, key) {
                const value = Reflect.get(inner, key, inner);
                if (key === "execute" && first) {
                  first = false;
                  return async (...args: unknown[]) => {
                    waiting.resolve();
                    await release.promise;
                    return Reflect.apply(value, inner, args);
                  };
                }
                return typeof value === "function" ? value.bind(inner) : value;
              },
            });
            return callback(paused as unknown as AppDb);
          });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: wrapped, read: waiting.promise, release: () => release.resolve() };
}

describePostgres("diver erasure racing a merge", () => {
  it("does not report erasure while merged personal data remains", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(5).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Erasure ${suffix}`, slug: `erase-${suffix}`, timezone: "UTC" })
      .returning({ id: shops.id });
    if (!shop) throw new Error("shop fixture missing");
    const [owner, source, survivor] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner" },
        { shopId: shop.id, fullName: "Example Diver", email: `source-${suffix}@example.com` },
        { shopId: shop.id, fullName: "Example Diver" },
      ])
      .returning({ id: people.id });
    if (!owner || !source || !survivor) throw new Error("people fixtures missing");
    await pg.db.insert(personRoles).values([
      { personId: owner.id, role: "owner" },
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    await pg.db.insert(userAccounts).values({
      personId: owner.id,
      email: `owner-${suffix}@example.com`,
      hashedPassword: "x",
      status: "active",
    });
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: source.id,
        agency: "padi",
        level: "open_water",
        identifier: `CARD-${suffix}`,
        status: "verified",
      })
      .returning({ id: certifications.id });
    if (!card) throw new Error("card fixture missing");

    const gate = pauseBeforeLock(pg.connect());
    const erasure = anonymizeDiver(gate.db, {
      shopId: shop.id,
      personId: source.id,
      actorPersonId: owner.id,
    });
    try {
      await Promise.race([
        gate.read,
        erasure.then((outcome) => {
          throw new Error(`erasure ended before its transaction: ${JSON.stringify(outcome)}`);
        }),
      ]);
      const merged = await mergeDiverRecords({
        db: pg.connect(),
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      });
      expect(merged).toMatchObject({ ok: true });
    } finally {
      gate.release();
    }
    const outcome = await erasure;
    const [kept] = await pg.db
      .select({ email: people.email, anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(eq(people.id, survivor.id));
    const [keptCard] = await pg.db
      .select({ personId: certifications.personId, identifier: certifications.identifier })
      .from(certifications)
      .where(eq(certifications.id, card.id));
    expect(outcome).toMatchObject({ ok: false, reason: "merged", survivorId: survivor.id });
    expect(kept?.anonymizedAt).toBeNull();
    expect(kept?.email).not.toBeNull();
    expect(keptCard?.identifier).not.toBeNull();
  });
  it("does not report erased when a public-action restore and merge win during erasure", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(5).toString("hex");
    const slug = `erase-action-${suffix}`;
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Erasure ${suffix}`, slug, timezone: "UTC" })
      .returning({ id: shops.id });
    if (!shop) throw new Error("shop fixture missing");
    const [owner, source, survivor] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner" },
        {
          shopId: shop.id,
          fullName: "Example Diver",
          email: `source-${suffix}@example.com`,
          deletedAt: new Date("2026-01-01T00:00:00Z"),
        },
        { shopId: shop.id, fullName: "Example Diver" },
      ])
      .returning({ id: people.id });
    if (!owner || !source || !survivor) throw new Error("people fixtures missing");
    await pg.db.insert(personRoles).values([
      { personId: owner.id, role: "owner" },
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    await pg.db.insert(userAccounts).values({
      personId: owner.id,
      email: `owner-${suffix}@example.com`,
      hashedPassword: "x",
      status: "active",
    });
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: source.id,
        agency: "padi",
        level: "open_water",
        identifier: `CARD-${suffix}`,
        status: "verified",
      })
      .returning({ id: certifications.id });
    if (!card) throw new Error("card fixture missing");
    const gate = pauseBeforeLock(pg.connect());
    vi.mocked(getDb).mockResolvedValueOnce(gate.db).mockResolvedValue(pg.db);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: slug, personId: owner.id, roles: ["owner"] }),
    );
    const eraseForm = new FormData();
    eraseForm.set("confirmName", "Example Diver");
    const erasure = redirectedTo(() => erasePersonAction(slug, source.id, eraseForm));
    try {
      await Promise.race([
        gate.read,
        erasure.then((notice) => {
          throw new Error(`erasure ended before its transaction: ${notice}`);
        }),
      ]);
      const restored = await redirectedTo(() =>
        restorePersonAction(slug, source.id, new FormData()),
      );
      expect(restored).toContain("restored");
      const mergeForm = new FormData();
      mergeForm.set("survivorId", survivor.id);
      const merged = await redirectedTo(() => mergeDiverAction(slug, source.id, mergeForm));
      expect(merged).toContain("merged");
    } finally {
      gate.release();
    }
    const notice = await erasure;
    const [kept] = await pg.db
      .select({ email: people.email, anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(eq(people.id, survivor.id));
    const [keptCard] = await pg.db
      .select({ identifier: certifications.identifier })
      .from(certifications)
      .where(eq(certifications.id, card.id));
    expect(notice).toContain("notice=merged-record-moved");
    expect(kept?.anonymizedAt).toBeNull();
    expect(kept?.email).not.toBeNull();
    expect(keptCard?.identifier).not.toBeNull();
  });
  it("does not erase a person restored during the erase action", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(5).toString("hex");
    const slug = `erase-action-${suffix}`;
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Erasure ${suffix}`, slug, timezone: "UTC" })
      .returning({ id: shops.id });
    if (!shop) throw new Error("shop fixture missing");
    const [owner, source, survivor] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner" },
        {
          shopId: shop.id,
          fullName: "Example Diver",
          email: `source-${suffix}@example.com`,
          deletedAt: new Date("2026-01-01T00:00:00Z"),
        },
        { shopId: shop.id, fullName: "Example Diver" },
      ])
      .returning({ id: people.id });
    if (!owner || !source || !survivor) throw new Error("people fixtures missing");
    await pg.db.insert(personRoles).values([
      { personId: owner.id, role: "owner" },
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    await pg.db.insert(userAccounts).values({
      personId: owner.id,
      email: `owner-${suffix}@example.com`,
      hashedPassword: "x",
      status: "active",
    });
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: source.id,
        agency: "padi",
        level: "open_water",
        identifier: `CARD-${suffix}`,
        status: "verified",
      })
      .returning({ id: certifications.id });
    if (!card) throw new Error("card fixture missing");
    const gate = pauseBeforeLock(pg.connect());
    vi.mocked(getDb).mockResolvedValueOnce(gate.db).mockResolvedValue(pg.db);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: slug, personId: owner.id, roles: ["owner"] }),
    );
    const eraseForm = new FormData();
    eraseForm.set("confirmName", "Example Diver");
    const erasure = redirectedTo(() => erasePersonAction(slug, source.id, eraseForm));
    try {
      await Promise.race([
        gate.read,
        erasure.then((notice) => {
          throw new Error(`erasure ended before its transaction: ${notice}`);
        }),
      ]);
      const restored = await redirectedTo(() =>
        restorePersonAction(slug, source.id, new FormData()),
      );
      expect(restored).toContain("restored");
    } finally {
      gate.release();
    }
    const notice = await erasure;
    const [restored] = await pg.db
      .select({ email: people.email, anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(eq(people.id, source.id));
    expect(notice).toContain("notice=erase-requires-delete");
    expect(restored).toMatchObject({ anonymizedAt: null, email: `source-${suffix}@example.com` });
  });
  it("does not erase a differently named person after stale confirmation", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(5).toString("hex");
    const slug = `erase-action-${suffix}`;
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Erasure ${suffix}`, slug, timezone: "UTC" })
      .returning({ id: shops.id });
    if (!shop) throw new Error("shop fixture missing");
    const [owner, source, survivor] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner" },
        {
          shopId: shop.id,
          fullName: "Example Diver",
          email: `source-${suffix}@example.com`,
          deletedAt: new Date("2026-01-01T00:00:00Z"),
        },
        { shopId: shop.id, fullName: "Example Diver" },
      ])
      .returning({ id: people.id });
    if (!owner || !source || !survivor) throw new Error("people fixtures missing");
    await pg.db.insert(personRoles).values([
      { personId: owner.id, role: "owner" },
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    await pg.db.insert(userAccounts).values({
      personId: owner.id,
      email: `owner-${suffix}@example.com`,
      hashedPassword: "x",
      status: "active",
    });
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: source.id,
        agency: "padi",
        level: "open_water",
        identifier: `CARD-${suffix}`,
        status: "verified",
      })
      .returning({ id: certifications.id });
    if (!card) throw new Error("card fixture missing");
    const gate = pauseBeforeLock(pg.connect());
    vi.mocked(getDb).mockResolvedValueOnce(gate.db).mockResolvedValue(pg.db);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: slug, personId: owner.id, roles: ["owner"] }),
    );
    const eraseForm = new FormData();
    eraseForm.set("confirmName", "Example Diver");
    const erasure = redirectedTo(() => erasePersonAction(slug, source.id, eraseForm));
    try {
      await Promise.race([
        gate.read,
        erasure.then((notice) => {
          throw new Error(`erasure ended before its transaction: ${notice}`);
        }),
      ]);
      const restored = await redirectedTo(() =>
        restorePersonAction(slug, source.id, new FormData()),
      );
      expect(restored).toContain("restored");
      const details = new FormData();
      for (const [field, value] of Object.entries({
        fullName: "New Diver Name",
        email: `source-${suffix}@example.com`,
        phone: "",
        diveInsurance: "",
        emergencyContactName: "",
        emergencyContactPhone: "",
        dateOfBirth: "",
      }))
        details.set(field, value);
      const changed = await redirectedTo(() => savePersonAction(slug, source.id, details));
      expect(changed).toContain("saved");
      const deleted = await redirectedTo(() => deletePersonAction(slug, source.id, new FormData()));
      expect(deleted).toContain("deleted");
    } finally {
      gate.release();
    }
    const notice = await erasure;
    const [restored] = await pg.db
      .select({ email: people.email, anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(eq(people.id, source.id));
    expect(notice).toContain("notice=erase-name-mismatch");
    expect(restored).toMatchObject({ anonymizedAt: null, email: `source-${suffix}@example.com` });
  });
});
