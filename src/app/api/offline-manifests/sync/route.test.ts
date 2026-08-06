import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, rollCallEvents, shops, userAccounts } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Not importOriginal()'d: the real module pulls in next-auth, which this
// preview-track Next/next-auth combo can't resolve outside Next's own
// bundler (see ADR 20260719-msw-offline-sync-only). The route only needs
// `auth`, so a bare mock avoids ever loading the real module. `auth`'s real
// type is NextAuth's overloaded (session-getter | middleware) signature,
// which confuses `vi.mocked()`'s overload resolution — type the mock
// directly as the narrow shape this route actually calls.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { POST } = await import("./route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * The seeded shop, one of its trips with a real booking on it, and one of its
 * *real* staff members.
 *
 * The person id has to be real, and it now has to be a person with an active
 * account as well: the route re-reads roles from `person_roles` (through
 * `loadActiveStaffRoles`, which also insists on a live `user_accounts` row) on
 * every request, so anyone else would be refused before the write and every
 * applied-path assertion below would go red for the wrong reason. Dana Reyes is
 * the seeded owner, which is who this file's session has always claimed to be.
 */
async function seededContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((t) => t.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("expected seeded trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  const [row] = roster;
  if (!row) throw new Error("expected seeded booking missing");
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, trip, booking: row.booking, staffPersonId };
}

const staffSession = (
  shopId: string,
  personId: string,
  roles: Session["user"]["roles"] = ["owner"],
): Session => ({
  user: { personId, shopId, shopSlug: "blue-mantis", name: "Dana Reyes", roles },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

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
      fullName: `Sync Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `sync.staff.${seq}@example.com`,
    hashedPassword: "x",
    status: opts.status ?? "active",
  });
  return person.id;
}

/**
 * One well-formed offline roll-call event, `not_boarded` by default.
 *
 * `not_boarded` on purpose: `recordRollCall` refuses to *board* a diver who
 * isn't ready, and every seeded booking starts blocked, so a boarding event
 * would be rejected on readiness grounds and could never tell whether the
 * authorization gate did anything. A `not_boarded` event is one this route
 * genuinely applies — which is what makes "and nothing was written" an
 * assertion with something to catch.
 */
function rollCallEvent(input: { bookingId: string; tripId: string; status?: string }) {
  const now = nowDate().toISOString();
  return {
    clientEventId: crypto.randomUUID(),
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: now,
    bookingId: input.bookingId,
    tripId: input.tripId,
    checkpoint: "departure",
    status: input.status ?? "not_boarded",
    note: null,
    occurredAt: now,
  };
}

/** Every roll-call row in the shop, so a refusal can be measured as an absence. */
async function rollCallEventIds(db: AppDb, shopId: string): Promise<string[]> {
  const rows = await db
    .select({ id: rollCallEvents.id })
    .from(rollCallEvents)
    .where(eq(rollCallEvents.shopId, shopId));
  return rows.map((row) => row.id);
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("POST /api/offline-manifests/sync", () => {
  it("rejects an unauthenticated caller without touching the database", async () => {
    // The live-roles re-check below needs a database, so this ordering is a
    // property worth pinning rather than an accident: a caller with no session
    // at all must never reach the pool. Only an authenticated caller whose token
    // *might* be stale pays for the lookup.
    vi.mocked(auth).mockResolvedValue(null);
    const response = await POST(postRequest({ events: [] }));
    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a non-staff caller even with a valid session shape", async () => {
    const { db, shop } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue({
      user: { personId: "diver-1", shopId: shop.id, shopSlug: "blue-mantis", roles: ["diver"] },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as Session);

    const response = await POST(postRequest({ events: [] }));
    expect(response.status).toBe(401);
    // Same short-circuit: the token itself never claimed staff, so there is
    // nothing for a live re-check to disagree with.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const { db, shop, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const response = await POST(postRequest({ events: [] }, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("rejects a malformed event payload", async () => {
    const { db, shop, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const response = await POST(postRequest({ events: [{ status: "boarded" }] }));
    expect(response.status).toBe(400);
  });

  it("applies a valid roll-call event and reports it back by client event id", async () => {
    const { db, shop, trip, booking, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const clientEventId = crypto.randomUUID();
    const now = nowDate().toISOString();
    const response = await POST(
      postRequest({
        events: [
          {
            clientEventId,
            snapshotId: crypto.randomUUID(),
            snapshotSavedAt: now,
            bookingId: booking.id,
            tripId: trip.id,
            checkpoint: "departure",
            status: "not_boarded",
            note: null,
            occurredAt: now,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ clientEventId: string; status: string }>;
    };
    expect(body.results).toEqual([{ clientEventId, status: "applied" }]);
  });

  it("rejects boarding a diver who isn't ready instead of silently applying it", async () => {
    // Seeded bookings start blocked (no waiver signed yet) — see
    // src/db/manifests.test.ts's "derives every active booking ... blocked".
    const { db, shop, trip, booking, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const clientEventId = crypto.randomUUID();
    const now = nowDate().toISOString();
    const response = await POST(
      postRequest({
        events: [
          {
            clientEventId,
            snapshotId: crypto.randomUUID(),
            snapshotSavedAt: now,
            bookingId: booking.id,
            tripId: trip.id,
            checkpoint: "departure",
            status: "boarded",
            note: null,
            occurredAt: now,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ clientEventId: string; status: string; reason?: string }>;
    };
    expect(body.results).toEqual([{ clientEventId, status: "rejected", reason: "not_ready" }]);
  });

  it("resubmitting the same offline event is idempotent, not a second roll-call record", async () => {
    const { db, shop, trip, booking, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const clientEventId = crypto.randomUUID();
    const now = nowDate().toISOString();
    const event = {
      clientEventId,
      snapshotId: crypto.randomUUID(),
      snapshotSavedAt: now,
      bookingId: booking.id,
      tripId: trip.id,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
      occurredAt: now,
    };

    const first = await POST(postRequest({ events: [event] }));
    const firstBody = (await first.json()) as { results: Array<{ status: string }> };
    expect(firstBody.results).toEqual([{ clientEventId, status: "applied" }]);

    // Same clientEventId again — the boat's connection dropped mid-ack and the
    // device resent it. Must not be recorded twice.
    const second = await POST(postRequest({ events: [event] }));
    const secondBody = (await second.json()) as { results: Array<{ status: string }> };
    expect(secondBody.results).toEqual([{ clientEventId, status: "duplicate" }]);
  });

  /**
   * The write side of the same window `/api/offline-manifests/identity` and
   * `/upcoming` closed (78ba3c4). The gate used to read the roles baked into the
   * JWT at sign-in, and no `maxAge` is set on the session
   * (src/lib/auth.config.ts) so NextAuth's 30-day default applies. `/api/**` is
   * excluded from the edge gate (src/proxy.ts), so this handler is the only wall
   * — which meant a staffer removed from the shop could keep *writing* roll call
   * for up to a month, from any device they were still signed in on.
   *
   * Roll call is the record of who came back from a dive. The read routes leaked
   * a board; this one accepts entries into the log a shop would reach for after
   * someone did not surface, so its failure paths are the ones worth being
   * boring about.
   *
   * `recordRollCall` does carry its own staff check, and it catches two of these
   * five (no roles, demoted) — but only two, and only as a per-event `rejected`
   * result inside a 200. It joins `person_roles` and stops there, so a deleted
   * person and a disabled account still wrote the row before this gate existed.
   * Those two cases assert the absence of the row, not just the status code.
   */
  describe("live roles, not the ones the token was stamped with", () => {
    it("refuses a caller whose person_roles rows are gone, token still saying owner", async () => {
      const { db, shop, trip, booking } = await seededContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));

      const response = await POST(
        postRequest({ events: [rollCallEvent({ bookingId: booking.id, tripId: trip.id })] }),
      );
      expect(response.status).toBe(401);
      // Not a 200 whose `results` say "rejected": the request is refused, so the
      // device keeps its events pending and retries rather than marking them
      // settled and letting the next purge take the evidence with it.
      expect(await response.json()).not.toHaveProperty("results");
    });

    it("refuses a caller demoted to diver, token still saying owner", async () => {
      const { db, shop, trip, booking } = await seededContext();
      const demoted = await makeStaff(db, shop.id, ["diver"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, demoted));

      const response = await POST(
        postRequest({ events: [rollCallEvent({ bookingId: booking.id, tripId: trip.id })] }),
      );
      expect(response.status).toBe(401);
    });

    it("writes nothing for a deleted person or a disabled account still holding a staff token", async () => {
      // The worst outcome this fix exists to prevent, and the two cases that
      // actually produced it: `recordRollCall`'s own staff join checks neither
      // `people.deleted_at` nor `user_accounts.status`, so before this gate both
      // of these appended a real roll-call row — a head count attributed to
      // someone the shop had already removed. A 401 that still wrote the row
      // would be worse than no 401 at all, so this measures the table, not the
      // status code alone.
      const { db, shop, trip, booking } = await seededContext();
      const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });
      const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
      vi.mocked(getDb).mockResolvedValue(db);

      const before = await rollCallEventIds(db, shop.id);
      const statuses: number[] = [];
      const wrote: string[] = [];
      for (const [label, person] of [
        ["deleted person", deleted],
        ["disabled account", disabled],
      ] as const) {
        vi.mocked(auth).mockResolvedValue(staffSession(shop.id, person));
        const event = rollCallEvent({ bookingId: booking.id, tripId: trip.id });
        statuses.push((await POST(postRequest({ events: [event] }))).status);
        const [row] = await db
          .select({ id: rollCallEvents.id })
          .from(rollCallEvents)
          .where(eq(rollCallEvents.clientEventId, event.clientEventId));
        if (row) wrote.push(label);
      }
      // Collected and asserted after the loop, so deleting the gate reports the
      // row that got written rather than only the status code that changed.
      expect(wrote).toEqual([]);
      expect(statuses).toEqual([401, 401]);
      // Nothing under another id either — the refusal is an absence in the whole
      // table, not just of the event the caller named.
      expect(await rollCallEventIds(db, shop.id)).toEqual(before);
    });

    it("refuses a token whose personId belongs to another shop's staff", async () => {
      // The re-check is shop-scoped, so it stands as a second wall in front of
      // the tenant boundary `shopId` already draws: this shop's id paired with a
      // person who is not theirs finds nothing.
      const { db, shop, trip, booking } = await seededContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
        .returning();
      if (!otherShop) throw new Error("insert failed");
      const foreign = await makeStaff(db, otherShop.id, ["owner"]);

      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, foreign));

      const response = await POST(
        postRequest({ events: [rollCallEvent({ bookingId: booking.id, tripId: trip.id })] }),
      );
      expect(response.status).toBe(401);
    });

    it("refuses on the next request after the role is revoked, without a re-issued token", async () => {
      // The revocation window itself, measured: the same session object either
      // side of the delete, and the only thing that changed is a row. Before
      // this fix the second write was applied and became part of the record.
      const { db, shop, trip, booking } = await seededContext();
      const person = await makeStaff(db, shop.id, ["captain"]);
      const session = staffSession(shop.id, person, ["captain"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(session);

      const applied = rollCallEvent({ bookingId: booking.id, tripId: trip.id });
      const first = await POST(postRequest({ events: [applied] }));
      expect(first.status).toBe(200);
      expect((await first.json()).results).toEqual([
        { clientEventId: applied.clientEventId, status: "applied" },
      ]);

      await db.delete(personRoles).where(eq(personRoles.personId, person));

      const refused = rollCallEvent({ bookingId: booking.id, tripId: trip.id });
      const second = await POST(postRequest({ events: [refused] }));
      expect(second.status).toBe(401);
      const [written] = await db
        .select({ id: rollCallEvents.id })
        .from(rollCallEvents)
        .where(eq(rollCallEvents.clientEventId, refused.clientEventId));
      expect(written).toBeUndefined();
    });

    it("applies again the moment a staff role is restored", async () => {
      // The other direction, so the refusals above are not just "this helper
      // always says no". Re-granting the role is enough — no new sign-in.
      const { db, shop, trip, booking } = await seededContext();
      const person = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, person));
      expect(
        (
          await POST(
            postRequest({ events: [rollCallEvent({ bookingId: booking.id, tripId: trip.id })] }),
          )
        ).status,
      ).toBe(401);

      await db.insert(personRoles).values({ personId: person, role: "captain" });
      const event = rollCallEvent({ bookingId: booking.id, tripId: trip.id });
      const response = await POST(postRequest({ events: [event] }));
      expect(response.status).toBe(200);
      expect((await response.json()).results).toEqual([
        { clientEventId: event.clientEventId, status: "applied" },
      ]);
    });

    it("never parses an unauthorized caller's body: a malformed batch is refused as 401, not 400", async () => {
      // The gate sits ahead of the content-type and schema checks on purpose.
      // A caller who is not live staff gets one answer to every request shape,
      // so nothing they send is read, and they cannot use the difference between
      // 415, 400 and 200 to learn anything about the endpoint. Both of these are
      // 415/400 for a live staff member (two tests above), which is what makes
      // this an ordering assertion and not a restatement.
      const { db, shop } = await seededContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));

      const wrongType = await POST(postRequest({ events: [] }, { "content-type": "text/plain" }));
      expect(wrongType.status).toBe(401);

      const malformed = await POST(postRequest({ events: [{ status: "boarded" }] }));
      expect(malformed.status).toBe(401);
    });
  });
});
