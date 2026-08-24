import { notFound, redirect } from "next/navigation";
import type { Session } from "next-auth";
import { loadActiveStaffRoles, loadActiveStaffRolesByPerson } from "@/db/authz";
import type { AppDb } from "@/db/client";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * Server-side staff gate for /shop surfaces. The proxy already blocks these
 * routes at the edge; this is the inner layer that server code must still
 * call (ADR-0006).
 *
 * **Every call re-reads the account live** (issue #701), not only the H-14
 * role-specific gates. Sessions are stateless 30-day JWTs
 * (`src/lib/auth.config.ts`) with no built-in re-validation, so before this,
 * `isStaff(session.user.roles)` trusted claims cached at sign-in — a
 * disabled, deleted, or fully-demoted staff member kept every ordinary
 * `/shop/**` surface working for up to 30 days, because only the ~12
 * `canPerson*`-gated actions ever called `loadActiveStaffRoles` themselves.
 * This reuses `loadActiveStaffRolesByPerson`, the person-scoped sibling of
 * the same query the H-14 gates already run, so "disabled" means the same
 * thing everywhere in one query shape rather than a second copy of it here.
 * Person-scoped rather than shop-scoped deliberately: this runs before any
 * shop has been resolved from the session's own claim, so re-verifying that
 * claim here would conflate "the account is gone" with "the token's shopId
 * is stale" — the second is `requireShopSurface`'s tenant assert to catch,
 * not this function's.
 */
export async function requireStaffSession() {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) redirect("/sign-in");
  const db = await getDb();
  const liveRoles = await loadActiveStaffRolesByPerson(db, session.user.personId);
  // `!isStaff(liveRoles)` catches a demotion off every staff role, the same
  // way `!liveRoles` catches disabled/deleted — both are "this token no
  // longer describes someone who belongs here", and the edge proxy's
  // `authorized()` callback stops bouncing a matching request away from
  // `/sign-in` for exactly this reason (see its own doc comment).
  if (!liveRoles || !isStaff(liveRoles)) redirect("/sign-in?session=ended");
  return session;
}

/**
 * Whether the signed-in session is a *live*, active staff member of this shop
 * — for the public `/s/[shopSlug]/**` surfaces, which can never call
 * `requireStaffSession()` themselves (a genuine diver visitor must not be
 * redirected to `/sign-in`) but still gate a staff-only preview off session
 * state. `requireStaffSession()` closed this gap for `/shop/**` (issue #701);
 * these callers compared only `isStaff(session.user.roles)` against the
 * cached JWT, so a disabled, deleted, or demoted staffer's already-issued
 * 30-day token kept unlocking a staff-only preview here too (issue #966).
 * Shop-scoped like `loadActiveStaffRoles` itself: every caller here already
 * has the shop row resolved, so this also replaces the separate
 * `session.user.shopId === shop.id` JWT-claim comparison those call sites
 * used to make alongside it.
 */
export async function isLiveShopStaff(
  db: AppDb,
  shopId: string,
  session: Session | null,
): Promise<boolean> {
  if (!session?.user) return false;
  const liveRoles = await loadActiveStaffRoles(db, shopId, session.user.personId);
  return isStaff(liveRoles ?? undefined);
}

/**
 * A live, database-checked permission predicate — the shape every H-14 gate in
 * `src/db/authz.ts` already has (`canPersonViewShopReports`,
 * `canPersonManageWaiverTemplates`, …). Named as a type so `requireShopSurface`
 * takes the gate itself rather than a pre-computed boolean: a boolean parameter
 * would be evaluated by the caller, which is exactly the step that gets
 * forgotten.
 *
 * `AppDb`, not the wider `DbExecutor` those gates mostly declare: a surface
 * gate always runs on the pool, never inside a transaction, and the narrower
 * parameter keeps a gate written against `AppDb` (`canPersonExportShopData`)
 * assignable here.
 */
export type ShopSurfaceGate = (db: AppDb, shopId: string, personId: string) => Promise<boolean>;

/**
 * A gate always comes with somewhere to send the staffer it refuses. Spelling
 * the options as a union rather than two optional fields makes "gated with no
 * refusal destination" a *compile* error — a refusal that lands nowhere is the
 * silent-failure shape this whole helper exists to remove.
 */
export type ShopSurfaceOptions =
  | { allow?: undefined; refusal?: undefined }
  | {
      allow: ShopSurfaceGate;
      /**
       * `notice` is the code the destination's map resolves to words. `landing`
       * names the surface to bounce to, as path segments *under this shop* —
       * `["close-out"]` for the departure log's owner-only gate. It defaults to
       * the shop's Today page, which already renders `shopHome.notice.*` codes
       * and is the nearest surface every staff role can see.
       *
       * Segments rather than a free-form `path` deliberately: a refusal target
       * is a string that goes straight into `redirect()`, and the type is the
       * only thing standing between that and an arbitrary one. Everything here
       * is resolved through `shopPath(shop.slug, …)` — the *database's* slug,
       * never the caller's — so a refusal cannot leave this shop's namespace
       * however it is called.
       */
      refusal: { notice: string; landing?: (string | number)[] };
    };

/**
 * What a staff surface has resolved before it reads anything: who is asking,
 * the connection to ask on, and the one shop row every query below it scopes
 * to. Returned as a record so a page destructures only the parts it uses.
 */
export type ShopSurface = {
  session: Awaited<ReturnType<typeof requireStaffSession>>;
  db: AppDb;
  shop: NonNullable<Awaited<ReturnType<typeof getShopById>>>;
};

/**
 * The preamble every staff page and page-level action runs, composed once.
 *
 * Before this, ~50 files hand-assembled the same four steps, and the assembly
 * had drifted: "which shop am I on" had four spellings, and "the shop row is
 * missing" had *five* outcomes for one condition — `notFound()`, `return null`
 * (a blank 200 with no 404), `redirect("/")` (which ejects a signed-in staffer
 * out to marketing), `redirect(\`/shop/<slug>\`)`, and a `?notice=` redirect.
 * This settles it on `notFound()`: a page whose shop row does not exist is a
 * page that does not exist.
 *
 * The order matters and is the reason this is one function rather than a
 * convention:
 *
 * 1. `requireStaffSession()` — signed in and staff, or off to `/sign-in`.
 * 2. The shop row, read by `session.user.shopId`. Never by the URL slug: the
 *    session is the tenant, and the slug is just how the staffer typed it.
 * 3. The tenant assert. The staff layout already refuses a slug that disagrees
 *    with the session (`src/app/shop/[shopSlug]/layout.tsx`), and this repeats
 *    it deliberately — a layout is chrome, and nothing stops a future route
 *    (or a page-level action reached from one) from rendering outside it.
 * 4. The live permission gate, re-read from the database rather than the JWT,
 *    so a demoted or disabled staff member loses the surface immediately.
 *
 * **Every refusal throws.** `notFound()` and `redirect()` unwind the render;
 * this function has no code path that returns normally after deciding against
 * the caller. That is load-bearing rather than stylistic: a gate helper that
 * returned a `{ allowed: false }` the caller might forget to branch on would
 * be a tenant-isolation bug wearing a helper's clothes, and
 * `src/lib/session.test.ts` pins it.
 *
 * Which leaves the other end of the same rope: **a caller may not wrap this in a
 * `try`.** A `catch` above a throwing gate turns the refusal back into exactly
 * the returned `{ allowed: false }` above — except invisibly, since execution
 * simply continues and the page renders for someone this function said no to.
 * The test can only pin the helper's own behaviour, so the callers are held by
 * `scripts/check-repo.mjs`'s `redirect-in-try` rule
 * (`scripts/check-redirect-in-try.mjs`), which refuses any unwinding call
 * written inside a `try` body and leaves `catch { redirect(…) }` alone. It was
 * worth a script rather than a convention for the reason the notice-code rule
 * was: the failure renders nothing, so nothing goes red.
 */
export async function requireShopSurface(
  shopSlug: string,
  options: ShopSurfaceOptions = {},
): Promise<ShopSurface> {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Two conditions, one outcome: a session pointing at a shop row that is gone,
  // and a URL naming a shop that is not this session's. Both are "no such page
  // for you", and neither may fall through to the read below.
  if (!shop || shop.slug !== shopSlug) notFound();
  if (options.allow) {
    const allowed = await options.allow(db, shop.id, session.user.personId);
    if (!allowed) {
      // Bounced with an explanatory notice rather than teleported silently
      // (task 82, UX persona 11 "Kai"): a refusal that says nothing is
      // indistinguishable from a dead link.
      redirect(
        noticeUrl(shopPath(shop.slug, ...(options.refusal.landing ?? [])), options.refusal.notice),
      );
    }
  }
  return { session, db, shop };
}
