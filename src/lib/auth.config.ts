import { NextResponse } from "next/server";
import type { NextAuthConfig } from "next-auth";
import { isStaff } from "@/lib/authz";
import { RESERVED_COURSE_SEGMENTS } from "@/lib/courses";

/**
 * Edge-safe Auth.js config: no database, no bcrypt. src/proxy.ts builds a
 * NextAuth instance from this alone (JWT decode only); src/lib/auth.ts
 * spreads it and adds the Credentials provider (node runtime). ADR-0006.
 */

// Fixed dev fallback keeps pnpm dev / pnpm e2e zero-setup; production must
// set AUTH_SECRET (NextAuth fails loudly without it there).
export const authSecret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production" ? undefined : "diveday-dev-secret-not-for-production");

const STAFF_PREFIX = "/shop";

const SCHEDULE_ROOT = /^\/shop\/[a-z0-9-]+\/schedule\/?$/;
const SCHEDULE_TRIP_PAGE = /^\/shop\/[a-z0-9-]+\/schedule\/([a-z0-9-]+)(\/.*)?$/;
// The staff operations board (Lens 17, docs/product/features/story-backlog.md) sits
// one segment below the public schedule, in the same path space a trip's own
// id occupies — carved out the same way COURSE_PAGE below refuses staff
// segments a course slug could otherwise impersonate. Trip ids are UUIDs, so
// a real trip can never literally collide with this reserved word.
const RESERVED_SCHEDULE_SEGMENTS = new Set(["board"]);
const COURSE_PAGE = /^\/shop\/([a-z0-9-]+)\/courses\/([a-z0-9-]+)\/?$/;
// $-anchored to exactly "/courses" (or "/courses/") — never the open-ended
// `(\/.*)?` tail SCHEDULE_TRIP_PAGE uses, because that tail would also
// swallow the staff editor living one segment further down this same path
// space.
const COURSES_INDEX = /^\/shop\/[a-z0-9-]+\/courses\/?$/;
const COURSE_PATHS_INDEX = /^\/shop\/[a-z0-9-]+\/courses\/paths\/?$/;
const COURSE_PATH_PAGE = /^\/shop\/[a-z0-9-]+\/courses\/paths\/[a-z0-9-]+\/?$/;

/**
 * Which /shop routes a signed-out diver may read. Everything else under /shop
 * is staff.
 *
 * Courses are the delicate one: the catalog index and the editor sit above and
 * below a public course page in the same path space. The match is anchored to
 * exactly one segment after /courses/ — so /courses/<slug>/edit and
 * /courses/new stay gated — and refuses the staff segments that would
 * otherwise look like a slug. Course slugs are minted through `courseSlug`,
 * which refuses them too, so the two halves cannot drift apart.
 *
 * The catalog index (/courses) and certification paths (/courses/paths,
 * /courses/paths/<slug>) are public guidance surfaces, not gates — see the
 * route map note in AGENTS.md. Each is matched by its own `$`-anchored,
 * single-segment pattern rather than folded into COURSE_PAGE's reserved-word
 * carve-out, so none of these additions can accidentally widen what COURSE_PAGE
 * treats as a slug.
 */
export function isPublicShopRoute(pathname: string): boolean {
  if (SCHEDULE_ROOT.test(pathname)) return true;
  const schedule = SCHEDULE_TRIP_PAGE.exec(pathname);
  if (schedule && !RESERVED_SCHEDULE_SEGMENTS.has(schedule[1])) return true;
  if (COURSES_INDEX.test(pathname)) return true;
  if (COURSE_PATHS_INDEX.test(pathname)) return true;
  if (COURSE_PATH_PAGE.test(pathname)) return true;
  const course = COURSE_PAGE.exec(pathname);
  return Boolean(course && !RESERVED_COURSE_SEGMENTS.has(course[2]));
}

/**
 * The one surface meant to be framed by a shop's own external website (the
 * booking-widget embed). Deliberately the schedule/trip pages only, not every
 * public shop route — everything else, including this same shop's staff and
 * sign-in pages, keeps the site's default deny (src/proxy.ts) so a third-party
 * page can never frame them for a clickjacking attempt.
 */
export function isEmbeddableShopRoute(pathname: string): boolean {
  if (SCHEDULE_ROOT.test(pathname)) return true;
  const schedule = SCHEDULE_TRIP_PAGE.exec(pathname);
  return Boolean(schedule && !RESERVED_SCHEDULE_SEGMENTS.has(schedule[1]));
}

/**
 * Set on the request (never trusted from the response side) by `src/proxy.ts`
 * when — and only when — the current request is a genuine embed request
 * (`isEmbeddableShopRoute` route + `?embed=1`). `ShopLayout` reads it to
 * suppress staff chrome for a signed-in staff member previewing their own
 * embed, since a layout (unlike a page) is never handed `searchParams`
 * directly. On every proxied request the incoming copy of this header is
 * explicitly overwritten (set or deleted). The proxy matcher's static-asset
 * escape hatch means "proxied" is not "all", so readers must stay fail-closed
 * about its absence and treat the value as advisory, never as proof.
 */
export const EMBED_REQUEST_HEADER = "x-diveday-embed";

/**
 * The request's own pathname, stamped onto the request by `src/proxy.ts` for
 * the same reason `EMBED_REQUEST_HEADER` exists: a layout is never handed the
 * URL (no `searchParams`, no pathname — only its own `params`), and
 * `ShopLayout` has to tell a *public* shop route (schedule, courses — readable
 * by anyone, including staff of a different shop) apart from a staff one
 * before it decides whether a cross-tenant visit is a 404. Overwritten on
 * every *proxied* request, exactly like the embed header; because the proxy
 * matcher carries a static-asset escape hatch, `ShopLayout` additionally
 * binds the value to the slug it is rendering and fails closed on anything
 * else, so a value that somehow arrived unproxied still grants nothing.
 */
export const REQUEST_PATH_HEADER = "x-diveday-path";

export const authConfig = {
  secret: authSecret,
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.personId = user.personId;
        token.shopId = user.shopId;
        token.shopSlug = user.shopSlug;
        token.roles = user.roles;
      }
      return token;
    },
    session({ session, token }) {
      session.user.personId = token.personId as string;
      session.user.shopId = token.shopId as string;
      session.user.shopSlug = token.shopSlug as string;
      session.user.roles = (token.roles ?? []) as typeof session.user.roles;
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const roles = auth?.user?.roles;
      const isPublic = isPublicShopRoute(pathname);

      if ((pathname === STAFF_PREFIX || pathname === `${STAFF_PREFIX}/`) && isStaff(roles)) {
        const shopSlug = auth?.user?.shopSlug;
        if (!shopSlug) return false;
        return NextResponse.redirect(new URL(`/shop/${shopSlug}`, request.nextUrl));
      }
      if (pathname === "/sign-in" && isStaff(roles)) {
        const shopSlug = auth?.user?.shopSlug;
        if (shopSlug) {
          return NextResponse.redirect(new URL(`/shop/${shopSlug}`, request.nextUrl));
        }
      }
      if (pathname.startsWith(STAFF_PREFIX) && !isPublic) {
        if (!roles) return false; // Auth.js redirects to pages.signIn
        if (!isStaff(roles)) return NextResponse.redirect(new URL("/", request.nextUrl));
        return true;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
