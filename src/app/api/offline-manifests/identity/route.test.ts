import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { SEEDED_CAPTAIN_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// See the sync route's test for why `auth` is mocked bare instead of via
// importOriginal (ADR 20260719-msw-offline-sync-only).
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { GET } = await import("./route");

const sessionFor = (
  shopId: string,
  personId: string,
  roles: Session["user"]["roles"] = ["captain"],
  shopSlug = "blue-mantis",
): Session => ({
  user: { personId, shopId, shopSlug, name: "Dana Reyes", roles },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

/**
 * The seeded shop plus one of its *real* staff members.
 *
 * The person id has to be real, and that is the point of this whole file's
 * shape: the route re-reads roles from `person_roles` on every request, so a
 * made-up `personId` would now refuse every request and every 200-path
 * assertion below would pass for the wrong reason — or rather, fail for one.
 * Sal Moretti is the seeded captain: staff, and the lowest-privilege staff role
 * the shop has, so nothing here quietly depends on being an owner.
 */
async function staffContext() {
  const { db, shop } = await seededShopContext();
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  return { db, shop, personId };
}

let seq = 0;

/**
 * A staff member built to order, so a test can say "their account is disabled"
 * or "they have no roles left" as a fact in the database rather than a claim on
 * a token. Same shape as `src/db/authz.test.ts`'s helper, which is the one
 * `loadActiveStaffRoles` is specified against.
 */
async function makeStaff(
  db: AppDb,
  shopId: string,
  roles: Role[],
  opts: { status?: "active" | "disabled"; deleted?: boolean } = {},
): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({
      shopId,
      fullName: `Identity Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `identity.staff.${seq}@example.com`,
    hashedPassword: "x",
    status: opts.status ?? "active",
  });
  return person.id;
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("GET /api/offline-manifests/identity", () => {
  it("answers with the caller's own shop slug and nothing else", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, personId));

    const response = await GET();
    expect(response.status).toBe(200);
    // Exact equality, not a property check: this is the whole contract. A
    // future field added here ships to a shared boat tablet, which is what the
    // roster route already does wrong (review 20260802, action item 12).
    expect(await response.json()).toEqual({ shop: { slug: "blue-mantis" } });
  });

  it("carries no roster, no diver names, and no count that leaks how big the board is", async () => {
    // The seeded shop genuinely has trips departing inside the roster route's
    // 48-hour window and real divers on them (see the upcoming route's test),
    // so "nothing about them appears here" is an assertion with something to
    // catch rather than a tautology about an empty shop.
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, personId));

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    // Two top-level keys would be one too many: a sibling `tripCount` is a
    // roster-size leak even with no names in it, and this is where that gets
    // caught.
    expect(Object.keys(body)).toEqual(["shop"]);
    expect(Object.keys(body.shop as Record<string, unknown>)).toEqual(["slug"]);
    const serialized = JSON.stringify(body);
    for (const term of ["payloads", "manifests", "divers", "crew", "summary", "trip", "blocker"]) {
      expect(serialized).not.toContain(term);
    }
  });

  it("cannot be coaxed into returning roster data by a query string", async () => {
    // The alternative shape considered for this fix was `?identityOnly=1` on
    // the roster route, where forgetting or dropping the flag silently returns
    // the whole board. A separate route cannot fail that way, and this proves
    // it: the handler takes no request at all, so there is no parameter to
    // widen. Called with every flag name that shape would have used.
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, personId));

    for (const query of ["?identityOnly=0", "?identityOnly=false", "?payloads=1", "?full=1"]) {
      const handler = GET as unknown as (request?: Request) => Promise<Response>;
      const response = await handler(
        new Request(`http://localhost/api/offline-manifests/identity${query}`),
      );
      expect(await response.json()).toEqual({ shop: { slug: "blue-mantis" } });
    }
  });

  it("rejects an unauthenticated caller with 401 and no shop", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("shop");
    // Never reached the database — the tenant question is answered from the
    // session or not at all.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a signed-in diver, who has a session but no offline-manifest access", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, personId, ["diver"]));

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("shop");
    // Refused before the database, because the token itself never claimed
    // staff — the live re-check below is for tokens that *did*.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a session carrying no roles at all", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, personId, []));

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("answers for the shop the session is scoped to, never the slug the session claims", async () => {
    // The adversarial case this route exists inside: a device signed in as one
    // shop must never be told it is another, because the offline shell deletes
    // every saved roster whose shop differs from this answer. A tampered or
    // stale `shopSlug` claim on the session must not reach the response — the
    // slug is read from the row `shopId` points at.
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("insert failed");
    const otherStaff = await makeStaff(db, otherShop.id, ["captain"]);

    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(
      sessionFor(otherShop.id, otherStaff, ["captain"], "blue-mantis"),
    );

    const response = await GET();
    expect(await response.json()).toEqual({ shop: { slug: "reef-runners" } });
    expect(otherShop.id).not.toBe(shop.id);
  });

  it("404s when the session's shop no longer exists, rather than guessing one", async () => {
    // A deleted shop must not resolve to some other tenant's slug: the shell
    // treats a non-OK response as "cannot establish the tenant" and purges
    // nothing, which is the safe direction.
    //
    // It stays a 404 and not a 401 only because the shop lookup runs ahead of
    // the live-roles re-check: `loadActiveStaffRoles` is shop-scoped, so it
    // would find no person under a shop id that isn't there and refuse for the
    // wrong reason. Move the two and this goes red — which is the point of
    // keeping it.
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor("00000000-0000-4000-8000-000000000000", personId));

    const response = await GET();
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("shop");
    // The person genuinely is live staff — of a different shop. The 404 is
    // about the tenant, not about them.
    expect(await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL)).toBe(personId);
  });

  it("sets Cache-Control: private, no-store on every response, refusals included", async () => {
    // A cached identity answer on a shared boat tablet inverts the purge: the
    // next shop's browser is told it is the previous shop, so its own captain's
    // manifests get deleted and the previous shop's roster survives. Both
    // directions of the bug this route exists to prevent, at once.
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, personId));
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");

    vi.mocked(auth).mockResolvedValue(null);
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");

    vi.mocked(auth).mockResolvedValue(sessionFor("00000000-0000-4000-8000-000000000000", personId));
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");

    // The live-roles refusal is a fourth branch out of this handler and needs
    // the header just as much: it is still an authenticated, per-session answer,
    // and a proxy that held it would hand the next caller on the tablet a
    // refusal they did not earn.
    const stripped = await makeStaff(db, shop.id, []);
    vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, stripped, ["captain"]));
    const refusal = await GET();
    expect(refusal.status).toBe(401);
    expect(refusal.headers.get("Cache-Control")).toBe("private, no-store");
  });

  /**
   * F4, security review of this PR. The gate above used to read the roles baked
   * into the JWT at sign-in, and no `maxAge` is set on the session
   * (src/lib/auth.config.ts) so NextAuth's 30-day default applies — a staffer
   * removed from the shop kept answering this route's question for a month from
   * any device they were still signed in on.
   *
   * The disclosure *here* is one slug the caller's own token already carries, so
   * these cases are about the gate, not the leak: this route and `/upcoming`
   * must refuse the same callers, and `/upcoming` answers with every diver's
   * name, emergency contact and readiness blocker on the shop's 48-hour board.
   * Two gates that read identically and behave differently is how the next
   * reader picks the wrong one to copy.
   */
  describe("live roles, not the ones the token was stamped with", () => {
    it("refuses a caller whose person_roles rows are gone, token still saying captain", async () => {
      const { db, shop } = await staffContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, stripped, ["captain"]));

      const response = await GET();
      expect(response.status).toBe(401);
      expect(await response.json()).not.toHaveProperty("shop");
    });

    it("refuses a caller demoted to diver, token still saying owner", async () => {
      const { db, shop } = await staffContext();
      const demoted = await makeStaff(db, shop.id, ["diver"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, demoted, ["owner"]));

      const response = await GET();
      expect(response.status).toBe(401);
    });

    it("refuses a disabled account and a deleted person, both still holding a staff token", async () => {
      const { db, shop } = await staffContext();
      const disabled = await makeStaff(db, shop.id, ["captain"], { status: "disabled" });
      const deleted = await makeStaff(db, shop.id, ["captain"], { deleted: true });
      vi.mocked(getDb).mockResolvedValue(db);

      for (const person of [disabled, deleted]) {
        vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, person, ["captain"]));
        expect((await GET()).status).toBe(401);
      }
    });

    it("refuses a token whose personId belongs to another shop's staff", async () => {
      // The re-check is shop-scoped, so this is a second wall in front of the
      // same tenant boundary `shopId` already draws: a forged pairing of this
      // shop's id with a person who is not theirs finds nothing.
      const { db, shop } = await staffContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
        .returning();
      if (!otherShop) throw new Error("insert failed");
      const foreign = await makeStaff(db, otherShop.id, ["owner"]);

      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, foreign, ["owner"]));

      const response = await GET();
      expect(response.status).toBe(401);
      expect(await response.json()).not.toHaveProperty("shop");
    });

    it("admits the same person again the moment a staff role is restored", async () => {
      // The other direction, so the refusals above are not just "this helper
      // always says no". Re-granting the role is enough — no new sign-in.
      const { db, shop } = await staffContext();
      const person = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(sessionFor(shop.id, person, ["captain"]));
      expect((await GET()).status).toBe(401);

      await db.insert(personRoles).values({ personId: person, role: "captain" });
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ shop: { slug: "blue-mantis" } });
    });

    it("refuses on the next request after the role is revoked, without a re-issued token", async () => {
      // The revocation window itself, measured: same session object either side
      // of the delete, and the only thing that changed is a row.
      const { db, shop } = await staffContext();
      const person = await makeStaff(db, shop.id, ["captain"]);
      const session = sessionFor(shop.id, person, ["captain"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(session);
      expect((await GET()).status).toBe(200);

      await db.delete(personRoles).where(eq(personRoles.personId, person));
      expect((await GET()).status).toBe(401);
    });
  });
});
