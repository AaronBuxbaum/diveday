import { eq } from "drizzle-orm";
import { DemoBanner } from "@/components/DemoBanner";
import { OfflineManifestAutoSave } from "@/components/OfflineManifestAutoSave";
import { PreserveFormScroll } from "@/components/PreserveFormScroll";
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
 * Staff-surface shell. Every page below it is staff-only — the diver-facing
 * schedule, trip, and course pages that used to be carved out of this
 * namespace by an allowlist now live under `/s/[shopSlug]` with a shell of
 * their own (ADR 20260803-public-shop-namespace), so this layout no longer has
 * a signed-out branch or an embed mode to account for.
 *
 * If the shop is a demo shop, it hangs the demo banner (with its reset) above
 * every /shop page so the "this is a playground" framing is always present
 * (docs ADR 20260718-demo-mode).
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const showBanner = shop?.isDemo ?? false;
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

  const showNav = Boolean(session?.user) && Boolean(shop);
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
          demo banner straight to the page's own content. Unconditional, like
          the manifest's own skip link. */}
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
      {/* Keeps every trip in the shop's near-term board saved offline, not just
          a trip whose live manifest someone opened — see ADR
          20260726-shopwide-offline-manifest-priming. Still gated to staff
          actually signed into *this* routed shop even though /shop is now
          staff-only end to end: staff of a *different* shop browsing this
          one's URL would otherwise silently save their own shop's roster while
          the visible page is this one. */}
      {session?.user && shop && isStaff(session.user.roles) && session.user.shopId === shop.id ? (
        <OfflineManifestAutoSave />
      ) : null}
      <PreserveFormScroll />
      <div id="shop-main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </div>
    </>
  );
}
