import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DemoBanner } from "@/components/DemoBanner";
import { OfflineManifestAutoSave } from "@/components/OfflineManifestAutoSave";
import { PreserveFormScroll } from "@/components/PreserveFormScroll";
import { PublicShopFooter, PublicShopHeader } from "@/components/PublicShopChrome";
import { ShopNav } from "@/components/ShopNav";
import { SkipLink } from "@/components/SkipLink";
import { countBlockedDivers } from "@/db/blockers";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { countReviewsAwaitingModeration } from "@/db/reviews";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { todayNextDepartureTripId } from "@/db/today";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { EMBED_REQUEST_HEADER, isPublicShopRoute, REQUEST_PATH_HEADER } from "@/lib/auth.config";
import {
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canViewShopReports,
  isStaff,
} from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { DEMO_ROLE_KEYS, DEMO_ROLE_META } from "@/lib/demo-roles";

/**
 * Every /shop page reads the session, the shop row, and staff-role state up
 * front — genuinely request-scoped, not something a static shell can serve.
 * Under Cache Components, that unwrapped `headers()`/`auth()`/DB access would
 * otherwise fail the build ("blocking-prerender-dynamic": the fix options are
 * cache it, wrap it in `<Suspense>`, or explicitly allow the block). None of
 * `/shop/**` is a candidate for a static shell or Partial Prerendering — it's
 * staff-only, auth-gated, and safety-critical (manifests, roll call, cert and
 * medical data) — so this opts the whole subtree (schedule, manifest,
 * waivers, orders, divers, trips, offline-manifest, everything under
 * `/shop/[shopSlug]/**`) out with `instant = false` rather than restructure
 * it around Suspense boundaries. This keeps the route exactly as fully
 * dynamic and request-scoped as it was before Cache Components — same
 * render-per-request behavior, just no longer implied by the old
 * "reading headers() opts the whole route into dynamic rendering" model.
 * `instant = false` does not itself force dynamic rendering (a genuinely
 * prerenderable descendant would still get a static shell); it only permits
 * *this* layout's already-inherent blocking reads to run without erroring.
 * Do not remove without an accompanying restructure verified end to end —
 * see the safety-critical-surfaces rule in AGENTS.md.
 */
export const instant = false;

/**
 * Staff-surface shell. If the shop is a demo shop, it hangs the demo banner
 * (with its reset) above every /shop page so the "this is a playground" framing
 * is always present (docs ADR 20260718-demo-mode).
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // Set only by src/proxy.ts on a genuine embed request — a layout is never
  // handed searchParams directly, so this header is the one way it learns
  // "this render is going into someone else's iframe." Forces every bit of
  // staff chrome off, even for a signed-in staff member previewing their own
  // embed (docs ADR 20260726-schedule-embed).
  const requestHeaders = await headers();
  const isEmbed = requestHeaders.get(EMBED_REQUEST_HEADER) === "1";
  // Also proxy-set (src/proxy.ts) and, like the embed header above, always
  // overwritten there so a client can never supply it. A layout is handed no
  // URL at all, and this shell wraps both the shop's public pages and its
  // staff console, so telling the two apart is the only way the tenant check
  // below can 404 a cross-shop staff visit without also 404ing this shop's
  // public schedule for the very same person.
  const requestPath = requestHeaders.get(REQUEST_PATH_HEADER) ?? "";
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const showBanner = !isEmbed && (shop?.isDemo ?? false);
  // Staff read chrome in the language their own device asks for, same
  // negotiation as every other staff surface.
  const locale = await requestLocale(shop?.defaultLocale);

  async function todayBoatHref(
    dbi: typeof db,
    shopId: string,
    timeZone: string,
    slug: string,
  ): Promise<string | undefined> {
    const tripId = await todayNextDepartureTripId(dbi, shopId, timeZone);
    // The manifest opens on its "Before departure" checkpoint — the boarding pass.
    return tripId ? `/shop/${slug}/trips/${tripId}/manifest` : undefined;
  }

  // Owner and diver (public guest) are always offered; instructor/divemaster/
  // captain only appear when this shop actually seeded someone in that role, so
  // the role switcher never presents a card that would no-op.
  let availableRoles: string[] = ["owner", "diver"];
  if (showBanner && shop) {
    const present = new Set(
      (
        await db
          .selectDistinct({ role: personRoles.role })
          .from(personRoles)
          .innerJoin(people, eq(people.id, personRoles.personId))
          .where(eq(people.shopId, shop.id))
      ).map((row) => row.role),
    );
    availableRoles = [
      "owner",
      ...(["instructor", "divemaster", "captain"] as const).filter((role) => present.has(role)),
      "diver",
    ];
  }

  const session = await auth();
  let currentRole: "owner" | "instructor" | "divemaster" | "captain" | "diver" = "diver";
  if (session?.user) {
    if (session.user.roles.includes("owner") || session.user.roles.includes("manager")) {
      currentRole = "owner";
    } else if (session.user.roles.includes("instructor")) {
      currentRole = "instructor";
    } else if (session.user.roles.includes("divemaster")) {
      currentRole = "divemaster";
    } else if (session.user.roles.includes("captain")) {
      currentRole = "captain";
    }
  }

  const demoT = showBanner ? diverTranslator(await requestLocale(shop?.defaultLocale)) : undefined;
  const staffT = staffTranslator(locale);

  // INVARIANT: staff chrome and counts are scoped to the session's own shop —
  // a mismatched slug renders nothing of the other tenant.
  //
  // This layout resolves the shop from the URL slug, but every staff *page*
  // below it reads its data from `session.user.shopId`. Without this check the
  // two disagree the moment someone signed into shop A opens
  // /shop/shop-b/anything: the page shows A's rows while the shell around it
  // shows B's name, B's next departure, and B's pending-work counts (reviews
  // awaiting moderation, blocked divers — which include medical review). Those
  // counts are another tenant's operational data, and no page-level gate can
  // catch them because they are read here, in the shell.
  const ownShop = Boolean(session?.user && shop && session.user.shopId === shop.id);
  // A shop's schedule and course pages are public (isPublicShopRoute is the
  // canonical allowlist, and the edge gate in src/lib/auth.config.ts already
  // lets a signed-out visitor read them), so staff of another shop stay
  // welcome there — they simply get the public chrome below, exactly like any
  // other visitor. Everywhere else under /shop is staff-only, and a
  // cross-tenant visit is refused outright rather than rendered as a mix of
  // two shops. Fails closed: an absent path header is not a public route.
  if (session?.user && shop && !ownShop && !isPublicShopRoute(requestPath)) notFound();

  const showNav = !isEmbed && ownShop;
  // Small "pending work" counts for the Reviews/Blockers nav badges (task 83,
  // UX persona 11 "Kai"/12 "Maren") — both queries the shop's own pages
  // already run on every visit, gated the same way the nav itself is so a
  // signed-out or embedded render never pays for them.
  const [navReviewsCount, navBlockersCount] =
    showNav && session?.user && shop
      ? await Promise.all([
          countReviewsAwaitingModeration(db, shop.id),
          countBlockedDivers(db, shop.id, nowDate()),
        ])
      : [0, 0];

  return (
    <>
      {/* Every /shop page fronts ShopNav's 10-15 header tab stops (persona 14,
          ux-personas-20260730-findings.md) — this jumps a keyboard user past it and the
          demo banner straight to the page's own content. Rendered even on the
          public schedule/course pages where ShopNav is absent for staff, so
          the pattern is unconditional like the manifest's own skip link. */}
      <SkipLink href="#shop-main-content" label={staffT("shared.skipToContent")} />
      {showBanner && demoT ? (
        <DemoBanner
          currentRole={currentRole}
          currentName={session?.user?.name}
          shopSlug={shopSlug}
          roles={DEMO_ROLE_META.filter((role) => availableRoles.includes(role.id)).map((role) => {
            const title = demoT(DEMO_ROLE_KEYS[role.id].title);
            return {
              ...role,
              title,
              desc: demoT(DEMO_ROLE_KEYS[role.id].desc),
              tryThis: demoT(DEMO_ROLE_KEYS[role.id].tryThis),
              switchAriaLabel: demoT("demo.switchToAria", { role: title }),
            };
          })}
          copy={{
            shopLabel: demoT("demo.shopLabel"),
            viewingAs: demoT("demo.viewingAs"),
            switchRole: demoT("demo.switchRole"),
            sharedWarning: demoT("demo.sharedWarning"),
            sessionExpired: demoT("demo.sessionExpired"),
            withCredentials: demoT("demo.withCredentials"),
            chooseRole: demoT("demo.chooseRole"),
            active: demoT("demo.active"),
            tryLabel: demoT("demo.tryLabel"),
            current: demoT("demo.current"),
            switchAction: demoT("demo.switchAction"),
          }}
          // A minted (per-visitor) demo is addressable by its slug and readable
          // by anyone who has it, so warn against entering real customer data;
          // the canonical fixture demo holds only sample data and stays quiet.
          isMintedDemo={shop?.slug !== DEMO_SHOP_SLUG}
          currentEmail={session?.user?.email}
          demoPassword={DEMO_BYPASS_PASSWORD}
        />
      ) : null}
      {showNav && session?.user && shop ? (
        <ShopNav
          shopSlug={shopSlug}
          shopName={shop.name}
          boatBoardingHref={await todayBoatHref(db, shop.id, shop.timezone, shopSlug)}
          navGates={{
            waivers: canManageWaiverTemplates(session.user.roles),
            reports: canViewShopReports(session.user.roles),
            team: canManageStaffAccounts(session.user.roles),
          }}
          navCounts={{ reviews: navReviewsCount, blockers: navBlockersCount }}
          locale={locale}
        />
      ) : null}
      {/* The signed-out counterpart to ShopNav above — an anonymous or
          non-staff visitor gets the shop's own identity instead of staff
          chrome (task 9). Mutually exclusive with ShopNav by construction:
          exactly one of the two conditions is ever true. Keyed on `ownShop`,
          not merely on "is anyone signed in", so staff of a *different* shop
          reading this one's public schedule get the visitor treatment rather
          than a headerless page. */}
      {!isEmbed && !ownShop && shop ? <PublicShopHeader shop={shop} /> : null}
      {/* Keeps every trip in the shop's near-term board saved offline, not just
          a trip whose live manifest someone opened — see ADR
          20260726-shopwide-offline-manifest-priming. Gated to staff actually
          signed into *this* routed shop: several /shop/[shopSlug] pages
          (schedule, courses) are public per isPublicShopRoute, so a signed-out
          visitor, a diver account, or staff of a *different* shop browsing
          this one's public page must never mount it — the first two would
          just poll a 401 every five minutes, and the third would silently
          save their own shop's roster while the visible page is this one.
          `ownShop` is that same-shop test, now shared with the staff chrome
          above. */}
      {!isEmbed && ownShop && session?.user && isStaff(session.user.roles) ? (
        <OfflineManifestAutoSave />
      ) : null}
      <PreserveFormScroll />
      <div id="shop-main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </div>
      {!isEmbed && !ownShop && shop ? (
        <PublicShopFooter shop={shop} t={diverTranslator(locale)} />
      ) : null}
    </>
  );
}
