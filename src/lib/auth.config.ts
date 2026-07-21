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

const PUBLIC_SCHEDULE = /^\/shop\/[a-z0-9-]+\/schedule(\/.*)?$/;
const COURSE_PAGE = /^\/shop\/([a-z0-9-]+)\/courses\/([a-z0-9-]+)\/?$/;

/**
 * Which /shop routes a signed-out diver may read. Everything else under /shop
 * is staff.
 *
 * Courses are the delicate one: the catalog index and the editor sit above and
 * below a public course page in the same path space. The match is anchored to
 * exactly one segment after /courses/ — so /courses and /courses/<slug>/edit
 * stay gated — and refuses the staff segments that would otherwise look like a
 * slug. Course slugs are minted through `courseSlug`, which refuses them too,
 * so the two halves cannot drift apart.
 */
export function isPublicShopRoute(pathname: string): boolean {
  if (PUBLIC_SCHEDULE.test(pathname)) return true;
  const course = COURSE_PAGE.exec(pathname);
  return Boolean(course && !RESERVED_COURSE_SEGMENTS.has(course[2]));
}

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
