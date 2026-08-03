import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { userAccounts } from "@/db/schema";
import { seededTestDb } from "@/test/db";
import { verifyCredentials } from "./credentials";

// Spies on the real implementation rather than replacing it, so every
// behavioural assertion below still exercises genuine bcrypt.
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return { ...actual, compare: vi.fn(actual.compare) };
});

const compareSpy = vi.mocked(compare);

beforeEach(() => {
  compareSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyCredentials (in-memory PGlite)", () => {
  it("signs in seeded staff with the right password and returns roles", async () => {
    const db = await seededTestDb();
    const { email, password } = DEV_STAFF_LOGINS.owner;

    const user = await verifyCredentials(db, email, password);
    expect(user?.name).toBe("Dana Reyes");
    expect(user?.roles).toEqual(expect.arrayContaining(["owner", "manager"]));
    expect(user?.shopId).toBeTruthy();
  });

  it("is case-insensitive on email", async () => {
    const db = await seededTestDb();
    const { email, password } = DEV_STAFF_LOGINS.captain;
    const user = await verifyCredentials(db, email.toUpperCase(), password);
    expect(user?.name).toBe("Sal Moretti");
  });

  it("rejects a wrong password", async () => {
    const db = await seededTestDb();
    const { email } = DEV_STAFF_LOGINS.owner;
    expect(await verifyCredentials(db, email, "not-the-password")).toBeNull();
  });

  it("rejects unknown emails", async () => {
    const db = await seededTestDb();
    expect(await verifyCredentials(db, "nobody@example.com", "whatever")).toBeNull();
  });

  it("rejects a disabled account even with the right password", async () => {
    const db = await seededTestDb();
    const { email, password } = DEV_STAFF_LOGINS.instructor;
    await db.update(userAccounts).set({ status: "disabled" }).where(eq(userAccounts.email, email));
    expect(await verifyCredentials(db, email, password)).toBeNull();
  });

  it("admits the bypass token if the shop is a demo shop", async () => {
    const db = await seededTestDb();
    const { email } = DEV_STAFF_LOGINS.instructor;

    const user = await verifyCredentials(db, email, "password");
    expect(user?.name).toBe("Marcus Webb");
    expect(user?.roles).toContain("instructor");
  });

  it("rejects the bypass token if the shop is NOT a demo shop", async () => {
    const db = await seededTestDb();
    const { email } = DEV_STAFF_LOGINS.instructor;

    // Toggle demo flag off for the shop
    const { shops } = await import("@/db/schema");
    await db.update(shops).set({ isDemo: false });

    const user = await verifyCredentials(db, email, "password");
    expect(user).toBeNull();
  });

  it("rejects the bypass token when the runtime is unrecognized, even on a demo shop", async () => {
    const db = await seededTestDb();
    const { email } = DEV_STAFF_LOGINS.instructor;
    vi.stubEnv("NODE_ENV", "staging");

    expect(await verifyCredentials(db, email, "password")).toBeNull();
  });

  it("rejects the bypass token when an operator killed the switch", async () => {
    const db = await seededTestDb();
    const { email } = DEV_STAFF_LOGINS.instructor;
    vi.stubEnv("DIVEDAY_DEMO_BYPASS", "off");

    expect(await verifyCredentials(db, email, "password")).toBeNull();
  });

  it("rejects the bypass token for an account outside the reserved demo namespace", async () => {
    const db = await seededTestDb();
    const { email } = DEV_STAFF_LOGINS.instructor;
    // The shop stays `isDemo`; only the account's address moves out of
    // `*.demo.invalid`. A real tenant's staff addresses are always routable
    // like this, so flipping `is_demo` on one must not admit the bypass.
    await db
      .update(userAccounts)
      .set({ email: "marcus@realshop.example.com" })
      .where(eq(userAccounts.email, email));

    expect(await verifyCredentials(db, "marcus@realshop.example.com", "password")).toBeNull();
  });
});

describe("verifyCredentials timing side-channel", () => {
  it("runs a bcrypt compare on the missing-account path, so it cannot answer faster than a wrong password", async () => {
    const db = await seededTestDb();

    expect(await verifyCredentials(db, "nobody@example.com", "whatever")).toBeNull();

    expect(compareSpy).toHaveBeenCalledTimes(1);
    const [submitted, against] = compareSpy.mock.calls[0];
    expect(submitted).toBe("whatever");
    // A real bcrypt hash at the app's own cost — the decoy, not a short-circuit.
    expect(against).toMatch(/^\$2[aby]\$10\$/);
  });

  it("runs exactly one compare on every path, matched or not", async () => {
    const db = await seededTestDb();
    const { email, password } = DEV_STAFF_LOGINS.owner;

    await verifyCredentials(db, email, password);
    expect(compareSpy).toHaveBeenCalledTimes(1);

    compareSpy.mockClear();
    await verifyCredentials(db, email, "wrong");
    expect(compareSpy).toHaveBeenCalledTimes(1);

    compareSpy.mockClear();
    await verifyCredentials(db, "nobody@example.com", "wrong");
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it("compares against the decoy for a disabled account too, so status is not an oracle either", async () => {
    const db = await seededTestDb();
    const { email, password } = DEV_STAFF_LOGINS.instructor;
    await db.update(userAccounts).set({ status: "disabled" }).where(eq(userAccounts.email, email));

    expect(await verifyCredentials(db, email, password)).toBeNull();
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it("never lets the decoy authenticate anything", async () => {
    const db = await seededTestDb();
    // Whatever the decoy's plaintext is, nobody holds it: the bytes are
    // discarded at generation. Any submitted password must still be rejected.
    for (const attempt of ["", "password", "decoy", " "]) {
      expect(await verifyCredentials(db, "nobody@example.com", attempt)).toBeNull();
    }
  });
});
