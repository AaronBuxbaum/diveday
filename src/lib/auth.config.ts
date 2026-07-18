import { NextResponse } from "next/server";
import type { NextAuthConfig } from "next-auth";
import { isStaff } from "@/lib/authz";

/**
 * Edge-safe Auth.js config: no database, no bcrypt. src/proxy.ts builds a
 * NextAuth instance from this alone (JWT decode only); src/lib/auth.ts
 * spreads it and adds the Credentials provider (node runtime). ADR-0006.
 */

// Fixed dev fallback keeps pnpm dev / pnpm e2e zero-setup; production must
// set AUTH_SECRET (NextAuth fails loudly without it there).
export const authSecret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "production" ? undefined : "scuba-dev-secret-not-for-production");

const STAFF_PREFIX = "/shop";

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
      const isPublicShopRoute = /^\/shop\/[a-z0-9-]+\/schedule(\/.*)?$/.test(pathname);

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
      if (pathname.startsWith(STAFF_PREFIX) && !isPublicShopRoute) {
        if (!roles) return false; // Auth.js redirects to pages.signIn
        if (!isStaff(roles)) return NextResponse.redirect(new URL("/", request.nextUrl));
        return true;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
