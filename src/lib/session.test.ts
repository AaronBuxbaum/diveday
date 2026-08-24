import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * `requireShopSurface` is the preamble every staff page runs before it reads a
 * row: who is asking, which shop they are on, and whether their live roles
 * still allow this surface. It is therefore an authz helper, and the failure
 * mode that matters is not "wrong words in the banner" — it is **returning at
 * all** after deciding against the caller.
 *
 * A gate that returned `{ allowed: false }` instead of throwing would compile,
 * pass review, and render another tenant's page the first time a caller forgot
 * to branch on it. So the assertions below are mostly about the *absence* of a
 * return value: every refusal path is asserted to unwind, and asserted not to
 * hand back a shop.
 *
 * `notFound()` and `redirect()` are mocked to throw, exactly as Next's real
 * ones do (both are typed `never`).
 */

class NotFoundError extends Error {}
class RedirectError extends Error {}

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new RedirectError(to);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { isLiveShopStaff, requireShopSurface, requireStaffSession } = await import("./session");

/**
 * NextAuth's `auth` is overloaded (route handler, middleware, and the
 * no-argument session reader). Only the last overload is ever called here, and
 * `vi.mocked` resolves against the first — so the mock is narrowed to the
 * signature under test rather than each call site being cast.
 */
const authMock = vi.mocked(auth as unknown as () => Promise<unknown>);

type Context = Awaited<ReturnType<typeof seededShopContext>>;

let context: Context;

beforeEach(async () => {
  vi.clearAllMocks();
  context = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(context.db);
});

function signIn(input: { shopId?: string; personId: string; roles?: string[] }) {
  authMock.mockResolvedValue({
    user: {
      personId: input.personId,
      shopId: input.shopId ?? context.shop.id,
      shopSlug: context.shop.slug,
      roles: input.roles ?? ["captain"],
      name: "Seeded staff",
    },
    expires: "2099-01-01T00:00:00.000Z",
  });
}

/** The error a refusal unwound with, or a failure if it returned instead. */
async function refusal(run: () => Promise<unknown>): Promise<Error> {
  let returned: unknown;
  try {
    returned = await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error(
    `requireShopSurface returned instead of refusing: ${JSON.stringify(returned && Object.keys(returned))}`,
  );
}

describe("requireStaffSession", () => {
  it("sends a signed-out visitor to sign in", async () => {
    authMock.mockResolvedValue(null);
    const error = await refusal(() => requireStaffSession());
    expect(error).toBeInstanceOf(RedirectError);
    expect(error.message).toBe("/sign-in");
  });

  it("sends a signed-in non-staff visitor to sign in", async () => {
    signIn({ personId: "whoever", roles: ["diver"] });
    const error = await refusal(() => requireStaffSession());
    expect(error).toBeInstanceOf(RedirectError);
    expect(error.message).toBe("/sign-in");
  });

  it("passes a real, active staff member through", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    signIn({ personId: owner });
    const session = await requireStaffSession();
    expect(session.user.personId).toBe(owner);
  });

  /**
   * **Issue #701.** Sessions are stateless 30-day JWTs with no built-in
   * re-validation — before this fix, a disabled account's already-issued
   * session kept passing `requireStaffSession()` (and therefore every
   * ordinary `/shop/**` page) because only `isStaff(session.user.roles)`,
   * the *cached* claim, was ever checked. This is the scenario the issue
   * asked to be verified and fixed first, ahead of anything else in it.
   */
  it("ends a session the moment its account is disabled, even with unchanged JWT claims", async () => {
    const captain = await seededStaffPersonId(context.db, context.shop.id, SEEDED_CAPTAIN_EMAIL);
    // The JWT is untouched — same roles it had at sign-in — only the
    // database row changes, exactly as it would for a real disabled session
    // that hasn't hit its 30-day expiry yet.
    signIn({ personId: captain, roles: ["captain"] });
    await context.db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, captain));

    const error = await refusal(() => requireStaffSession());
    expect(error).toBeInstanceOf(RedirectError);
    // Distinct from a plain `/sign-in`: the edge `authorized()` callback
    // (src/lib/auth.config.ts) reads this exact param to stop bouncing the
    // request straight back to `/shop/<slug>` off the same stale JWT, which
    // would otherwise loop forever between the two layers.
    expect(error.message).toBe("/sign-in?session=ended");
  });

  it("ends a session for a person removed from the shop entirely, not only a disabled one", async () => {
    const captain = await seededStaffPersonId(context.db, context.shop.id, SEEDED_CAPTAIN_EMAIL);
    signIn({ personId: captain, roles: ["captain"] });
    await context.db.delete(personRoles).where(eq(personRoles.personId, captain));

    const error = await refusal(() => requireStaffSession());
    expect(error.message).toBe("/sign-in?session=ended");
  });
});

describe("requireShopSurface", () => {
  it("resolves the session's own shop for a staff member on its slug", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    signIn({ personId: owner });
    const surface = await requireShopSurface(context.shop.slug);
    expect(surface.shop.id).toBe(context.shop.id);
    expect(surface.session.user.personId).toBe(owner);
    expect(surface.db).toBe(context.db);
  });

  it("sends a signed-out visitor to sign in before it reads anything", async () => {
    authMock.mockResolvedValue(null);
    const error = await refusal(() => requireShopSurface(context.shop.slug));
    expect(error).toBeInstanceOf(RedirectError);
    expect(error.message).toBe("/sign-in");
    // The gate runs first: no shop row was ever fetched for a visitor with no
    // session to scope it to.
    expect(getDb).not.toHaveBeenCalled();
  });

  /**
   * The tenant assert. The staff layout refuses a mismatched slug too, but a
   * layout is chrome — this is the copy that travels with the read.
   */
  it("404s a staff member visiting another shop's slug rather than rendering their own rows", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    signIn({ personId: owner });
    const error = await refusal(() => requireShopSurface("some-other-shop"));
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("404s when the session points at a shop row that is gone", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    signIn({ personId: owner, shopId: "00000000-0000-4000-8000-000000000000" });
    const error = await refusal(() => requireShopSurface(context.shop.slug));
    // Never `return null` (a blank 200 that says nothing) and never
    // `redirect("/")` (which ejects a signed-in staffer out to marketing) —
    // both of which this settled.
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("passes a live gate the staff member's real roles satisfy", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    signIn({ personId: owner });
    const { canPersonManageShopSettings } = await import("@/db/authz");
    const surface = await requireShopSurface(context.shop.slug, {
      allow: canPersonManageShopSettings,
      refusal: { notice: "settings-not-authorized" },
    });
    expect(surface.shop.id).toBe(context.shop.id);
  });

  it("redirects with a notice — and does not return — when the live gate refuses", async () => {
    const captain = await seededStaffPersonId(context.db, context.shop.id, SEEDED_CAPTAIN_EMAIL);
    // A stale or forged JWT claiming owner: the gate re-reads the database, so
    // the roles here are deliberately inflated and deliberately ignored.
    signIn({ personId: captain, roles: ["owner", "manager"] });
    const { canPersonManageShopSettings } = await import("@/db/authz");
    const error = await refusal(() =>
      requireShopSurface(context.shop.slug, {
        allow: canPersonManageShopSettings,
        refusal: { notice: "settings-not-authorized" },
      }),
    );
    expect(error).toBeInstanceOf(RedirectError);
    expect(error.message).toBe(`/shop/${context.shop.slug}?notice=settings-not-authorized`);
  });

  it("sends a refusal to the landing it was given when Today is the wrong door", async () => {
    const captain = await seededStaffPersonId(context.db, context.shop.id, SEEDED_CAPTAIN_EMAIL);
    signIn({ personId: captain });
    const { canPersonManageShopSettings } = await import("@/db/authz");
    const error = await refusal(() =>
      requireShopSurface(context.shop.slug, {
        allow: canPersonManageShopSettings,
        refusal: { notice: "log-not-authorized", landing: ["close-out"] },
      }),
    );
    expect(error.message).toBe(`/shop/${context.shop.slug}/close-out?notice=log-not-authorized`);
  });

  /**
   * The refusal target is a string that goes straight into `redirect()`. It is
   * built from `shop.slug` — the row the session resolved — and escaped
   * segments, so no caller can steer it out of this shop's namespace even by
   * asking to.
   */
  it("builds the refusal inside this shop's namespace whatever the landing says", async () => {
    const captain = await seededStaffPersonId(context.db, context.shop.id, SEEDED_CAPTAIN_EMAIL);
    signIn({ personId: captain });
    const { canPersonManageShopSettings } = await import("@/db/authz");
    const error = await refusal(() =>
      requireShopSurface(context.shop.slug, {
        allow: canPersonManageShopSettings,
        refusal: { notice: "not-authorized", landing: ["../../admin"] },
      }),
    );
    expect(error.message).toBe(`/shop/${context.shop.slug}/..%2F..%2Fadmin?notice=not-authorized`);
  });

  /**
   * Ordering. The tenant assert has to run *before* the gate, or a staff member
   * on another shop's slug gets that shop's permission question asked about
   * them. The code is right; without this a reorder would stay green.
   */
  it("404s a mismatched slug before it ever asks the permission gate", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    signIn({ personId: owner });
    const allow = vi.fn(async () => true);
    const error = await refusal(() =>
      requireShopSurface("some-other-shop", {
        allow,
        refusal: { notice: "not-authorized" },
      }),
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect(allow).not.toHaveBeenCalled();
  });

  /**
   * The gate is a function rather than a boolean the caller pre-computes,
   * which means it must actually be called — with the shop and person the
   * surface resolved, never with anything the URL supplied.
   */
  it("hands the live gate the resolved shop and the session's person", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    signIn({ personId: owner });
    const allow = vi.fn(async () => true);
    await requireShopSurface(context.shop.slug, {
      allow,
      refusal: { notice: "not-authorized" },
    });
    expect(allow).toHaveBeenCalledWith(context.db, context.shop.id, owner);
  });
});

/**
 * The public `/s/[shopSlug]/**` surfaces (the course page, the trip page, the
 * layout's "you work here" bar) can never call `requireStaffSession()` — a
 * genuine diver visitor must not be redirected to `/sign-in` — so they gate a
 * staff-only preview with this instead. It takes a session directly rather
 * than calling `auth()` itself, so these tests build one with `staffSession()`
 * rather than mocking the module.
 */
describe("isLiveShopStaff", () => {
  it("is false for a signed-out visitor", async () => {
    expect(await isLiveShopStaff(context.db, context.shop.id, null)).toBe(false);
  });

  it("is true for a real, active staff member of this shop", async () => {
    const owner = await seededStaffPersonId(context.db, context.shop.id, SEEDED_OWNER_EMAIL);
    const session = staffSession({
      shopId: context.shop.id,
      shopSlug: context.shop.slug,
      personId: owner,
      roles: ["owner"],
    });
    expect(await isLiveShopStaff(context.db, context.shop.id, session)).toBe(true);
  });

  /**
   * Issue #966. These pages used to compare only `isStaff(session.user.roles)`
   * — the cached JWT claim — against `session.user.shopId === shop.id`, so a
   * disabled staffer's already-issued 30-day session could still unlock a
   * shop's unpublished course preview. Same shape as issue #701's fix to
   * `requireStaffSession()`, just returning `false` here instead of
   * redirecting, since these callers must render the ordinary public page for
   * anyone this returns false for rather than bouncing them anywhere.
   */
  it("is false for a disabled staffer's stale session, even with unchanged JWT claims", async () => {
    const captain = await seededStaffPersonId(context.db, context.shop.id, SEEDED_CAPTAIN_EMAIL);
    await context.db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, captain));
    const session = staffSession({
      shopId: context.shop.id,
      shopSlug: context.shop.slug,
      personId: captain,
    });
    expect(await isLiveShopStaff(context.db, context.shop.id, session)).toBe(false);
  });

  it("is false for a person demoted off every staff role, not only a disabled account", async () => {
    const captain = await seededStaffPersonId(context.db, context.shop.id, SEEDED_CAPTAIN_EMAIL);
    await context.db.delete(personRoles).where(eq(personRoles.personId, captain));
    const session = staffSession({
      shopId: context.shop.id,
      shopSlug: context.shop.slug,
      personId: captain,
    });
    expect(await isLiveShopStaff(context.db, context.shop.id, session)).toBe(false);
  });

  it("is false for a real, active staff member of a different shop", async () => {
    const [otherShop] = await context.db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("failed to insert other shop");
    const [otherPerson] = await context.db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Other Owner", email: "other-owner@example.com" })
      .returning();
    if (!otherPerson) throw new Error("failed to insert other shop's staff person");
    await context.db.insert(personRoles).values({ personId: otherPerson.id, role: "owner" });
    await context.db.insert(userAccounts).values({
      personId: otherPerson.id,
      email: "other-owner@example.com",
      hashedPassword: "x",
      status: "active",
    });
    const session = staffSession({
      shopId: otherShop.id,
      shopSlug: otherShop.slug,
      personId: otherPerson.id,
      roles: ["owner"],
    });
    expect(await isLiveShopStaff(context.db, context.shop.id, session)).toBe(false);
  });
});
