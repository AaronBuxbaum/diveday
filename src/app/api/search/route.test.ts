import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Same reasoning as src/app/api/trips/[id]/manifest-events/route.test.ts: a
// bare mock avoids ever loading the real next-auth module outside Next's
// bundler.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
// `requestLocale` reads `next/headers`' `headers()`, which only resolves
// inside a real Next request scope — absent here since the route is invoked
// directly. An empty header set negotiates down to the shop's default
// locale, same as a real request that sends no Accept-Language (see
// src/app/api/offline-manifests/upcoming/route.test.ts).
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { GET } = await import("./route");

function searchRequest(query: string) {
  return new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`);
}

const staffSession = (
  shopId: string,
  personId: string,
  roles: Session["user"]["roles"] = ["owner"],
): Session => ({
  user: {
    personId,
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    roles,
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

/**
 * The seeded shop plus one of its *real* staff members.
 *
 * The person id has to be real now: the route re-reads roles from
 * `person_roles` (through `loadActiveStaffRoles`, which also insists on a live
 * `user_accounts` row) on every request, so a made-up `personId` would refuse
 * every request and every result-bearing assertion below would go red for a
 * reason that has nothing to do with what it is testing. Dana Reyes is the
 * seeded owner, which is who this file's session has always claimed to be.
 */
async function staffContext() {
  const { db, shop } = await seededShopContext();
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
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
      fullName: `Search Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `search.staff.${seq}@example.com`,
    hashedPassword: "x",
    status: opts.status ?? "active",
  });
  return person.id;
}

const EMPTY_RESULTS = { divers: [], trips: [], diveSites: [], courses: [], orders: [] };

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("GET /api/search", () => {
  it("rejects an unauthenticated caller with 401, never data — and without touching the database", async () => {
    // The live-roles re-check below needs a database, so this ordering is a
    // property worth pinning rather than an accident: a caller with no session
    // at all must never reach the pool. The palette fires one of these per
    // keystroke, so it is also the cheap path staying cheap.
    vi.mocked(auth).mockResolvedValue(null);
    const response = await GET(searchRequest("priya"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).not.toHaveProperty("divers");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a signed-in caller who isn't staff", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId, []));
    const response = await GET(searchRequest("priya"));
    expect(response.status).toBe(401);
    // Same short-circuit: the token itself never claimed staff, so there is
    // nothing for a live re-check to disagree with.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns the caller's own shop's matches for a query in `q`", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET(searchRequest("priya"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.divers.map((d: { fullName: string }) => d.fullName)).toContain("Priya Sharma");
  });

  it("never returns another shop's people, even when both have a same-named diver", async () => {
    const { db, shop, personId } = await staffContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Second Shop", slug: "second-shop", timezone: "America/New_York" })
      .returning();
    if (!otherShop) throw new Error("insert failed");
    const [otherPriya] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Priya Sharma", email: "priya@second.example" })
      .returning();
    if (!otherPriya) throw new Error("insert failed");

    vi.mocked(getDb).mockResolvedValue(db);
    // Session is scoped to the seeded shop, not the newly-created one — the
    // route must never let a query parameter widen the search beyond the
    // session's own shopId, no matter what the caller sends in `q`.
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET(searchRequest("priya"));
    const body = await response.json();
    expect(body.divers.map((d: { id: string }) => d.id)).not.toContain(otherPriya.id);
  });

  it("sets Cache-Control: private, no-store", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET(searchRequest("priya"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("treats a missing `q` as an empty query rather than throwing", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET(new Request("http://localhost/api/search"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(EMPTY_RESULTS);
  });

  /**
   * The same window `/api/offline-manifests/identity` and `/upcoming` closed
   * (78ba3c4). The gate used to read the roles baked into the JWT at sign-in,
   * and no `maxAge` is set on the session (src/lib/auth.config.ts) so NextAuth's
   * 30-day default applies. `/api/**` is excluded from the edge gate
   * (src/proxy.ts), so this handler is the only wall — which meant a staffer
   * removed from the shop kept a substring search over every diver, trip, dive
   * site, course and order in it, one keystroke at a time, for up to a month.
   */
  describe("live roles, not the ones the token was stamped with", () => {
    it("refuses a caller whose person_roles rows are gone, token still saying owner", async () => {
      const { db, shop } = await staffContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));

      const response = await GET(searchRequest("priya"));
      expect(response.status).toBe(401);
      expect(await response.json()).not.toHaveProperty("divers");
    });

    it("returns no diver, trip, site, course or order to a demoted caller", async () => {
      // The refusal has to be measured against a shop that genuinely matches
      // the query, or "nothing leaked" is a statement about an empty result set.
      // Same request, two callers: one live staff member sees Priya, and the
      // demoted one sees none of the same bytes.
      const { db, shop, personId } = await staffContext();
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));
      expect(await (await GET(searchRequest("priya"))).text()).toContain("Priya Sharma");

      const demoted = await makeStaff(db, shop.id, ["diver"]);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, demoted));
      const refused = await GET(searchRequest("priya"));
      expect(refused.status).toBe(401);
      const body = await refused.text();
      for (const term of ["Priya", "divers", "trips", "diveSites", "courses", "orders"]) {
        expect(body).not.toContain(term);
      }
    });

    it("refuses a disabled account and a deleted person, both still holding a staff token", async () => {
      const { db, shop } = await staffContext();
      const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
      const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });
      vi.mocked(getDb).mockResolvedValue(db);

      for (const person of [disabled, deleted]) {
        vi.mocked(auth).mockResolvedValue(staffSession(shop.id, person));
        expect((await GET(searchRequest("priya"))).status).toBe(401);
      }
    });

    it("refuses a token whose personId belongs to another shop's staff", async () => {
      // The re-check is shop-scoped, so it stands as a second wall in front of
      // the tenant boundary `shopId` already draws: this shop's id paired with a
      // person who is not theirs finds nothing.
      const { db, shop } = await staffContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
        .returning();
      if (!otherShop) throw new Error("insert failed");
      const foreign = await makeStaff(db, otherShop.id, ["owner"]);

      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, foreign));

      expect((await GET(searchRequest("priya"))).status).toBe(401);
    });

    it("refuses on the next keystroke after the role is revoked, without a re-issued token", async () => {
      // The revocation window itself, measured: the same session object either
      // side of the delete, and the only thing that changed is a row. Before
      // this fix the second query still answered with the shop's people.
      const { db, shop } = await staffContext();
      const person = await makeStaff(db, shop.id, ["captain"]);
      const session = staffSession(shop.id, person, ["captain"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(session);
      expect((await GET(searchRequest("priya"))).status).toBe(200);

      await db.delete(personRoles).where(eq(personRoles.personId, person));
      expect((await GET(searchRequest("priya"))).status).toBe(401);
    });

    it("still answers an unresolvable tenant with an empty result set, not a refusal", async () => {
      // The sequencing the sibling routes protect with their 404, in this
      // route's own currency. `loadActiveStaffRoles` is shop-scoped, so running
      // it ahead of the shop lookup would turn a session pointing at a vanished
      // shop into a 401 — where this route has always answered with the constant
      // below, which discloses nothing and lets the palette render "no results"
      // rather than an error. Move the two and this goes red.
      const { db, personId } = await staffContext();
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(
        staffSession("00000000-0000-4000-8000-000000000000", personId),
      );

      const response = await GET(searchRequest("priya"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(EMPTY_RESULTS);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Cache-Control: private, no-store on the live-roles refusal too", async () => {
      // A new branch out of this handler, and still an authenticated,
      // per-session answer: a proxy that held it would hand the next caller on a
      // shared machine a refusal they did not earn.
      const { db, shop } = await staffContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));

      const response = await GET(searchRequest("priya"));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });
});
