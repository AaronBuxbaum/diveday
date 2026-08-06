import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { createTrip } from "@/db/trips";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// See the sync route's test for why `auth` is mocked bare instead of via
// importOriginal (ADR 20260719-msw-offline-sync-only).
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
// `requestLocale` reads `next/headers`' `headers()`, which only resolves
// inside a real Next request scope — absent here since the route is invoked
// directly. An empty header set negotiates down to the shop's default
// locale, same as a real request that sends no Accept-Language.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { GET } = await import("./route");

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
 * The person id has to be real: the route re-reads roles from `person_roles` on
 * every request, so a made-up `personId` would refuse every request and every
 * 200-path assertion below would go red for a reason that has nothing to do
 * with the window it is testing. Dana Reyes is the seeded owner.
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
      fullName: `Upcoming Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `upcoming.staff.${seq}@example.com`,
    hashedPassword: "x",
    status: opts.status ?? "active",
  });
  return person.id;
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("GET /api/offline-manifests/upcoming", () => {
  it("rejects an unauthenticated caller without touching the database", async () => {
    // The live-roles re-check below needs a database, so this ordering is a
    // property worth pinning rather than an accident: a caller with no session
    // at all must never reach the pool. Only an authenticated caller whose token
    // *might* be stale pays for the lookup.
    vi.mocked(auth).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a non-staff caller even with a valid session shape", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue({
      user: { personId: "diver-1", shopId: shop.id, shopSlug: "blue-mantis", roles: ["diver"] },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as Session);

    const response = await GET();
    expect(response.status).toBe(401);
    // Same short-circuit: the token itself never claimed staff, so there is
    // nothing for a live re-check to disagree with.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns trips departing within the 48-hour window and excludes trips beyond it", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      payloads: Array<{ manifests: Array<{ trip: { title: string } }> }>;
    };
    const titles = body.payloads.map((payload) => payload.manifests[0]?.trip.title);

    // Sails today (within the frozen clock's 5-hour lookahead) — well inside 48h.
    expect(titles).toContain("Two-Tank Reef — Molasses & French");
    // Seeded 2 days out at 23:30 UTC, past the 48-hour cutoff from the frozen
    // 13:30 UTC "now" (src/test/frozen-clock.ts) — must not appear.
    expect(titles).not.toContain("Night Dive — City of Washington");
    // Seeded 5+ days out — far outside the window.
    expect(titles).not.toContain("Wreck Trip — Spiegel Grove");
  });

  it("includes a trip already underway, not just ones yet to depart", async () => {
    // The exact scenario the window exists to cover: a trip mid-charter
    // (departed, not yet ended) still needs its after-dive-checkpoint copy
    // auto-saved — startsAt < now must not exclude it, only endsAt < now
    // should (see listTripIdsInOfflineManifestWindow).
    const { db, shop, personId } = await staffContext();
    const now = nowDate();
    const active = await createTrip(db, {
      shopId: shop.id,
      title: "Mid-Charter Two-Tank",
      startsAt: new Date(now.getTime() - 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 60 * 60 * 1000),
      capacity: 6,
    });
    if (!active) throw new Error("failed to seed the active trip fixture");

    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET();
    const body = (await response.json()) as {
      payloads: Array<{ manifests: Array<{ trip: { title: string } }> }>;
    };
    const titles = body.payloads.map((payload) => payload.manifests[0]?.trip.title);
    expect(titles).toContain("Mid-Charter Two-Tank");
  });

  it("never returns another shop's trips", async () => {
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET();
    const body = (await response.json()) as {
      payloads: Array<{ shop: { slug: string } }>;
    };
    for (const payload of body.payloads) {
      expect(payload.shop.slug).toBe("blue-mantis");
    }
  });

  it("always returns the caller's own shop identity, even with zero trips in the window", async () => {
    // The client's cross-tenant purge (purgeOfflineManifestsExceptShop, see
    // ADR 20260726-shopwide-offline-manifest-priming) depends on this being
    // present on every response, not only ones carrying trips — otherwise a
    // shop with nothing sailing in the next 48 hours would never learn "you
    // are signed in as this shop" and stale records from a previous shop on
    // this device would never get purged.
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET();
    const body = (await response.json()) as { shop: { slug: string } };
    expect(body.shop.slug).toBe("blue-mantis");
  });

  it("answers under exactly the keys its readers destructure", async () => {
    // The service worker read `body.manifests` — the key *inside* a payload,
    // not the one beside it — so `refreshSavedManifests` looped zero times on
    // every push, silently, on a locked phone with nobody to tell. Both readers
    // now go through `OfflineManifestUpcomingResponse`, so a rename is a
    // typecheck failure; this is the other half of that guard, from the wire.
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["payloads", "shop"]);
    expect(Array.isArray(body.payloads)).toBe(true);
  });

  it("sets Cache-Control: private, no-store on every response, refusals included", async () => {
    // This body is a shop's whole 48-hour board — diver names, emergency
    // contacts, readiness blockers — fetched onto a shared boat tablet. It
    // belongs in the encrypted IndexedDB store and in no other cache: not a
    // shared proxy's, not the browser's disk cache, not a back/forward replay
    // (review 20260802, action item 12).
    const { db, shop, personId } = await staffContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");

    vi.mocked(auth).mockResolvedValue(null);
    expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");

    // The live-roles refusal is a new branch out of this handler and needs the
    // header just as much: still an authenticated, per-session answer on the
    // shared tablet, and a proxy that held it would hand the next caller a
    // refusal they did not earn.
    const stripped = await makeStaff(db, shop.id, []);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));
    const refusal = await GET();
    expect(refusal.status).toBe(401);
    expect(refusal.headers.get("Cache-Control")).toBe("private, no-store");
  });

  /**
   * F4, security review of this PR. The gate used to read the roles baked into
   * the JWT at sign-in, and no `maxAge` is set on the session
   * (src/lib/auth.config.ts) so NextAuth's 30-day default applies. `/api/**` is
   * excluded from the edge gate (src/proxy.ts ~112), so this handler is the only
   * wall — which meant a staffer removed from the shop kept pulling its entire
   * 48-hour board, diver names and emergency contacts and medical/readiness
   * blockers, from any device they were still signed in on, for up to a month.
   */
  describe("live roles, not the ones the token was stamped with", () => {
    it("refuses a caller whose person_roles rows are gone, token still saying owner", async () => {
      const { db, shop } = await staffContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));

      const response = await GET();
      expect(response.status).toBe(401);
      // Not merely "no payloads" — nothing about the board comes back at all.
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("payloads");
      expect(body).not.toHaveProperty("shop");
    });

    it("returns no diver name, emergency contact, or readiness blocker to a demoted caller", async () => {
      // The refusal has to be measured against a board that genuinely has
      // people on it, or "nothing leaked" is a statement about an empty shop.
      // Same request, two callers: one live staff member sees names, and the
      // demoted one sees none of the same bytes.
      const { db, shop, personId } = await staffContext();
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));
      const allowed = await (await GET()).text();
      expect(allowed).toContain("emergencyContact");

      const demoted = await makeStaff(db, shop.id, ["diver"]);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, demoted));
      const refused = await GET();
      expect(refused.status).toBe(401);
      const refusedBody = await refused.text();
      for (const term of ["emergencyContact", "blockers", "manifests", "divers", "payloads"]) {
        expect(refusedBody).not.toContain(term);
      }
    });

    it("refuses a disabled account and a deleted person, both still holding a staff token", async () => {
      const { db, shop } = await staffContext();
      const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
      const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });
      vi.mocked(getDb).mockResolvedValue(db);

      for (const person of [disabled, deleted]) {
        vi.mocked(auth).mockResolvedValue(staffSession(shop.id, person));
        expect((await GET()).status).toBe(401);
      }
    });

    it("refuses a token whose personId belongs to another shop's staff", async () => {
      // The re-check is shop-scoped, so it stands as a second wall in front of
      // the tenant boundary `shopId` already draws: this shop's id paired with
      // a person who is not theirs finds nothing.
      const { db, shop } = await staffContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
        .returning();
      if (!otherShop) throw new Error("insert failed");
      const foreign = await makeStaff(db, otherShop.id, ["owner"]);

      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, foreign));

      expect((await GET()).status).toBe(401);
    });

    it("refuses on the next request after the role is revoked, without a re-issued token", async () => {
      // The revocation window itself, measured: the same session object either
      // side of the delete, and the only thing that changed is a row. Before
      // this fix the second call still returned the whole board.
      const { db, shop } = await staffContext();
      const person = await makeStaff(db, shop.id, ["captain"]);
      const session = staffSession(shop.id, person, ["captain"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(session);
      expect((await GET()).status).toBe(200);

      await db.delete(personRoles).where(eq(personRoles.personId, person));
      expect((await GET()).status).toBe(401);
    });
  });
});
