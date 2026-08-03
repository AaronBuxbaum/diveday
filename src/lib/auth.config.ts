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
  (process.env.NODE_ENV === "production" ? undefined : "diveday-dev-secret-not-for-production");

const STAFF_PREFIX = "/shop";

/**
 * The two diver surfaces a shop is meant to frame on its own website: the
 * public schedule (`/s/<shopSlug>`) and one departure's booking page
 * (`/s/<shopSlug>/trips/<tripId>`). Deliberately not every public route —
 * a course page is public but is not a supported widget, and everything else,
 * including this same shop's staff and sign-in pages, keeps the site's default
 * deny (src/proxy.ts) so a third-party page can never frame them for a
 * clickjacking attempt (ADR 20260726-schedule-embed).
 */
const EMBEDDABLE_SCHEDULE = /^\/s\/[a-z0-9-]+\/?$/;
const EMBEDDABLE_TRIP_PAGE = /^\/s\/[a-z0-9-]+\/trips\/[^/]+\/?$/;

export function isEmbeddableShopRoute(pathname: string): boolean {
  return EMBEDDABLE_SCHEDULE.test(pathname) || EMBEDDABLE_TRIP_PAGE.test(pathname);
}

/**
 * Set on the request (never trusted from the response side) by `src/proxy.ts`
 * when — and only when — the current request is a genuine embed request
 * (`isEmbeddableShopRoute` route + `?embed=1`). The public shop layout reads it
 * to suppress chrome, since a layout (unlike a page) is never handed
 * `searchParams` directly. Every request's incoming copy of this header is
 * explicitly overwritten in the proxy (set or deleted), so a client-supplied
 * value can never survive to reach a reader downstream.
 */
export const EMBED_REQUEST_HEADER = "x-diveday-embed";

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
      // `/shop/**` is staff, without exception — the diver surfaces that used
      // to be carved out of it by an allowlist now live under `/s/<shopSlug>`
      // and their old URLs 308 there from `next.config.ts`, before this
      // callback ever runs (ADR 20260803-public-shop-namespace).
      if (pathname.startsWith(STAFF_PREFIX)) {
        if (!roles) return false; // Auth.js redirects to pages.signIn
        if (!isStaff(roles)) return NextResponse.redirect(new URL("/", request.nextUrl));
        return true;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
